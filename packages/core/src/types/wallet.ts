import {
  type Keypair,
  type PublicKey,
  type SendOptions,
  type Signer,
  Transaction,
  type TransactionInstruction,
  TransactionMessage,
  type TransactionSignature,
  VersionedTransaction,
} from "@solana/web3.js";
import type { SolanaAgentKit } from "../agent";
import {
  type feeTiers,
  getComputeBudgetInstructions,
  sendTx,
} from "../utils/send_tx";
// Type guard to check if object is a VersionedTransaction (handles version mismatches)
function isVersionedTransactionLike(obj: any): obj is VersionedTransaction {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'version' in obj &&
    'message' in obj &&
    'signatures' in obj &&
    typeof obj.serialize === 'function'
  );
}

// Type guard to check if object is a Transaction
function isTransactionLike(obj: any): obj is Transaction {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'instructions' in obj &&
    'recentBlockhash' in obj &&
    typeof obj.serialize === 'function' &&
    !('version' in obj)
  );
}

/**
 * Interface representing a Solana wallet implementation

 * Defines the standard interface for interacting with a Solana wallet,
 * including transaction signing, message signing, and connection status.
 *
 * @interface Wallet
 */
export interface BaseWallet {
  /**
   * The public key of the connected wallet
   * @type {PublicKey}
   */
  readonly publicKey: PublicKey;

  /**
   * Signs a single transaction
   * @template T - Transaction type (Transaction or VersionedTransaction)
   * @param {T} transaction - The transaction to be signed
   * @returns {Promise<T>} Promise resolving to the signed transaction
   */
  signTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T,
  ): Promise<T>;

  /**
   * Signs multiple transactions in batch
   * @template T - Transaction type (Transaction or VersionedTransaction)
   * @param {T[]} transactions - Array of transactions to be signed
   * @returns {Promise<T[]>} Promise resolving to an array of signed transactions
   */
  signAllTransactions<T extends Transaction | VersionedTransaction>(
    transactions: T[],
  ): Promise<T[]>;

  /**
   * Sends a transaction on chain
   * @template T - Transaction type (Transaction or VersionedTransaction)
   * @param {T} transaction - The transaction to be signed and sent
   */
  sendTransaction?: <T extends Transaction | VersionedTransaction>(
    transaction: T,
  ) => Promise<string>;

  /**
   * Signs and sends a transaction to the network
   * @template T - Transaction type (Transaction or VersionedTransaction)
   * @param {T} transaction - The transaction to be signed and sent
   * @param {SendOptions} [options] - Optional transaction send configuration
   * @returns {Promise<{signature: TransactionSignature}>} Promise resolving to the transaction signature
   */
  signAndSendTransaction: <T extends Transaction | VersionedTransaction>(
    transaction: T,
    options?: SendOptions,
  ) => Promise<{ signature: TransactionSignature }>;

  /**
   * Signs a message
   * @param message - The message to be signed
   */
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

export async function signOrSendTX(
  agent: SolanaAgentKit,
  instructionsOrTransaction:
    | TransactionInstruction[]
    | Transaction
    | VersionedTransaction
    | Transaction[]
    | VersionedTransaction[],
  otherKeypairs?: Keypair[],
  feeTier?: keyof typeof feeTiers,
): Promise<
  | string
  | string[]
  | Transaction
  | VersionedTransaction
  | Transaction[]
  | VersionedTransaction[]
> {


  if (
    Array.isArray(instructionsOrTransaction) &&
    instructionsOrTransaction.length > 0 &&
    (instructionsOrTransaction[0] instanceof Transaction ||
      instructionsOrTransaction[0] instanceof VersionedTransaction ||
      isTransactionLike(instructionsOrTransaction[0]) ||
      isVersionedTransactionLike(instructionsOrTransaction[0]))
  ) {
    if (agent.config.signOnly) {
      return await agent.wallet.signAllTransactions(
        instructionsOrTransaction as Transaction[],
      );
    }
    const txSigs: string[] = [];
    for (const tx of instructionsOrTransaction) {
      if (agent.wallet.signAndSendTransaction) {
        const { signature } = await agent.wallet.signAndSendTransaction(
          tx as Transaction,
        );
        txSigs.push(signature);
      } else {
        throw new Error(
          "Wallet does not support signAndSendTransaction please implement it manually or use the signOnly option",
        );
      }
    }

    return txSigs;
  }

  if (
    instructionsOrTransaction instanceof Transaction ||
    instructionsOrTransaction instanceof VersionedTransaction ||
    isTransactionLike(instructionsOrTransaction) ||
    isVersionedTransactionLike(instructionsOrTransaction)
  ) {
    if (agent.config.signOnly) {
      return await agent.wallet.signTransaction(instructionsOrTransaction);
    }

    if (!agent.wallet.signAndSendTransaction) {
      throw new Error(
        "Wallet does not support signAndSendTransaction please implement it manually or use the signOnly option",
      );
    }

    return (
      await agent.wallet.signAndSendTransaction(instructionsOrTransaction)
    ).signature;
  }
  
  const ixComputeBudget = await getComputeBudgetInstructions(
    agent,
    instructionsOrTransaction as TransactionInstruction[],
    feeTier ?? "mid",
  );
  const allInstructions = [
    ixComputeBudget.computeBudgetLimitInstruction,
    ixComputeBudget.computeBudgetPriorityFeeInstructions,
    ...instructionsOrTransaction,
  ];
  const { blockhash } = await agent.connection.getLatestBlockhash();
  const messageV0 = new TransactionMessage({
    payerKey: agent.wallet.publicKey,
    recentBlockhash: blockhash,
    instructions: allInstructions as TransactionInstruction[],
  }).compileToV0Message();

  const transaction = new VersionedTransaction(messageV0);
  transaction.sign([...(otherKeypairs ?? [])] as Signer[]);
  const signedTransaction = await agent.wallet.signTransaction(transaction);
  
  if (agent.config.signOnly) {
    return signedTransaction;
  }

  return sendTx(
    agent,
    instructionsOrTransaction as TransactionInstruction[],
    otherKeypairs,
    feeTier,
  );
}
