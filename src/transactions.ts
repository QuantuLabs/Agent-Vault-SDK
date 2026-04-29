import { PublicKey, Transaction, type Connection, type Signer } from "@solana/web3.js";
import { toPublicKey } from "./codec.js";
import type {
  AgentVaultTransactionSigner,
  BuildTransactionOptions,
  ExecutedVaultTransaction,
  PreparedVaultTransaction,
} from "./types.js";

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
  defaultSigner?: AgentVaultTransactionSigner,
): Promise<PreparedVaultTransaction> {
  let blockhash = options.recentBlockhash;
  let lastValidBlockHeight: number | null = null;

  if (!blockhash) {
    const latest = await connection.getLatestBlockhash();
    blockhash = latest.blockhash;
    lastValidBlockHeight = latest.lastValidBlockHeight;
  }

  const signer = options.signer ?? defaultSigner;
  const shouldSign = options.sign !== false && signer !== undefined;
  const transaction = buildTransaction({
    ...options,
    recentBlockhash: blockhash,
  });

  if (shouldSign) {
    await signTransaction(transaction, signer);
  }

  return {
    transaction,
    blockhash,
    lastValidBlockHeight,
    signed: shouldSign,
    signer: signerPublicKey(signer),
  };
}

export async function executeTransaction(
  connection: Connection,
  options: BuildTransactionOptions,
  defaultSigner?: AgentVaultTransactionSigner,
): Promise<ExecutedVaultTransaction> {
  const shouldSend = options.send !== false;
  if (shouldSend && options.sign === false) {
    throw new Error("cannot send an unsigned transaction; use send: false to return a transaction for external signing");
  }

  const prepared = await prepareTransaction(connection, options, defaultSigner);
  if (!shouldSend) {
    return {
      ...prepared,
      sent: false,
      signature: null,
      confirmation: null,
    };
  }
  if (!prepared.signed) {
    throw new Error("signer is required to sign and send; configure client.signer, pass options.signer, or use send: false");
  }

  const signature = await connection.sendRawTransaction(
    prepared.transaction.serialize(),
    options.sendOptions,
  );
  const confirmation = prepared.lastValidBlockHeight === null
    ? await connection.confirmTransaction(signature, options.commitment)
    : await connection.confirmTransaction(
        {
          signature,
          blockhash: prepared.blockhash,
          lastValidBlockHeight: prepared.lastValidBlockHeight,
        },
        options.commitment,
      );

  return {
    ...prepared,
    sent: true,
    signature,
    confirmation,
  };
}

async function signTransaction(transaction: Transaction, signer: AgentVaultTransactionSigner): Promise<void> {
  if ("signTransaction" in signer && typeof signer.signTransaction === "function") {
    const signed = await signer.signTransaction(transaction);
    transaction.signatures = signed.signatures;
    return;
  }
  transaction.partialSign(signer as Signer);
}

function signerPublicKey(signer: AgentVaultTransactionSigner | undefined): PublicKey | null {
  if (!signer?.publicKey) {
    return null;
  }
  return signer.publicKey instanceof PublicKey ? signer.publicKey : new PublicKey(signer.publicKey);
}
