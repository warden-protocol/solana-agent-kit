import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { SolanaAgentKit } from "solana-agent-kit";
import { getTokenMetadata } from "./utils/tokenMetadata";

/**
 * Get the token balances of a Solana wallet
 * @param agent - SolanaAgentKit instance
 * @param token_address - Optional SPL token mint address. If not provided, returns SOL balance
 * @returns Promise resolving to the balance as an object containing sol balance and token balances with their respective mints, symbols, names and decimals
 */
export async function get_token_balance(
  agent: SolanaAgentKit,
  walletAddress?: PublicKey,
): Promise<{
  sol: number;
  tokens: Array<{
    tokenAddress: string;
    name: string;
    symbol: string;
    balance: number;
    decimals: number;
  }>;
}> {
  const owner = walletAddress ?? agent.wallet.publicKey;
  const [lamportsBalance, tokenAccountData, token2022AccountData] =
    await Promise.all([
      agent.connection.getBalance(owner),
      agent.connection.getParsedTokenAccountsByOwner(owner, {
        programId: TOKEN_PROGRAM_ID,
      }),
      agent.connection.getParsedTokenAccountsByOwner(owner, {
        programId: TOKEN_2022_PROGRAM_ID,
      }),
    ]);

  // Process tokens from both programs separately since we know which program each belongs to
  const processTokens = async (tokens: any[], isToken2022: boolean) => {
    const nonZeroTokens = tokens.filter(
      (v: any) => v.account.data.parsed.info.tokenAmount.uiAmount !== 0,
    );

    return Promise.all(
      nonZeroTokens.map(async (v: any) => {
        const mint = v.account.data.parsed.info.mint;
        const mintInfo = await getTokenMetadata(
          agent.connection,
          mint,
          isToken2022,
        );
        // If metadata is not found, return empty string values to not let the tool fail
        if (!mintInfo) {
          return {
            tokenAddress: mint,
            name: "",
            symbol: "",
            balance: v.account.data.parsed.info.tokenAmount.uiAmount as number,
            decimals: v.account.data.parsed.info.tokenAmount.decimals as number,
          };
        }
        // Normal return
        return {
          tokenAddress: mint,
          name: mintInfo.name ?? "",
          symbol: mintInfo.symbol ?? "",
          balance: v.account.data.parsed.info.tokenAmount.uiAmount as number,
          decimals: v.account.data.parsed.info.tokenAmount.decimals as number,
        };
      }),
    );
  };

  const [legacyTokenBalances, token2022Balances] = await Promise.all([
    processTokens(tokenAccountData.value, false),
    processTokens(token2022AccountData.value, true),
  ]);

  const tokenBalances = [...legacyTokenBalances, ...token2022Balances];

  const solBalance = lamportsBalance / LAMPORTS_PER_SOL;

  return {
    sol: solBalance,
    tokens: tokenBalances,
  };
}
