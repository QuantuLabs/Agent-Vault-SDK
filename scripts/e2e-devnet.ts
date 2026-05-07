import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type Transaction,
} from "@solana/web3.js";
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID as SPL_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { SolanaSDK } from "8004-solana";
import {
  AGENT_VAULT_PROGRAM_ID,
  AGENT_VAULT_TAGS,
  AgentVaultClient,
  DEVNET_RELEASE_MANIFEST,
  GLOBAL_CONFIG_LENGTH,
  NATIVE_MINT_ID,
  TOKEN_PROGRAM_ID,
  VAULT_CONFIG_LENGTH,
  WALLET_LENGTH,
  executeTransaction,
} from "agent-vault";

const DEFAULT_RPC_URL = "https://api.devnet.solana.com";
const MIN_BALANCE_LAMPORTS = 200_000_000;
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
type CostCategory = "agent_vault" | "identity" | "aux";
const TOKEN_ACCOUNT_LENGTH = 165;
const EXPECTED_COVERAGE = new Map<number, string>([
  [AGENT_VAULT_TAGS.initializeGlobalConfig, "initialize_global_config"],
  [AGENT_VAULT_TAGS.initVaultConfig, "init_vault_config"],
  [AGENT_VAULT_TAGS.createWallet, "create_wallet"],
  [AGENT_VAULT_TAGS.updateWalletLabel, "update_wallet_label"],
  [AGENT_VAULT_TAGS.depositSol, "deposit_sol"],
  [AGENT_VAULT_TAGS.withdrawSol, "withdraw_sol"],
  [AGENT_VAULT_TAGS.transferSol, "transfer_sol"],
  [AGENT_VAULT_TAGS.closeWallet, "close_wallet"],
  [AGENT_VAULT_TAGS.reopenWalletForRecovery, "reopen_wallet_for_recovery"],
  [AGENT_VAULT_TAGS.createWalletAta, "create_wallet_ata"],
  [AGENT_VAULT_TAGS.transferSpl, "transfer_spl"],
  [AGENT_VAULT_TAGS.wrapSol, "wrap_sol"],
  [AGENT_VAULT_TAGS.unwrapSol, "unwrap_sol"],
  [AGENT_VAULT_TAGS.closeWalletAta, "close_wallet_ata"],
  [AGENT_VAULT_TAGS.executeCpiChecked, "execute_cpi_checked"],
]);

