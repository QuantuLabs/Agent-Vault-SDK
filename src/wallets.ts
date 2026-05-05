import { PublicKey, SystemProgram, TransactionInstruction, type AccountInfo, type Connection } from "@solana/web3.js";
import { compareGlobalConfigToManifest, parseGlobalConfig, parseVaultConfig, parseWallet } from "./accounts.js";
import {
  BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  DEVNET_RELEASE_MANIFEST,
  NATIVE_MINT_ID,
  SPL_TOKEN_SYNC_NATIVE_TAG,
  TOKEN_PROGRAM_ID,
  WALLET_LENGTH,
} from "./constants.js";
import { AgentVaultInstructions } from "./instructions.js";
import { executeTransaction } from "./transactions.js";
import { toPublicKey } from "./codec.js";
import type {
  AgentVaultReleaseManifest,
  AgentVaultTransactionSigner,
  BuildTransactionOptions,
  DeploymentVerification,
  ExecuteWalletOptions,
  ExecuteCpiCheckedParams,
  FundWalletOptions,
  ListWalletsOptions,
  PublicKeyish,
  SendWalletOptions,
  SetupWalletInstructionsOptions,
  SetupWalletInstructionsPlan,
  SetupWalletOptions,
  SetupWalletPlan,
  TokenWalletOptions,
  TransferSplParams,
  U64Input,
  VaultConfig,
  WalletActionOptions,
  WalletActionPlan,
  WalletOverview,
  WalletRecord,
} from "./types.js";

const DEFAULT_LIST_LIMIT = 100;
const DEFAULT_CHUNK_SIZE = 100;
const UPGRADEABLE_LOADER_PROGRAM_TAG = 2;
const UPGRADEABLE_LOADER_PROGRAMDATA_TAG = 3;
const PROGRAMDATA_METADATA_LENGTH = 45;
const MAINNET_BETA_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

export class AgentVaultWalletsClient {
  readonly instructions: AgentVaultInstructions;

  constructor(
    private readonly connection: Connection,
    params: {
      programId?: PublicKeyish;
      registryProgram?: PublicKeyish;
      releaseManifest?: AgentVaultReleaseManifest;
      signer?: AgentVaultTransactionSigner;
      allowUnverifiedDeployment?: boolean;
    } = {},
  ) {
    this.signer = params.signer;
    this.allowUnverifiedDeployment = params.allowUnverifiedDeployment ?? false;
    this.instructions = new AgentVaultInstructions(params);
  }

  private readonly signer: AgentVaultTransactionSigner | undefined;
  private readonly allowUnverifiedDeployment: boolean;

  get pdas() {
    return this.instructions.pdas;
  }

  address(agentAsset: PublicKeyish, index: number): PublicKey {
    return this.pdas.wallet(agentAsset, index)[0];
  }

  ataAddress(
    agentAsset: PublicKeyish,
    index: number,
    mint: PublicKeyish,
    tokenProgram: PublicKeyish = TOKEN_PROGRAM_ID,
  ): PublicKey {
    return this.pdas.walletAta(this.address(agentAsset, index), mint, tokenProgram)[0];
  }

  async getVault(agentAsset: PublicKeyish): Promise<VaultConfig | null> {
    const address = this.pdas.vaultConfig(agentAsset)[0];
    const info = await this.connection.getAccountInfo(address);
    if (!info) {
      return null;
    }
    if (!info.owner.equals(this.instructions.programId)) {
      if (info.owner.equals(SystemProgram.programId) && info.data.length === 0) {
        return null;
      }
      throw new Error(`vault config owner mismatch at ${address.toBase58()}`);
    }
    return parseVaultConfig(address, Buffer.from(info.data));
  }

  async get(agentAsset: PublicKeyish, index: number): Promise<WalletRecord> {
    const asset = toPublicKey(agentAsset);
    const address = this.pdas.wallet(asset, index)[0];
    const info = await this.connection.getAccountInfo(address);
    return this.recordFromAccount(asset, index, address, info);
  }

