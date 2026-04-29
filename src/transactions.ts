import { Transaction, type Connection } from "@solana/web3.js";
import { toPublicKey } from "./codec.js";
import type { BuildTransactionOptions, PreparedVaultTransaction } from "./types.js";

export function buildTransaction(options: BuildTransactionOptions): Transaction {
  const transaction = new Transaction();
  transaction.feePayer = toPublicKey(options.feePayer);
  if (options.recentBlockhash) {
    transaction.recentBlockhash = options.recentBlockhash;
  }
  transaction.add(...options.instructions);
  return transaction;
}

export async function prepareTransaction(
  connection: Connection,
  options: BuildTransactionOptions,
): Promise<PreparedVaultTransaction> {
  let blockhash = options.recentBlockhash;
  let lastValidBlockHeight: number | null = null;

  if (!blockhash) {
    const latest = await connection.getLatestBlockhash();
    blockhash = latest.blockhash;
    lastValidBlockHeight = latest.lastValidBlockHeight;
  }

  return {
    transaction: buildTransaction({
      ...options,
      recentBlockhash: blockhash,
    }),
    blockhash,
    lastValidBlockHeight,
  };
}
