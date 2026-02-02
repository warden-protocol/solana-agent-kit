import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddress,
  getMint,
} from "@solana/spl-token";
import { type PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { type SolanaAgentKit, signOrSendTX } from "solana-agent-kit";

/**
 * Transfer SOL or SPL tokens to a recipient
 * @param agent SolanaAgentKit instance
 * @param to Recipient's public key
 * @param amount Amount to transfer
 * @param mint Optional mint address for SPL tokens
 * @returns Transaction signature
 */
export async function transfer(
  agent: SolanaAgentKit,
  to: PublicKey,
  amount: number,
  mint?: PublicKey,
): Promise<Awaited<ReturnType<typeof signOrSendTX>>> {
  try {
    let tx: Awaited<ReturnType<typeof signOrSendTX>>;

    if (!mint) {
      // Transfer native SOL
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: agent.wallet.publicKey,
          toPubkey: to,
          lamports: amount * LAMPORTS_PER_SOL,
        }),
      );

      const { blockhash } = await agent.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;

      tx = await signOrSendTX(agent, transaction.instructions);
    } else {
      const transaction = new Transaction();

      const mintAccountInfo = await agent.connection.getAccountInfo(mint);
      if (!mintAccountInfo) {
        throw new Error("Mint account not found");
      }
      const tokenProgramId = mintAccountInfo.owner;

      // Transfer SPL token
      const fromAta = await getAssociatedTokenAddress(
        mint,
        agent.wallet.publicKey,
        false,
        tokenProgramId,
      );
      const toAta = await getAssociatedTokenAddress(
        mint,
        to,
        false,
        tokenProgramId,
      );

      try {
        await getAccount(agent.connection, toAta, undefined, tokenProgramId);
      } catch {
        // Error is thrown if the tokenAccount doesn't exist
        transaction.add(
          createAssociatedTokenAccountInstruction(
            agent.wallet.publicKey,
            toAta,
            to,
            mint,
            tokenProgramId,
          ),
        );
      }

      // Get mint info to determine decimals
      const mintInfo = await getMint(
        agent.connection,
        mint,
        undefined,
        tokenProgramId,
      );
      const adjustedAmount = BigInt(Math.round(amount * Math.pow(10, mintInfo.decimals)));

      transaction.add(
        createTransferCheckedInstruction(
          fromAta,
          mint,
          toAta,
          agent.wallet.publicKey,
          adjustedAmount,
          mintInfo.decimals,
          [],
          tokenProgramId,
        ),
      );

      const { blockhash } = await agent.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;

      tx = await signOrSendTX(agent, transaction.instructions);
    }

    return tx;
  } catch (error: any) {
    throw new Error(`Transfer failed: ${error.message}`);
  }
}