  async list(agentAsset: PublicKeyish, options: ListWalletsOptions = {}): Promise<WalletRecord[]> {
    const asset = toPublicKey(agentAsset);
    const startIndex = validateNonNegativeInteger(options.startIndex ?? 0, "startIndex");
    const limit = validateNonNegativeInteger(options.limit ?? DEFAULT_LIST_LIMIT, "limit");
    const chunkSize = validateChunkSize(options.chunkSize ?? DEFAULT_CHUNK_SIZE);
    const vault = await this.getVault(asset);
    if (!vault) {
      return [];
    }
    const endIndex = Math.min(vault.walletCount, startIndex + limit);
    const records: WalletRecord[] = [];

    for (let cursor = startIndex; cursor < endIndex; cursor += chunkSize) {
      const chunkEnd = Math.min(endIndex, cursor + chunkSize);
      const addresses: PublicKey[] = [];
      for (let index = cursor; index < chunkEnd; index += 1) {
        addresses.push(this.pdas.wallet(asset, index)[0]);
      }
      const accounts = await this.connection.getMultipleAccountsInfo(addresses);
      for (let offset = 0; offset < accounts.length; offset += 1) {
        const index = cursor + offset;
        const address = addresses[offset];
        if (!address) {
          continue;
        }
        const record = this.recordFromAccount(asset, index, address, accounts[offset] ?? null);
        if (options.includeClosed || record.exists || record.dataStatus === "invalid") {
          records.push(record);
        }
      }
    }

    return records;
  }

  async overview(agentAsset: PublicKeyish, options: ListWalletsOptions = {}): Promise<WalletOverview> {
    const vault = await this.getVault(agentAsset);
    if (!vault) {
      return {
        vault: null,
        wallets: [],
        nextIndex: null,
      };
    }
    return {
      vault,
      wallets: await this.list(agentAsset, options),
      nextIndex: vault.walletCount,
    };
  }

  async setup(
    agentAsset: PublicKeyish,
    holder: PublicKeyish,
    options: SetupWalletOptions = {},
  ): Promise<SetupWalletPlan> {
    const setup = await this.buildSetupInstructions(agentAsset, holder, options);
    const transactionOptions: BuildTransactionOptions = {
      feePayer: options.feePayer ?? holder,
      instructions: setup.instructions,
    };
    applyTransactionOptions(transactionOptions, options);
    await this.assertWriteAllowed(options);
    const prepared = await executeTransaction(this.connection, transactionOptions, this.signer);

    return {
      ...setup,
      ...prepared,
    };
  }

  async fund(
    agentAsset: PublicKeyish,
    options: FundWalletOptions,
  ): Promise<WalletActionPlan> {
    return this.prepareAction(
      this.instructions.depositSol(agentAsset, options.wallet, options.payer, options.amount),
      options.payer,
      options,
    );
  }

  async send(agentAsset: PublicKeyish, options: SendWalletOptions): Promise<WalletActionPlan> {
    if (options.mint === undefined) {
      const instruction = typeof options.to === "number"
        ? this.instructions.transferSol(agentAsset, options.holder, options.from, options.to, options.amount)
        : this.instructions.withdrawSol(agentAsset, options.holder, options.from, options.amount, options.to);
      return this.prepareAction(instruction, options.holder, options);
    }

    if (options.decimals === undefined) {
      throw new Error("decimals is required for token transfers");
    }
    const tokenProgram = options.tokenProgram ?? TOKEN_PROGRAM_ID;
    const source = options.source ?? this.ataAddress(agentAsset, options.from, options.mint, tokenProgram);
    const destination = options.destination
      ?? (typeof options.to === "number"
        ? this.ataAddress(agentAsset, options.to, options.mint, tokenProgram)
        : options.to);
    const params: TransferSplParams = {
      mint: options.mint,
      source,
      destination,
      amount: options.amount,
      decimals: options.decimals,
    };
    if (options.tokenProgram !== undefined) {
      params.tokenProgram = options.tokenProgram;
    }
    if (options.expectedFee !== undefined) {
      params.expectedFee = options.expectedFee;
    }

    return this.prepareAction(
      this.instructions.transferSpl(agentAsset, options.holder, options.from, params),
      options.holder,
      options,
    );
  }

  async token(agentAsset: PublicKeyish, options: TokenWalletOptions): Promise<WalletActionPlan> {
    if (options.action === "wrapSol") {
      const wsolAta = this.ataAddress(agentAsset, options.wallet, NATIVE_MINT_ID, TOKEN_PROGRAM_ID);
      return this.prepareActions(
        [
          this.instructions.wrapSol(agentAsset, options.holder, options.wallet, options.amount),
          syncNativeInstruction(wsolAta),
        ],
        options.holder,
        options,
      );
    }
    if (options.action === "unwrapSol") {
      return this.prepareAction(
        this.instructions.unwrapSol(agentAsset, options.holder, options.wallet),
        options.holder,
        options,
      );
    }
    if (options.action === "createAta") {
      const instruction = options.tokenProgram === undefined
        ? this.instructions.createAta(agentAsset, options.holder, options.wallet, options.mint)
        : this.instructions.createAta(agentAsset, options.holder, options.wallet, options.mint, options.tokenProgram);
      return this.prepareAction(instruction, options.holder, options);
    }
    return this.prepareAction(
      this.instructions.closeAta(
        agentAsset,
        options.holder,
        options.wallet,
        options.mint,
        options.tokenProgram ?? TOKEN_PROGRAM_ID,
        options.rentReceiver,
      ),
      options.holder,
      options,
    );
  }

