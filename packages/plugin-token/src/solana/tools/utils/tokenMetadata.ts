import {
  getMint,
  TOKEN_2022_PROGRAM_ID,
  getExtensionTypes,
  ExtensionType,
  getMetadataPointerState,
  getTokenMetadata as getSplTokenMetadata,
} from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";

/**
 * Get Token-2022 metadata from extensions
 */
async function getToken2022Metadata(
  connection: Connection,
  mintPubkey: PublicKey,
): Promise<{ name: string; symbol: string; uri?: string } | null> {
  try {
    const mint2022 = await getMint(
      connection,
      mintPubkey,
      "confirmed",
      TOKEN_2022_PROGRAM_ID,
    );

    const exts = getExtensionTypes(mint2022.tlvData);
    const hasEmbedded = exts.includes(ExtensionType.TokenMetadata);
    const hasPointer = exts.includes(ExtensionType.MetadataPointer);

    // 1. Try embedded TokenMetadata extension first (standard for Token-2022)
    if (hasEmbedded) {
      const embeddedMetadata = await getSplTokenMetadata(
        connection,
        mintPubkey,
        "confirmed",
        TOKEN_2022_PROGRAM_ID,
      );

      if (embeddedMetadata) {
        return {
          name: embeddedMetadata.name,
          symbol: embeddedMetadata.symbol,
          uri: embeddedMetadata.uri,
        };
      }
    }

    // 2. If no embedded metadata found (or failed), check MetadataPointer
    if (hasPointer) {
      const pointerState = getMetadataPointerState(mint2022);
      if (pointerState?.metadataAddress) {
        const metadataAddr = new PublicKey(pointerState.metadataAddress);

        // Only check external accounts if it doesn't point to self
        // (Self-pointing would have been handled by hasEmbedded check above)
        if (!metadataAddr.equals(mintPubkey)) {
          const metadataAccount = await connection.getAccountInfo(
            metadataAddr,
            "confirmed",
          );

          if (metadataAccount?.data) {
            // Try parsing as Metaplex (most common external format)
            const parsed = parseMetaplexMetadata(metadataAccount.data);
            if (parsed) {
              return parsed;
            }
          }
        }
      }
    }
  } catch (error) {
    // Not a Token-2022 mint or error fetching, will try legacy
  }

  return null;
}

/**
 * Parse Metaplex metadata from account data
 */
function parseMetaplexMetadata(
  data: Buffer,
): { name: string; symbol: string; uri?: string } | null {
  try {
    // Bounds check: minimum 65 bytes (1 key + 32 update auth + 32 mint)
    if (data.length < 65) {
      return null;
    }

    let offset = 1 + 32 + 32; // key + update auth + mint
    const decoder = new TextDecoder();

    const readString = () => {
      if (offset >= data.length) {
        return null;
      }
      const nameLength = data[offset];
      offset++;

      if (nameLength === 0) {
        return "";
      }

      if (offset + nameLength > data.length) {
        return null;
      }

      const str = decoder
        .decode(data.slice(offset, offset + nameLength))
        .replace(new RegExp(String.fromCharCode(0), "g"), "");
      offset += nameLength;
      return str;
    };

    const name = readString();
    const symbol = readString();
    const uri = readString();

    if (name && symbol) {
      return { name, symbol, uri: uri || undefined };
    }
  } catch (error) {
    // Parsing failed
  }
  return null;
}

export async function getTokenMetadata(
  connection: Connection,
  tokenMint: string,
  isToken2022?: boolean,
) {
  const mintPubkey = new PublicKey(tokenMint);

  // First, try Token-2022 metadata if it's a Token-2022 token
  // Even if it's Token-2022, it might not have metadata extensions,
  // so we'll fall back to legacy metadata if Token-2022 metadata is not found
  if (isToken2022 === true) {
    const token2022Metadata = await getToken2022Metadata(connection, mintPubkey);
    if (token2022Metadata) {
      return token2022Metadata;
    }
    // If Token-2022 metadata not found, continue to try legacy metadata
    // (Token-2022 tokens can still use Metaplex metadata)
  }

  // Try legacy Metaplex metadata (works for both legacy tokens and Token-2022 tokens without extensions)
  const METADATA_PROGRAM_ID = new PublicKey(
    "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
  );

  const [metadataPDA] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      METADATA_PROGRAM_ID.toBuffer(),
      mintPubkey.toBuffer(),
    ],
    METADATA_PROGRAM_ID,
  );

  const metadata = await connection.getAccountInfo(metadataPDA);
  if (!metadata?.data) {
    // Metadata not found - this is normal for tokens without metadata
    return null;
  }

  // Parse Metaplex metadata
  const parsedMetadata = parseMetaplexMetadata(metadata.data);
  if (parsedMetadata) {
    return parsedMetadata;
  }

  return null;
}