async function main(): Promise<void> {
  const rpcUrl = process.env.SOLANA_RPC_URL ?? DEFAULT_RPC_URL;
  const send = process.env.AGENT_VAULT_E2E_SEND === "1";
  const allowUnverifiedDeployment = process.env.AGENT_VAULT_ALLOW_UNVERIFIED === "1";
  const initGlobal = process.env.AGENT_VAULT_INIT_GLOBAL === "1";
  const solUsdPrice = Number(process.env.SOL_USD_PRICE ?? "0");
  const coverage = new Set<number>();
  const verifiedCoverage = new Set<number>();

  const connection = new Connection(rpcUrl, "confirmed");
  const readOnlyVault = AgentVaultClient.devnet({
    connection,
    allowUnverifiedDeployment,
  });

  console.log(`rpc: ${rpcUrl}`);
  console.log(`mode: ${send ? "send" : "preflight-only"}`);

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
      `Deploy the Agent Vault program before running SDK e2e writes.`,
    );
  }
  if (!programInfo.executable) {
    throw new Error(`Agent Vault account is not executable at ${AGENT_VAULT_PROGRAM_ID.toBase58()}`);
  }

  let verification = await readOnlyVault.wallets.verifyDeployment();
  if (!verification.ok && !send) {
    throw new Error(`Agent Vault deployment verification failed: ${verification.issues.join("; ")}`);
  }
  if (!send) {
    console.log("preflight passed; set AGENT_VAULT_E2E_SEND=1 to run the onchain write flow");
    return;
  }

  const keypairPath = expandPath(process.env.AGENT_VAULT_E2E_KEYPAIR ?? "~/.config/solana/id.json");
  const signer = loadKeypair(keypairPath);
  const costs = await CostTracker.create(connection, signer.publicKey, solUsdPrice);
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

  console.log(`signer: ${signer.publicKey.toBase58()}`);
  const balance = await connection.getBalance(signer.publicKey);
  console.log(`balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  if (balance < MIN_BALANCE_LAMPORTS) {
    throw new Error(`devnet signer needs at least ${MIN_BALANCE_LAMPORTS / LAMPORTS_PER_SOL} SOL for e2e writes`);
  }

  if (initGlobal && verification.status === "missing") {
    await initializeGlobalConfig(connection, vault, signer, coverage, costs);
    verification = await vault.wallets.verifyDeployment();
  }
  if (!verification.ok) {
    throw new Error(`Agent Vault deployment verification failed: ${verification.issues.join("; ")}`);
  }
  verifiedCoverage.add(AGENT_VAULT_TAGS.initializeGlobalConfig);

  const uri = `ipfs://agent-vault-sdk-e2e-${Date.now()}`;
  const identityResult = await costs.measure("8004 identity create", "identity", () =>
    vault.identities.register(uri, { atomEnabled: false })
  );
  const agentAsset = identityResult.agentAsset;
  console.log(`agent asset: ${agentAsset.toBase58()}`);

  const setupPreview = await vault.wallets.setup(agentAsset, signer.publicKey, {
    labels: ["treasury", "defi", "tokens", "wsol", "close"],
    send: false,
    allowUnverifiedDeployment,
  });
  await simulate(connection, setupPreview.transaction, "wallets.setup");
  const setup = await costs.measure(
    "agent_vault setup 5 wallets",
    "agent_vault",
    () => vault.wallets.setup(agentAsset, signer.publicKey, {
      labels: ["treasury", "defi", "tokens", "wsol", "close"],
      allowUnverifiedDeployment,
    }),
    {
      protocolFeeLamports: DEVNET_RELEASE_MANIFEST.expectedGlobalConfig.vaultActivationFeeLamports,
      rentLamports: costs.rent.vaultConfig + (5 * costs.rent.wallet),
    },
  );
  coverage.add(AGENT_VAULT_TAGS.initVaultConfig);
  coverage.add(AGENT_VAULT_TAGS.createWallet);
  assert.ok(setup.signature, "setup signature missing");
  console.log(`setup: ${setup.signature}`);

  const wallets = await vault.wallets.list(agentAsset, { limit: 10 });
  assert.equal(wallets.length, 5);
  assert.equal(wallets[0]?.label, "treasury");
  assert.equal(wallets[1]?.label, "defi");
  assert.equal(wallets[2]?.label, "tokens");
  assert.equal(wallets[3]?.label, "wsol");
  assert.equal(wallets[4]?.label, "close");

  await sendInstructions(connection, signer, coverage, costs, "agent_vault", "update_wallet_label", [
    vault.wallets.instructions.updateWalletLabel(agentAsset, signer.publicKey, 1, "router"),
  ], AGENT_VAULT_TAGS.updateWalletLabel);

  const fundPreview = await vault.wallets.fund(agentAsset, {
    wallet: 0,
    payer: signer.publicKey,
    sol: "0.00002",
    send: false,
    allowUnverifiedDeployment,
  });
  await simulate(connection, fundPreview.transaction, "wallets.fund");
  const fund = await costs.measure("deposit_sol", "agent_vault", () =>
    vault.wallets.fund(agentAsset, {
      wallet: 0,
      payer: signer.publicKey,
      sol: "0.00002",
      allowUnverifiedDeployment,
    })
  );
  coverage.add(AGENT_VAULT_TAGS.depositSol);
  assert.ok(fund.signature, "fund signature missing");
  console.log(`fund: ${fund.signature}`);

  const internalPreview = await vault.wallets.send(agentAsset, {
    holder: signer.publicKey,
    from: 0,
    to: 1,
    sol: "0.000005",
    send: false,
    allowUnverifiedDeployment,
  });
  await simulate(connection, internalPreview.transaction, "wallets.send internal");
  const internal = await costs.measure("transfer_sol", "agent_vault", () =>
    vault.wallets.send(agentAsset, {
      holder: signer.publicKey,
      from: 0,
      to: 1,
      sol: "0.000005",
      allowUnverifiedDeployment,
    })
  );
  coverage.add(AGENT_VAULT_TAGS.transferSol);
  assert.ok(internal.signature, "internal transfer signature missing");
  console.log(`internal transfer: ${internal.signature}`);

  const recipient = signer.publicKey;
  const withdrawPreview = await vault.wallets.send(agentAsset, {
    holder: signer.publicKey,
    from: 1,
    to: recipient,
    sol: "0.000001",
    send: false,
    allowUnverifiedDeployment,
  });
  await simulate(connection, withdrawPreview.transaction, "wallets.send withdraw");
  const withdraw = await costs.measure("withdraw_sol", "agent_vault", () =>
    vault.wallets.send(agentAsset, {
      holder: signer.publicKey,
      from: 1,
      to: recipient,
      sol: "0.000001",
      allowUnverifiedDeployment,
    })
  );
  coverage.add(AGENT_VAULT_TAGS.withdrawSol);
  assert.ok(withdraw.signature, "withdraw signature missing");
  console.log(`withdraw: ${withdraw.signature}`);

  await runTokenFlow(connection, vault, signer, agentAsset, coverage, costs);
  await runWsolFlow(connection, vault, signer, agentAsset, coverage, costs);
  await runExecuteCpiFlow(connection, vault, signer, agentAsset, coverage, costs);
  await runCloseRecoveryFlow(connection, vault, signer, agentAsset, coverage, costs);

  const overview = await vault.wallets.overview(agentAsset, { limit: 10 });
  assert.equal(overview.wallets.length, 5);
  assert.equal(overview.wallets[4]?.dataStatus, "recovery");
  assertFullCoverage(coverage, verifiedCoverage);
  costs.print();
  console.log("devnet e2e completed with Agent Vault instruction coverage via SDK");
}