  async execute(agentAsset: PublicKeyish, options: ExecuteWalletOptions): Promise<WalletActionPlan> {
    const params: ExecuteCpiCheckedParams = {
      walletMetaIndex: options.walletMetaIndex,
      targetProgram: options.targetProgram,
      targetAccounts: options.targetAccounts,
      targetInstructionData: options.targetInstructionData,
      postCheckCount: options.postCheckCount,
      postCheckData: options.postCheckData,
    };
    return this.prepareAction(
      this.instructions.executeCpiChecked(agentAsset, options.holder, options.wallet, params),
      options.holder,
      options,
    );
  }

  async verifyDeployment(manifest: AgentVaultReleaseManifest = this.instructions.releaseManifest): Promise<DeploymentVerification> {
    const expectedProgramId = new PublicKey(manifest.program.id);
    if (!expectedProgramId.equals(this.instructions.programId)) {
      return {
        ok: false,
        status: "mismatch",
        issues: [`program id mismatch: expected ${manifest.program.id}, got ${this.instructions.programId.toBase58()}`],
      };
    }

    const programInfo = await this.connection.getAccountInfo(expectedProgramId);
    if (!programInfo) {
      return {
        ok: false,
        status: "missing",
        issues: [`program missing at ${expectedProgramId.toBase58()}`],
      };
    }
    const deploymentIssues: string[] = [];
    if (!programInfo.executable) {
      deploymentIssues.push(`program account is not executable at ${expectedProgramId.toBase58()}`);
    }
    if (manifest.deploymentStatus !== "deployed") {
      deploymentIssues.push(`manifest deployment status is ${manifest.deploymentStatus}`);
    }
    deploymentIssues.push(...(await this.verifyProgramData(programInfo, manifest)));

    const globalConfig = this.pdas.globalConfig()[0];
    if (globalConfig.toBase58() !== manifest.program.globalConfigPda) {
      deploymentIssues.push(`global config PDA mismatch: expected ${manifest.program.globalConfigPda}, got ${globalConfig.toBase58()}`);
    }
    const info = await this.connection.getAccountInfo(globalConfig);
    if (!info) {
      return {
        ok: false,
        status: "missing",
        issues: [`global config missing at ${globalConfig.toBase58()}`],
      };
    }
    if (info.owner.equals(SystemProgram.programId) && info.data.length === 0) {
      return {
        ok: false,
        status: "missing",
        issues: [`global config uninitialized at ${globalConfig.toBase58()}`],
      };
    }
    if (!info.owner.equals(this.instructions.programId)) {
      deploymentIssues.push(`global config owner mismatch: expected ${this.instructions.programId.toBase58()}, got ${info.owner.toBase58()}`);
    }
    let parsed: ReturnType<typeof parseGlobalConfig>;
    try {
      parsed = parseGlobalConfig(Buffer.from(info.data));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        status: "mismatch",
        issues: [...deploymentIssues, `global config parse failed: ${reason}`],
      };
    }
    if (parsed.bump !== manifest.program.globalConfigBump) {
      deploymentIssues.push(`global config bump mismatch: expected ${manifest.program.globalConfigBump}, got ${parsed.bump}`);
    }
    const issues = [...deploymentIssues, ...compareGlobalConfigToManifest(parsed, manifest)];
    const verification: DeploymentVerification = {
      ok: issues.length === 0,
      status: issues.length === 0 ? "verified" : "mismatch",
      issues,
    };
    return verification;
  }

  private async verifyProgramData(
    programInfo: AccountInfo<Buffer>,
    manifest: AgentVaultReleaseManifest,
  ): Promise<string[]> {
    const issues: string[] = [];
    if (!programInfo.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID)) {
      return [`program account is not owned by the BPF upgradeable loader`];
    }
    const programData = Buffer.from(programInfo.data);
    if (programData.length < 36) {
      return [`program account data is too short for upgradeable loader state`];
    }
    if (programData.readUInt32LE(0) !== UPGRADEABLE_LOADER_PROGRAM_TAG) {
      return [`program account is not an upgradeable Program state`];
    }

    const programDataAddress = new PublicKey(programData.subarray(4, 36));
    const expectedProgramDataAddress = manifest.deploymentVerification?.programDataAddress;
    if (expectedProgramDataAddress !== undefined && programDataAddress.toBase58() !== expectedProgramDataAddress) {
      issues.push(`program data address mismatch: expected ${expectedProgramDataAddress}, got ${programDataAddress.toBase58()}`);
    }

    const programDataInfo = await this.connection.getAccountInfo(programDataAddress);
    if (!programDataInfo) {
      issues.push(`program data account missing at ${programDataAddress.toBase58()}`);
      return issues;
    }
    if (!programDataInfo.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID)) {
      issues.push(`program data account is not owned by the BPF upgradeable loader`);
    }

    const data = Buffer.from(programDataInfo.data);
    if (data.length < PROGRAMDATA_METADATA_LENGTH) {
      issues.push(`program data account is too short for upgradeable loader metadata`);
      return issues;
    }
    if (data.readUInt32LE(0) !== UPGRADEABLE_LOADER_PROGRAMDATA_TAG) {
      issues.push(`program data account is not an upgradeable ProgramData state`);
      return issues;
    }

    const elfBytes = data.subarray(PROGRAMDATA_METADATA_LENGTH);
    const expectedProgramDataSize =
      manifest.deploymentVerification?.programDataSizeBytes ?? manifest.program.sbfElfSizeBytes;
    if (elfBytes.length !== expectedProgramDataSize) {
      issues.push(`program data size mismatch: expected ${expectedProgramDataSize}, got ${elfBytes.length}`);
    }
    const actualHash = await sha256Hex(elfBytes);
    const expectedHash = manifest.deploymentVerification?.programDataSha256 ?? manifest.program.sbfElfSha256;
    if (actualHash !== expectedHash) {
      issues.push(`program data sha256 mismatch: expected ${expectedHash}, got ${actualHash}`);
    }

    const expectedUpgradeAuthority = manifest.deploymentVerification?.upgradeAuthority;
    if (expectedUpgradeAuthority !== undefined) {
      const upgradeAuthority = readProgramDataUpgradeAuthority(data);
      if (upgradeAuthority === undefined) {
        issues.push(`program data upgrade authority option is invalid`);
        return issues;
      }
      const actual = upgradeAuthority?.toBase58() ?? null;
      if (actual !== expectedUpgradeAuthority) {
        issues.push(`upgrade authority mismatch: expected ${expectedUpgradeAuthority}, got ${actual ?? "none"}`);
      }
    }

    return issues;
  }

  private async buildSetupInstructions(
    agentAsset: PublicKeyish,
    holder: PublicKeyish,
    options: SetupWalletInstructionsOptions = {},
  ): Promise<SetupWalletInstructionsPlan> {
    const asset = toPublicKey(agentAsset);
    const vault = await this.getVault(asset);
    const includeVaultInit = options.includeVaultInit ?? "auto";
    const labels = options.labels ?? [""];

    if (!vault && includeVaultInit === "never") {
      throw new Error("vault config not found and includeVaultInit is set to never");
    }

    const instructions: TransactionInstruction[] = [];
    const shouldInitVault = includeVaultInit === "always" || (!vault && includeVaultInit === "auto");
    if (shouldInitVault) {
      instructions.push(this.instructions.initVaultConfig(asset, holder));
    }

    const nextIndex = vault?.walletCount ?? 0;
    const walletAddresses: PublicKey[] = [];
    for (let offset = 0; offset < labels.length; offset += 1) {
      const index = nextIndex + offset;
      const label = labels[offset] ?? "";
      walletAddresses.push(this.address(asset, index));
      instructions.push(this.instructions.createWallet(asset, holder, index, label));
    }

    return {
      agentAsset: asset,
      vaultExists: vault !== null,
      nextIndex,
      walletAddresses,
      instructions,
    };
  }

  private async prepareAction(
    instruction: TransactionInstruction,
    defaultFeePayer: PublicKeyish,
    options: WalletActionOptions,
  ): Promise<WalletActionPlan> {
    return this.prepareActions([instruction], defaultFeePayer, options);
  }

  private async prepareActions(
    instructions: TransactionInstruction[],
    defaultFeePayer: PublicKeyish,
    options: WalletActionOptions,
  ): Promise<WalletActionPlan> {
    const transactionOptions: BuildTransactionOptions = {
      feePayer: options.feePayer ?? defaultFeePayer,
      instructions,
    };
    applyTransactionOptions(transactionOptions, options);
    await this.assertWriteAllowed(options);

    return {
      instruction: instructions[0] as TransactionInstruction,
      instructions,
      ...(await executeTransaction(this.connection, transactionOptions, this.signer)),
    };
  }

  private async assertWriteAllowed(options: WalletActionOptions): Promise<void> {
    if (options.send === false && options.sign === false) {
      return;
    }
    const manifest = this.instructions.releaseManifest;
    const genesisHash = await this.connection.getGenesisHash();
    if (manifest.cluster === "mainnet" || genesisHash === MAINNET_BETA_GENESIS_HASH) {
      throw new Error("mainnet writes require canonical deployment verification and cannot use allowUnverifiedDeployment");
    }
    if (options.allowUnverifiedDeployment || this.allowUnverifiedDeployment) {
      return;
    }
    if (manifest.deploymentStatus !== "deployed") {
      throw new Error(
        `Agent Vault ${manifest.cluster} manifest is ${manifest.deploymentStatus}; verify deployment or pass allowUnverifiedDeployment for local/devnet testing`,
      );
    }
    const verification = await this.verifyDeployment();
    if (!verification.ok) {
      throw new Error(`Agent Vault deployment verification failed: ${verification.issues.join("; ")}`);
    }
  }

  private recordFromAccount(
    agentAsset: PublicKey,
    index: number,
    address: PublicKey,
    info: AccountInfo<Buffer> | null,
  ): WalletRecord {
    if (!info) {
      return {
        agentAsset,
        index,
        address,
        exists: false,
        dataStatus: "closed",
        label: null,
        lamports: 0,
        account: null,
        rawAccount: null,
      };
    }
    if (info.owner.equals(this.instructions.programId) && info.data.length === WALLET_LENGTH) {
      let wallet;
      try {
        wallet = parseWallet(Buffer.from(info.data));
      } catch {
        return {
          agentAsset,
          index,
          address,
          exists: false,
          dataStatus: "invalid",
          label: null,
          lamports: info.lamports,
          account: null,
          rawAccount: info,
        };
      }
      if (wallet.index !== index) {
        return {
          agentAsset,
          index,
          address,
          exists: false,
          dataStatus: "invalid",
          label: null,
          lamports: info.lamports,
          account: null,
          rawAccount: info,
        };
      }
      return {
        agentAsset,
        index,
        address,
        exists: true,
        dataStatus: wallet.isActive ? "active" : wallet.isRecoveryOnly ? "recovery" : "invalid",
        label: wallet.label,
        lamports: info.lamports,
        account: wallet,
        rawAccount: info,
      };
    }
    const dusted = info.owner.equals(SystemProgram.programId) && info.data.length === 0;
    return {
      agentAsset,
      index,
      address,
      exists: false,
      dataStatus: dusted ? "dusted" : "invalid",
      label: null,
      lamports: info.lamports,
      account: null,
      rawAccount: info,
    };
  }
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(data));
    return Buffer.from(digest).toString("hex");
  }
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(data).digest("hex");
}

