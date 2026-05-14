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

  const signers = resolveSigners(options, defaultSigner);
  const shouldSign = options.sign !== false && signers.length > 0;
  const transaction = buildTransaction({
    ...options,
    recentBlockhash: blockhash,
  });

  if (shouldSign) {
    await signTransaction(transaction, signers);
  }

  return {
    transaction,
    blockhash,
    lastValidBlockHeight,
    signed: shouldSign,
    signer: signerPublicKey(signers[0]),
    signers: signerPublicKeys(signers),
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
  if (confirmation.value.err !== null) {
    throw new Error(`transaction ${signature} failed confirmation: ${JSON.stringify(confirmation.value.err)}`);
  }

  return {
    ...prepared,
    sent: true,
    signature,
    confirmation,
  };
}

function resolveSigners(options: BuildTransactionOptions, defaultSigner?: AgentVaultTransactionSigner): AgentVaultTransactionSigner[] {
  const signers: AgentVaultTransactionSigner[] = [];
  const primary = options.signer ?? defaultSigner;
  if (primary !== undefined) {
    signers.push(primary);
  }
  if (options.signers !== undefined) {
    signers.push(...options.signers);
  }
  return dedupeSigners(signers);
}

function dedupeSigners(signers: AgentVaultTransactionSigner[]): AgentVaultTransactionSigner[] {
  const seen = new Set<string>();
  const out: AgentVaultTransactionSigner[] = [];
  for (const signer of signers) {
    const key = signerPublicKey(signer)?.toBase58();
    if (key !== undefined) {
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
    }
    out.push(signer);
  }
  return out;
}

async function signTransaction(transaction: Transaction, signers: AgentVaultTransactionSigner[]): Promise<void> {
  for (const signer of signers) {
    if ("signTransaction" in signer && typeof signer.signTransaction === "function") {
      const signed = await signer.signTransaction(transaction);
      mergeSignatures(transaction, signed);
      continue;
    }
    transaction.partialSign(signer as Signer);
  }
}

function mergeSignatures(target: Transaction, source: Transaction): void {
  for (const returned of source.signatures) {
    if (!returned.signature) {
      continue;
    }
    const existing = target.signatures.find((entry) => entry.publicKey.equals(returned.publicKey));
    if (existing) {
      existing.signature = returned.signature;
    } else {
      target.signatures.push({
        publicKey: returned.publicKey,
        signature: returned.signature,
      });
    }
  }
}

function signerPublicKey(signer: AgentVaultTransactionSigner | undefined): PublicKey | null {
  if (!signer?.publicKey) {
    return null;
  }
  return signer.publicKey instanceof PublicKey ? signer.publicKey : new PublicKey(signer.publicKey);
}

function signerPublicKeys(signers: AgentVaultTransactionSigner[]): PublicKey[] {
  return signers
    .map((signer) => signerPublicKey(signer))
    .filter((key): key is PublicKey => key !== null);
}
