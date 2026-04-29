import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  type Transaction,
} from "@solana/web3.js";
import { SolanaSDK } from "8004-solana";
import {
  AGENT_VAULT_PROGRAM_ID,
  AgentVaultClient,
  DEVNET_RELEASE_MANIFEST,
  executeTransaction,
} from "../src/index.js";

const DEFAULT_RPC_URL = "https://api.devnet.solana.com";
const MIN_BALANCE_LAMPORTS = 80_000_000;
const PROGRAM_RENT_LAMPORTS = 1_031_806_080;

async function main(): Promise<void> {
  const rpcUrl = process.env.SOLANA_RPC_URL ?? DEFAULT_RPC_URL;
  const keypairPath = expandPath(process.env.AGENT_VAULT_E2E_KEYPAIR ?? "~/.config/solana/id.json");
  const send = process.env.AGENT_VAULT_E2E_SEND === "1";
  const allowUnverifiedDeployment = process.env.AGENT_VAULT_ALLOW_UNVERIFIED === "1";
  const initGlobal = process.env.AGENT_VAULT_INIT_GLOBAL === "1";

  const signer = loadKeypair(keypairPath);
  const connection = new Connection(rpcUrl, "confirmed");
  const identity = new SolanaSDK({
    cluster: "devnet",
    rpcUrl,
    signer,
  });
  const vault = AgentVaultClient.devnet({
    connection,
    identity,
    signer,
    allowUnverifiedDeployment,
  });

  console.log(`rpc: ${rpcUrl}`);
  console.log(`signer: ${signer.publicKey.toBase58()}`);
  console.log(`mode: ${send ? "send" : "preflight-only"}`);

  const balance = await connection.getBalance(signer.publicKey);
  console.log(`balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  if (send && balance < MIN_BALANCE_LAMPORTS) {
    throw new Error(`devnet signer needs at least ${MIN_BALANCE_LAMPORTS / LAMPORTS_PER_SOL} SOL for e2e writes`);
  }
  if (!send && balance < MIN_BALANCE_LAMPORTS) {
    console.log(`balance warning: send mode needs at least ${MIN_BALANCE_LAMPORTS / LAMPORTS_PER_SOL} SOL`);
  }

  await requireAccount(
    connection,
    DEVNET_RELEASE_MANIFEST.expectedGlobalConfig.registryProgram,
    "8004 registry program",
    { executable: true },
  );
  await requireAccount(
    connection,
    DEVNET_RELEASE_MANIFEST.expectedGlobalConfig.collection,
    "8004 base collection",
  );

  const programInfo = await connection.getAccountInfo(AGENT_VAULT_PROGRAM_ID);
  if (!programInfo) {
    throw new Error(
      `Agent Vault program missing at ${AGENT_VAULT_PROGRAM_ID.toBase58()}. ` +
      `Deploy target/deploy/agent_vault.so first; current rent estimate is ${PROGRAM_RENT_LAMPORTS / LAMPORTS_PER_SOL} SOL plus buffer.`,
    );
  }
  if (!programInfo.executable) {
    throw new Error(`Agent Vault account is not executable at ${AGENT_VAULT_PROGRAM_ID.toBase58()}`);
  }

  let verification = await vault.wallets.verifyDeployment();
  if (!verification.ok && initGlobal && send) {
    await initializeGlobalConfig(connection, vault, signer);
    verification = await vault.wallets.verifyDeployment();
  }
  if (!verification.ok) {
    throw new Error(`Agent Vault deployment verification failed: ${verification.issues.join("; ")}`);
  }

  if (!send) {
    console.log("preflight passed; set AGENT_VAULT_E2E_SEND=1 to run the onchain write flow");
    return;
  }

  const uri = `ipfs://agent-vault-sdk-e2e-${Date.now()}`;
  const identityResult = await vault.identities.create({ uri, atomEnabled: false });
  const agentAsset = identityResult.agentAsset;
  console.log(`agent asset: ${agentAsset.toBase58()}`);

  const setupPreview = await vault.wallets.setup(agentAsset, signer.publicKey, {
    labels: ["treasury", "defi"],
    send: false,
    allowUnverifiedDeployment,
  });
  await simulate(connection, setupPreview.transaction, "wallets.setup");
  const setup = await vault.wallets.setup(agentAsset, signer.publicKey, {
    labels: ["treasury", "defi"],
    allowUnverifiedDeployment,
  });
  assert.ok(setup.signature, "setup signature missing");
  console.log(`setup: ${setup.signature}`);

  const wallets = await vault.wallets.list(agentAsset, { limit: 10 });
  assert.equal(wallets.length, 2);
  assert.equal(wallets[0]?.label, "treasury");
  assert.equal(wallets[1]?.label, "defi");

  const fundPreview = await vault.wallets.fund(agentAsset, {
    wallet: 0,
    payer: signer.publicKey,
    amount: 20_000n,
    send: false,
    allowUnverifiedDeployment,
  });
  await simulate(connection, fundPreview.transaction, "wallets.fund");
  const fund = await vault.wallets.fund(agentAsset, {
    wallet: 0,
    payer: signer.publicKey,
    amount: 20_000n,
    allowUnverifiedDeployment,
  });
  assert.ok(fund.signature, "fund signature missing");
  console.log(`fund: ${fund.signature}`);

  const internalPreview = await vault.wallets.send(agentAsset, {
    holder: signer.publicKey,
    from: 0,
    to: 1,
    amount: 5_000n,
    send: false,
    allowUnverifiedDeployment,
  });
  await simulate(connection, internalPreview.transaction, "wallets.send internal");
  const internal = await vault.wallets.send(agentAsset, {
    holder: signer.publicKey,
    from: 0,
    to: 1,
    amount: 5_000n,
    allowUnverifiedDeployment,
  });
  assert.ok(internal.signature, "internal transfer signature missing");
  console.log(`internal transfer: ${internal.signature}`);

  const recipient = signer.publicKey;
  const withdrawPreview = await vault.wallets.send(agentAsset, {
    holder: signer.publicKey,
    from: 1,
    to: recipient,
    amount: 1_000n,
    send: false,
    allowUnverifiedDeployment,
  });
  await simulate(connection, withdrawPreview.transaction, "wallets.send withdraw");
  const withdraw = await vault.wallets.send(agentAsset, {
    holder: signer.publicKey,
    from: 1,
    to: recipient,
    amount: 1_000n,
    allowUnverifiedDeployment,
  });
  assert.ok(withdraw.signature, "withdraw signature missing");
  console.log(`withdraw: ${withdraw.signature}`);

  const overview = await vault.wallets.overview(agentAsset, { limit: 10 });
  assert.equal(overview.wallets.length, 2);
  console.log("devnet e2e completed");
}

async function initializeGlobalConfig(
  connection: Connection,
  vault: AgentVaultClient,
  signer: Keypair,
): Promise<void> {
  const ix = vault.wallets.instructions.initializeGlobalConfig({
    initializer: signer.publicKey,
  });
  const preview = await executeTransaction(connection, {
    feePayer: signer.publicKey,
    instructions: [ix],
    signer,
    send: false,
  });
  await simulate(connection, preview.transaction, "initializeGlobalConfig");
  const sent = await executeTransaction(connection, {
    feePayer: signer.publicKey,
    instructions: [ix],
    signer,
  });
  assert.ok(sent.signature, "global config init signature missing");
  console.log(`global config init: ${sent.signature}`);
}

async function requireAccount(
  connection: Connection,
  address: string,
  label: string,
  options: { executable?: boolean } = {},
): Promise<void> {
  const publicKey = new PublicKey(address);
  const info = await connection.getAccountInfo(publicKey);
  if (!info) {
    throw new Error(`${label} missing at ${publicKey.toBase58()}`);
  }
  if (options.executable !== undefined && info.executable !== options.executable) {
    throw new Error(`${label} executable mismatch at ${publicKey.toBase58()}`);
  }
}

async function simulate(connection: Connection, transaction: Transaction, label: string): Promise<void> {
  const result = await connection.simulateTransaction(transaction);
  if (result.value.err) {
    throw new Error(`${label} simulation failed: ${JSON.stringify(result.value.err)} logs=${JSON.stringify(result.value.logs)}`);
  }
  console.log(`${label} simulation units: ${result.value.unitsConsumed ?? "unknown"}`);
}

function loadKeypair(path: string): Keypair {
  if (!existsSync(path)) {
    throw new Error(`keypair not found: ${path}`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

function expandPath(path: string): string {
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/")) {
    return resolve(homedir(), path.slice(2));
  }
  return resolve(path);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