function readProgramDataUpgradeAuthority(data: Buffer): PublicKey | null | undefined {
  const option = data[12];
  if (option === 0) {
    return null;
  }
  if (option !== 1 || data.length < PROGRAMDATA_METADATA_LENGTH) {
    return undefined;
  }
  return new PublicKey(data.subarray(13, 45));
}

function applyTransactionOptions(target: BuildTransactionOptions, options: WalletActionOptions): void {
  if (options.recentBlockhash !== undefined) {
    target.recentBlockhash = options.recentBlockhash;
  }
  if (options.signer !== undefined) {
    target.signer = options.signer;
  }
  if (options.signers !== undefined) {
    target.signers = options.signers;
  }
  if (options.sign !== undefined) {
    target.sign = options.sign;
  }
  if (options.send !== undefined) {
    target.send = options.send;
  }
  if (options.commitment !== undefined) {
    target.commitment = options.commitment;
  }
  if (options.sendOptions !== undefined) {
    target.sendOptions = options.sendOptions;
  }
}

function syncNativeInstruction(wsolAccount: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [{ pubkey: wsolAccount, isSigner: false, isWritable: true }],
    data: Buffer.from([SPL_TOKEN_SYNC_NATIVE_TAG]),
  });
}

function validateNonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer`);
  }
  return value;
}

function validateChunkSize(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > DEFAULT_CHUNK_SIZE) {
    throw new RangeError(`chunkSize must be an integer between 1 and ${DEFAULT_CHUNK_SIZE}`);
  }
  return value;
}
