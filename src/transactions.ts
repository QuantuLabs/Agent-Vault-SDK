import { Transaction } from "@solana/web3.js";
import { toPublicKey } from "./codec.js";
import type { BuildTransactionOptions } from "./types.js";

export function buildTransaction(options: BuildTransactionOptions): Transaction {
  const transaction = new Transaction();
  transaction.feePayer = toPublicKey(options.feePayer);
  if (options.recentBlockhash) {
    transaction.recentBlockhash = options.recentBlockhash;
  }
  transaction.add(...options.instructions);
  return transaction;
}