async function initializeGlobalConfig(
  connection: Connection,
  vault: AgentVaultClient,
  signer: Keypair,
  coverage: Set<number>,
  costs: CostTracker,
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
  const sent = await costs.measure("initialize_global_config", "agent_vault", () => executeTransaction(connection, {
    feePayer: signer.publicKey,
    instructions: [ix],
    signer,
  }), { rentLamports: costs.rent.globalConfig });
  assert.ok(sent.signature, "global config init signature missing");
  coverage.add(AGENT_VAULT_TAGS.initializeGlobalConfig);
  console.log(`global config init: ${sent.signature}`);
}

async function runTokenFlow(
  connection: Connection,
  vault: AgentVaultClient,
  signer: Keypair,
  agentAsset: PublicKey,
  coverage: Set<number>,
  costs: CostTracker,
): Promise<void> {
  const mint = Keypair.generate();
  const mintRent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  await sendInstructions(connection, signer, coverage, costs, "aux", "aux create spl mint", [
    SystemProgram.createAccount({
      fromPubkey: signer.publicKey,
      newAccountPubkey: mint.publicKey,
      lamports: mintRent,
      space: MINT_SIZE,
      programId: SPL_TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(mint.publicKey, 6, signer.publicKey, null, SPL_TOKEN_PROGRAM_ID),
  ], null, [mint]);

  const createWalletAta = await vault.wallets.token(agentAsset, {
    action: "createAta",
    holder: signer.publicKey,
    wallet: 2,
    mint: mint.publicKey,
    send: false,
  });
  await simulate(connection, createWalletAta.transaction, "wallets.token createAta");
  const createWalletAtaSent = await costs.measure(
    "create_wallet_ata spl",
    "agent_vault",
    () => vault.wallets.token(agentAsset, {
      action: "createAta",
      holder: signer.publicKey,
      wallet: 2,
      mint: mint.publicKey,
    }),
    { rentLamports: costs.rent.tokenAccount },
  );
  coverage.add(AGENT_VAULT_TAGS.createWalletAta);
  assert.ok(createWalletAtaSent.signature, "create wallet ATA signature missing");
  console.log(`create wallet ATA: ${createWalletAtaSent.signature}`);

  const walletTokenAta = vault.wallets.ataAddress(agentAsset, 2, mint.publicKey);
  const destinationAta = getAssociatedTokenAddressSync(mint.publicKey, signer.publicKey);
  await sendInstructions(connection, signer, coverage, costs, "aux", "aux create holder token ATA", [
    createAssociatedTokenAccountInstruction(
      signer.publicKey,
      destinationAta,
      signer.publicKey,
      mint.publicKey,
      SPL_TOKEN_PROGRAM_ID,
    ),
  ], null);
  await sendInstructions(connection, signer, coverage, costs, "aux", "aux mint tokens to wallet ATA", [
    createMintToInstruction(mint.publicKey, walletTokenAta, signer.publicKey, 7n, [], SPL_TOKEN_PROGRAM_ID),
  ], null);

  const transfer = await vault.wallets.send(agentAsset, {
    holder: signer.publicKey,
    from: 2,
    to: destinationAta,
    mint: mint.publicKey,
    tokens: "0.000007",
    decimals: 6,
    send: false,
  });
  await simulate(connection, transfer.transaction, "wallets.send transferSpl");
  const transferSent = await costs.measure("transfer_spl", "agent_vault", () =>
    vault.wallets.send(agentAsset, {
      holder: signer.publicKey,
      from: 2,
      to: destinationAta,
      mint: mint.publicKey,
      tokens: "0.000007",
      decimals: 6,
    })
  );
  coverage.add(AGENT_VAULT_TAGS.transferSpl);
  assert.ok(transferSent.signature, "transfer SPL signature missing");
  console.log(`transfer SPL: ${transferSent.signature}`);

  const closeAta = await vault.wallets.token(agentAsset, {
    action: "closeAta",
    holder: signer.publicKey,
    wallet: 2,
    mint: mint.publicKey,
    rentReceiver: signer.publicKey,
    send: false,
  });
  await simulate(connection, closeAta.transaction, "wallets.token closeAta");
  const closeAtaSent = await costs.measure(
    "close_wallet_ata spl",
    "agent_vault",
    () => vault.wallets.token(agentAsset, {
      action: "closeAta",
      holder: signer.publicKey,
      wallet: 2,
      mint: mint.publicKey,
      rentReceiver: signer.publicKey,
    }),
    { recoveredRentLamports: costs.rent.tokenAccount },
  );
  coverage.add(AGENT_VAULT_TAGS.closeWalletAta);
  assert.ok(closeAtaSent.signature, "close ATA signature missing");
  console.log(`close wallet ATA: ${closeAtaSent.signature}`);
}

async function runWsolFlow(
  connection: Connection,
  vault: AgentVaultClient,
  signer: Keypair,
  agentAsset: PublicKey,
  coverage: Set<number>,
  costs: CostTracker,
): Promise<void> {
  const fundWsol = await vault.wallets.fund(agentAsset, {
    wallet: 3,
    payer: signer.publicKey,
    sol: "0.00005",
    send: false,
  });
  await simulate(connection, fundWsol.transaction, "wallets.fund wsol");
  const fundWsolSent = await costs.measure("deposit_sol wsol wallet", "agent_vault", () =>
    vault.wallets.fund(agentAsset, {
      wallet: 3,
      payer: signer.publicKey,
      sol: "0.00005",
    })
  );
  assert.ok(fundWsolSent.signature, "fund WSOL wallet signature missing");

  const createWsolAta = await vault.wallets.token(agentAsset, {
    action: "createAta",
    holder: signer.publicKey,
    wallet: 3,
    mint: NATIVE_MINT_ID,
    send: false,
  });
  await simulate(connection, createWsolAta.transaction, "wallets.token create WSOL ATA");
  const createWsolAtaSent = await costs.measure(
    "create_wallet_ata wsol",
    "agent_vault",
    () => vault.wallets.token(agentAsset, {
      action: "createAta",
      holder: signer.publicKey,
      wallet: 3,
      mint: NATIVE_MINT_ID,
    }),
    { rentLamports: costs.rent.tokenAccount },
  );
  coverage.add(AGENT_VAULT_TAGS.createWalletAta);
  assert.ok(createWsolAtaSent.signature, "create WSOL ATA signature missing");

  const wrap = await vault.wallets.token(agentAsset, {
    action: "wrapSol",
    holder: signer.publicKey,
    wallet: 3,
    sol: "0.00001",
    send: false,
  });
  await simulate(connection, wrap.transaction, "wallets.token wrapSol");
  const wrapSent = await costs.measure("wrap_sol + sync_native", "agent_vault", () =>
    vault.wallets.token(agentAsset, {
      action: "wrapSol",
      holder: signer.publicKey,
      wallet: 3,
      sol: "0.00001",
    })
  );
  coverage.add(AGENT_VAULT_TAGS.wrapSol);
  assert.ok(wrapSent.signature, "wrap SOL signature missing");
  console.log(`wrap SOL: ${wrapSent.signature}`);

  const unwrap = await vault.wallets.token(agentAsset, {
    action: "unwrapSol",
    holder: signer.publicKey,
    wallet: 3,
    send: false,
  });
  await simulate(connection, unwrap.transaction, "wallets.token unwrapSol");
  const unwrapSent = await costs.measure("unwrap_sol", "agent_vault", () =>
    vault.wallets.token(agentAsset, {
      action: "unwrapSol",
      holder: signer.publicKey,
      wallet: 3,
    })
  );
  coverage.add(AGENT_VAULT_TAGS.unwrapSol);
  assert.ok(unwrapSent.signature, "unwrap SOL signature missing");
  console.log(`unwrap SOL: ${unwrapSent.signature}`);
}

async function runExecuteCpiFlow(
  connection: Connection,
  vault: AgentVaultClient,
  signer: Keypair,
  agentAsset: PublicKey,
  coverage: Set<number>,
  costs: CostTracker,
): Promise<void> {
  const postCheckData = solMinPostCheck(0, 0n);
  const execute = await vault.wallets.execute(agentAsset, {
    holder: signer.publicKey,
    wallet: 1,
    walletMetaIndex: 0,
    targetProgram: MEMO_PROGRAM_ID,
    targetAccounts: [],
    targetInstructionData: Buffer.from("agent-vault-sdk-e2e", "utf8"),
    postCheckCount: 1,
    postCheckData,
    send: false,
  });
  await simulate(connection, execute.transaction, "wallets.execute memo");
  const executeSent = await costs.measure("execute_cpi_checked memo", "agent_vault", () =>
    vault.wallets.execute(agentAsset, {
      holder: signer.publicKey,
      wallet: 1,
      walletMetaIndex: 0,
      targetProgram: MEMO_PROGRAM_ID,
      targetAccounts: [],
      targetInstructionData: Buffer.from("agent-vault-sdk-e2e", "utf8"),
      postCheckCount: 1,
      postCheckData,
    })
  );
  coverage.add(AGENT_VAULT_TAGS.executeCpiChecked);
  assert.ok(executeSent.signature, "execute CPI signature missing");
  console.log(`execute CPI: ${executeSent.signature}`);
}

async function runCloseRecoveryFlow(
  connection: Connection,
  vault: AgentVaultClient,
  signer: Keypair,
  agentAsset: PublicKey,
  coverage: Set<number>,
  costs: CostTracker,
): Promise<void> {
  await sendInstructions(connection, signer, coverage, costs, "agent_vault", "close_wallet", [
    vault.wallets.instructions.closeWallet(agentAsset, signer.publicKey, 4, signer.publicKey),
  ], AGENT_VAULT_TAGS.closeWallet, [], { recoveredRentLamports: costs.rent.wallet });
  await sendInstructions(connection, signer, coverage, costs, "agent_vault", "reopen_wallet_for_recovery", [
    vault.wallets.instructions.reopenForRecovery(agentAsset, signer.publicKey, 4, "recovery"),
  ], AGENT_VAULT_TAGS.reopenWalletForRecovery, [], { rentLamports: costs.rent.wallet });
}

async function sendInstructions(
  connection: Connection,
  signer: Keypair,
  coverage: Set<number>,
  costs: CostTracker,
  category: CostCategory,
  label: string,
  instructions: TransactionInstruction[],
  coverageTag: number | null,
  signers: Keypair[] = [],
  costBreakdown: CostBreakdown = {},
): Promise<void> {
  const preview = await executeTransaction(connection, {
    feePayer: signer.publicKey,
    instructions,
    signer,
    signers,
    send: false,
  });
  await simulate(connection, preview.transaction, label);
  const sent = await costs.measure(label, category, () => executeTransaction(connection, {
    feePayer: signer.publicKey,
    instructions,
    signer,
    signers,
  }), costBreakdown);
  assert.ok(sent.signature, `${label} signature missing`);
  if (coverageTag !== null) {
    coverage.add(coverageTag);
  }
  console.log(`${label}: ${sent.signature}`);
}

interface CostRentEstimates {
  globalConfig: number;
  vaultConfig: number;
  wallet: number;
  tokenAccount: number;
}

interface CostBreakdown {
  protocolFeeLamports?: number;
  rentLamports?: number;
  recoveredRentLamports?: number;
  externalFeeLamports?: number;
}

class CostTracker {
  private readonly rows: Array<{
    category: CostCategory;
    label: string;
    signature: string | null;
    protocolFeeLamports: number;
    rentLamports: number;
    recoveredRentLamports: number;
    externalFeeLamports: number;
    feeLamports: number | null;
    computeUnits: number | null;
    netLamports: number;
  }> = [];

  static async create(
    connection: Connection,
    payer: PublicKey,
    solUsdPrice: number,
  ): Promise<CostTracker> {
    return new CostTracker(connection, payer, solUsdPrice, {
      globalConfig: await connection.getMinimumBalanceForRentExemption(GLOBAL_CONFIG_LENGTH),
      vaultConfig: await connection.getMinimumBalanceForRentExemption(VAULT_CONFIG_LENGTH),
      wallet: await connection.getMinimumBalanceForRentExemption(WALLET_LENGTH),
      tokenAccount: await connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_LENGTH),
    });
  }

  constructor(
    private readonly connection: Connection,
    private readonly payer: PublicKey,
    private readonly solUsdPrice: number,
    readonly rent: CostRentEstimates,
  ) {}

  async measure<T>(
    label: string,
    category: CostCategory,
    fn: () => Promise<T>,
    breakdown: CostBreakdown = {},
  ): Promise<T> {
    const before = await this.connection.getBalance(this.payer, "confirmed");
    const result = await fn();
    const signature = extractSignature(result);
    const meta = signature ? await transactionMeta(this.connection, signature) : null;
    const after = await this.connection.getBalance(this.payer, "confirmed");
    const netLamports = before - after;
    this.rows.push({
      category,
      label,
      signature,
      protocolFeeLamports: breakdown.protocolFeeLamports ?? 0,
      rentLamports: breakdown.rentLamports ?? 0,
      recoveredRentLamports: breakdown.recoveredRentLamports ?? 0,
      externalFeeLamports: breakdown.externalFeeLamports ?? 0,
      feeLamports: meta?.feeLamports ?? null,
      computeUnits: meta?.computeUnits ?? null,
      netLamports,
    });
    return result;
  }

  print(): void {
    console.log("real devnet cost report:");
    console.log("CU is full transaction CU. execute_cpi_checked rows include target-program CU; LiteSVM release tests print Agent Vault overhead and target estimates separately.");
    console.log("category | action | protocol fee SOL | rent SOL | recovered rent SOL | external fees SOL | tx fee SOL | CU | signer net SOL | signer net USD | signature");
    for (const row of this.rows) {
      console.log([
        row.category,
        row.label,
        lamportsToSol(row.protocolFeeLamports),
        lamportsToSol(row.rentLamports),
        lamportsToSol(row.recoveredRentLamports),
        lamportsToSol(row.externalFeeLamports),
        row.feeLamports === null ? "unknown" : lamportsToSol(row.feeLamports),
        row.computeUnits === null ? "unknown" : String(row.computeUnits),
        lamportsToSol(row.netLamports),
        this.usd(row.netLamports),
        row.signature ?? "",
      ].join(" | "));
    }
    this.printSubtotal("agent_vault");
  }

  private usd(lamports: number): string {
    if (!Number.isFinite(this.solUsdPrice) || this.solUsdPrice <= 0) {
      return "n/a";
    }
    return (Number(lamportsToSolNumber(lamports)) * this.solUsdPrice).toFixed(6);
  }

  private printSubtotal(category: CostCategory): void {
    let feeLamports = 0;
    let protocolFeeLamports = 0;
    let rentLamports = 0;
    let recoveredRentLamports = 0;
    let externalFeeLamports = 0;
    let netLamports = 0;
    let computeUnits = 0;
    let feeUnknown = false;
    let cuUnknown = false;
    for (const row of this.rows) {
      if (row.category !== category) {
        continue;
      }
      protocolFeeLamports += row.protocolFeeLamports;
      rentLamports += row.rentLamports;
      recoveredRentLamports += row.recoveredRentLamports;
      externalFeeLamports += row.externalFeeLamports;
      netLamports += row.netLamports;
      if (row.feeLamports === null) {
        feeUnknown = true;
      } else {
        feeLamports += row.feeLamports;
      }
      if (row.computeUnits === null) {
        cuUnknown = true;
      } else {
        computeUnits += row.computeUnits;
      }
    }
    console.log([
      `${category} subtotal`,
      lamportsToSol(protocolFeeLamports),
      lamportsToSol(rentLamports),
      lamportsToSol(recoveredRentLamports),
      lamportsToSol(externalFeeLamports),
      feeUnknown ? "unknown" : lamportsToSol(feeLamports),
      cuUnknown ? "unknown" : String(computeUnits),
      lamportsToSol(netLamports),
      this.usd(netLamports),
    ].join(" | "));
  }
}

function extractSignature(value: unknown): string | null {
  if (value && typeof value === "object" && "signature" in value) {
    const signature = (value as { signature?: unknown }).signature;
    return typeof signature === "string" && signature.length > 0 ? signature : null;
  }
  if (value && typeof value === "object" && "result" in value) {
    return extractSignature((value as { result?: unknown }).result);
  }
  return null;
}

async function transactionMeta(
  connection: Connection,
  signature: string,
): Promise<{ feeLamports: number; computeUnits: number | null } | null> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (tx?.meta) {
      return {
        feeLamports: tx.meta.fee,
        computeUnits: tx.meta.computeUnitsConsumed ?? null,
      };
    }
    await sleep(500);
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lamportsToSol(lamports: number): string {
  return lamportsToSolNumber(lamports).toFixed(9);
}

function lamportsToSolNumber(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}

function solMinPostCheck(accountIndex: number, minLamports: bigint): Buffer {
  const out = Buffer.alloc(10);
  out[0] = 0;
  out[1] = accountIndex;
  out.writeBigUInt64LE(minLamports, 2);
  return out;
}

function assertFullCoverage(coverage: Set<number>, verifiedCoverage: Set<number>): void {
  const missing = [...EXPECTED_COVERAGE.entries()]
    .filter(([tag]) => !coverage.has(tag) && !verifiedCoverage.has(tag))
    .map(([tag, name]) => `${name}(${tag})`);
  if (missing.length > 0) {
    throw new Error(`missing Agent Vault instruction coverage: ${missing.join(", ")}`);
  }
  console.log("covered Agent Vault instructions:");
  for (const [tag, name] of EXPECTED_COVERAGE.entries()) {
    const status = coverage.has(tag) ? "sent" : "verified";
    console.log(`  ${tag}: ${name} (${status})`);
  }
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
