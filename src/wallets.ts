import { PublicKey, SystemProgram, TransactionInstruction, type AccountInfo, type Connection } from "@solana/web3.js";
import { calculateEpochFee, getTransferFeeConfig, unpackMint } from "@solana/spl-token";
import { compareGlobalConfigToManifest, parseGlobalConfig, parseVaultConfig, parseWallet } from "./accounts.js";
import { solToLamports, tokensToBaseUnits } from "./amounts.js";
import {
  BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  DEVNET_RELEASE_MANIFEST,
  NATIVE_MINT_ID,
  SPL_TOKEN_SYNC_NATIVE_TAG,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  WALLET_LENGTH,
} from "./constants.js";
import { AgentVaultInstructions } from "./instructions.js";
import { executeTransaction } from "./transactions.js";
import { toPublicKey } from "./codec.js";
import type {
  AgentVaultReleaseManifest,
  AgentVaultScopedWallets,
  AgentVaultTransactionSigner,
  BuildTransactionOptions,
  DecimalAmountInput,
  DeploymentVerification,
  ExecuteWalletOptions,
  ExecuteCpiCheckedParams,
  ListAllWalletsOptions,
  ListWalletsOptions,
  PublicKeyish,
  SendWalletOptions,
  SetupWalletInstructionsOptions,
  SetupWalletInstructionsPlan,
  SetupWalletOptions,
  SetupWalletPlan,
  TokenSendWalletOptions,
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

interface NormalizedListWalletsOptions {
  startIndex: number;
  limit: number;
  chunkSize: number;
  includeClosed?: boolean;
}
const UPGRADEABLE_LOADER_PROGRAM_TAG = 2;
const UPGRADEABLE_LOADER_PROGRAMDATA_TAG = 3;
const PROGRAMDATA_METADATA_LENGTH = 45;
const MAINNET_BETA_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
type ParsedMint = ReturnType<typeof unpackMint>;

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

  for(agentAsset: PublicKeyish): AgentVaultScopedWallets {
    return new ScopedAgentVaultWalletsClient(this, agentAsset);
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
    const vault = parseVaultConfig(address, Buffer.from(info.data));
    const expectedBump = this.pdas.vaultConfig(agentAsset)[1];
    if (vault.bump !== expectedBump) {
      throw new Error(`vault config bump mismatch at ${address.toBase58()}: expected ${expectedBump}, got ${vault.bump}`);
    }
    return vault;
  }

  async get(agentAsset: PublicKeyish, index: number): Promise<WalletRecord> {
    const asset = toPublicKey(agentAsset);
    const address = this.pdas.wallet(asset, index)[0];
    const info = await this.connection.getAccountInfo(address);
    return this.recordFromAccount(asset, index, address, info);
  }

  async list(agentAsset: PublicKeyish, options: ListWalletsOptions = {}): Promise<WalletRecord[]> {
    const asset = toPublicKey(agentAsset);
    const normalized = normalizeListOptions(options);
    const vault = await this.getVault(asset);
    if (!vault) {
      return [];
    }
    return this.listFromVault(asset, vault, normalized);
  }

  async listAll(agentAsset: PublicKeyish, options: ListAllWalletsOptions = {}): Promise<WalletRecord[]> {
    const asset = toPublicKey(agentAsset);
    const vault = await this.getVault(asset);
    if (!vault) {
      return [];
    }
    return this.listFromVault(asset, vault, normalizeListAllOptions(options, vault.walletCount));
  }

  private async listFromVault(
    asset: PublicKey,
    vault: VaultConfig,
    options: NormalizedListWalletsOptions,
  ): Promise<WalletRecord[]> {
    const endIndex = Math.min(vault.walletCount, options.startIndex + options.limit);
    const records: WalletRecord[] = [];

    for (let cursor = options.startIndex; cursor < endIndex; cursor += options.chunkSize) {
      const chunkEnd = Math.min(endIndex, cursor + options.chunkSize);
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
    const asset = toPublicKey(agentAsset);
    const normalized = normalizeListOptions(options);
    const vault = await this.getVault(asset);
    if (!vault) {
      return {
        vault: null,
        wallets: [],
        nextIndex: null,
      };
    }
    return {
      vault,
      wallets: await this.listFromVault(asset, vault, normalized),
      nextIndex: vault.walletCount,
    };
  }

  async setup(agentAsset: PublicKeyish, options?: SetupWalletOptions): Promise<SetupWalletPlan>;
  async setup(agentAsset: PublicKeyish, holder: PublicKeyish, options?: SetupWalletOptions): Promise<SetupWalletPlan>;
  async setup(
    agentAsset: PublicKeyish,
    holderOrOptions?: PublicKeyish | SetupWalletOptions,
    maybeOptions: SetupWalletOptions = {},
  ): Promise<SetupWalletPlan> {
    const { holder, options } = this.normalizeSetupArgs(holderOrOptions, maybeOptions);
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

  async send(agentAsset: PublicKeyish, options: SendWalletOptions): Promise<WalletActionPlan> {
    const holder = this.resolveActor("holder", options.holder, options);
    if (options.mint === undefined) {
      const amount = resolveSolAmount(options, "SOL send amount");
      const instruction = typeof options.to === "number"
        ? this.instructions.transferSol(agentAsset, holder, options.from, options.to, amount)
        : this.instructions.withdrawSol(agentAsset, holder, options.from, amount, options.to);
      return this.prepareAction(instruction, holder, options);
    }

    const mintParams = await this.resolveTokenTransferMintParams(options);
    const amount = resolveTokenAmount(options, mintParams.decimals, "token transfer amount");
    const expectedFee = mintParams.expectedFee
      ?? (mintParams.tokenProgram.equals(TOKEN_2022_PROGRAM_ID)
        ? await this.calculateToken2022ExpectedFee(requireParsedMint(mintParams.parsedMint), amount)
        : 0n);
    const source = options.source ?? this.ataAddress(agentAsset, options.from, options.mint, mintParams.tokenProgram);
    const destination = options.destination
      ?? (typeof options.to === "number"
        ? this.ataAddress(agentAsset, options.to, options.mint, mintParams.tokenProgram)
        : options.to);
    const params: TransferSplParams = {
      mint: options.mint,
      source,
      destination,
      amount,
      decimals: mintParams.decimals,
      tokenProgram: mintParams.tokenProgram,
      expectedFee,
    };

    return this.prepareAction(
      this.instructions.transferSpl(agentAsset, holder, options.from, params),
      holder,
      options,
    );
  }

  async token(agentAsset: PublicKeyish, options: TokenWalletOptions): Promise<WalletActionPlan> {
    const holder = this.resolveActor("holder", options.holder, options);
    if (options.action === "wrapSol") {
      const wsolAta = this.ataAddress(agentAsset, options.wallet, NATIVE_MINT_ID, TOKEN_PROGRAM_ID);
      const amount = resolveSolAmount(options, "wrap SOL amount");
      return this.prepareActions(
        [
          this.instructions.wrapSol(agentAsset, holder, options.wallet, amount),
          syncNativeInstruction(wsolAta),
        ],
        holder,
        options,
      );
    }
    if (options.action === "unwrapSol") {
      return this.prepareAction(
        this.instructions.unwrapSol(agentAsset, holder, options.wallet),
        holder,
        options,
      );
    }
    if (options.action === "createAta") {
      const instruction = options.tokenProgram === undefined
        ? this.instructions.createAta(agentAsset, holder, options.wallet, options.mint)
        : this.instructions.createAta(agentAsset, holder, options.wallet, options.mint, options.tokenProgram);
      return this.prepareAction(instruction, holder, options);
    }
    return this.prepareAction(
      this.instructions.closeAta(
        agentAsset,
        holder,
        options.wallet,
        options.mint,
        options.tokenProgram ?? TOKEN_PROGRAM_ID,
        options.rentReceiver ?? holder,
      ),
      holder,
      options,
    );
  }

  async execute(agentAsset: PublicKeyish, options: ExecuteWalletOptions): Promise<WalletActionPlan> {
    const holder = this.resolveActor("holder", options.holder, options);
    const params: ExecuteCpiCheckedParams = {
      targetProgram: options.targetProgram,
      postCheckData: options.postCheckData,
    };
    if (options.walletMetaIndex !== undefined) {
      params.walletMetaIndex = options.walletMetaIndex;
    }
    if (options.targetAccounts !== undefined) {
      params.targetAccounts = options.targetAccounts;
    }
    if (options.targetInstructionData !== undefined) {
      params.targetInstructionData = options.targetInstructionData;
    }
    if (options.postCheckCount !== undefined) {
      params.postCheckCount = options.postCheckCount;
    }
    return this.prepareAction(
      this.instructions.executeCpiChecked(agentAsset, holder, options.wallet, params),
      holder,
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
      const status = deploymentIssues.length === 0 ? "missing" : "mismatch";
      return {
        ok: false,
        status,
        issues: [...deploymentIssues, `global config missing at ${globalConfig.toBase58()}`],
      };
    }
    if (info.owner.equals(SystemProgram.programId) && info.data.length === 0) {
      const status = deploymentIssues.length === 0 ? "missing" : "mismatch";
      return {
        ok: false,
        status,
        issues: [...deploymentIssues, `global config uninitialized at ${globalConfig.toBase58()}`],
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

  private normalizeSetupArgs(
    holderOrOptions: PublicKeyish | SetupWalletOptions | undefined,
    maybeOptions: SetupWalletOptions,
  ): { holder: PublicKey; options: SetupWalletOptions } {
    if (holderOrOptions === undefined || !isPublicKeyish(holderOrOptions)) {
      const options = (holderOrOptions ?? maybeOptions) as SetupWalletOptions;
      return {
        holder: this.resolveActor("holder", options.holder, options),
        options,
      };
    }
    return {
      holder: toPublicKey(holderOrOptions),
      options: maybeOptions,
    };
  }

  private resolveActor(
    label: "holder",
    explicit: PublicKeyish | undefined,
    options: WalletActionOptions,
  ): PublicKey {
    const actor = explicit
      ?? signerPublicKey(options.signer)
      ?? signerPublicKey(this.signer)
      ?? options.feePayer;
    if (actor === undefined) {
      throw new Error(`${label} is required when no signer publicKey is configured`);
    }
    return toPublicKey(actor);
  }

  private async resolveTokenTransferMintParams(
    options: TokenSendWalletOptions,
  ): Promise<{ tokenProgram: PublicKey; decimals: number; expectedFee?: U64Input; parsedMint?: ParsedMint }> {
    const explicitTokenProgram = options.tokenProgram === undefined ? undefined : toPublicKey(options.tokenProgram);
    if (
      options.decimals !== undefined
      && (explicitTokenProgram === undefined || explicitTokenProgram.equals(TOKEN_PROGRAM_ID))
    ) {
      return {
        tokenProgram: explicitTokenProgram ?? TOKEN_PROGRAM_ID,
        decimals: options.decimals,
        expectedFee: options.expectedFee ?? 0n,
      };
    }
    if (options.decimals !== undefined && explicitTokenProgram !== undefined && options.expectedFee !== undefined) {
      return {
        tokenProgram: explicitTokenProgram,
        decimals: options.decimals,
        expectedFee: options.expectedFee,
      };
    }

    const mint = toPublicKey(options.mint);
    const mintInfo = await this.connection.getAccountInfo(mint);
    if (!mintInfo) {
      throw new Error(`mint account not found: ${mint.toBase58()}`);
    }
    const tokenProgram = explicitTokenProgram ?? inferTokenProgramFromMintOwner(mintInfo.owner);
    if (!mintInfo.owner.equals(tokenProgram)) {
      throw new Error(`mint owner mismatch: expected ${tokenProgram.toBase58()}, got ${mintInfo.owner.toBase58()}`);
    }

    const parsedMint = unpackMint(mint, mintInfo, tokenProgram);
    const decimals = options.decimals ?? parsedMint.decimals;

    return {
      tokenProgram,
      decimals,
      ...(options.expectedFee === undefined ? {} : { expectedFee: options.expectedFee }),
      parsedMint,
    };
  }

  private async calculateToken2022ExpectedFee(
    mint: ParsedMint,
    amount: U64Input,
  ): Promise<bigint> {
    const transferFeeConfig = getTransferFeeConfig(mint);
    if (!transferFeeConfig) {
      return 0n;
    }
    const epochInfo = await this.connection.getEpochInfo();
    return calculateEpochFee(transferFeeConfig, BigInt(epochInfo.epoch), BigInt(amount));
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
      const expectedBump = this.pdas.wallet(agentAsset, index)[1];
      if (wallet.index !== index || wallet.bump !== expectedBump) {
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

class ScopedAgentVaultWalletsClient implements AgentVaultScopedWallets {
  readonly agentAsset: PublicKey;

  constructor(
    private readonly wallets: AgentVaultWalletsClient,
    agentAsset: PublicKeyish,
  ) {
    this.agentAsset = toPublicKey(agentAsset);
  }

  setup(options: SetupWalletOptions = {}): Promise<SetupWalletPlan> {
    return this.wallets.setup(this.agentAsset, options);
  }

  list(options: ListWalletsOptions = {}): Promise<WalletRecord[]> {
    return this.wallets.list(this.agentAsset, options);
  }

  listAll(options: ListAllWalletsOptions = {}): Promise<WalletRecord[]> {
    return this.wallets.listAll(this.agentAsset, options);
  }

  overview(options: ListWalletsOptions = {}): Promise<WalletOverview> {
    return this.wallets.overview(this.agentAsset, options);
  }

  get(index: number): Promise<WalletRecord> {
    return this.wallets.get(this.agentAsset, index);
  }

  address(index: number): PublicKey {
    return this.wallets.address(this.agentAsset, index);
  }

  ataAddress(index: number, mint: PublicKeyish, tokenProgram?: PublicKeyish): PublicKey {
    return tokenProgram === undefined
      ? this.wallets.ataAddress(this.agentAsset, index, mint)
      : this.wallets.ataAddress(this.agentAsset, index, mint, tokenProgram);
  }

  send(options: SendWalletOptions): Promise<WalletActionPlan> {
    return this.wallets.send(this.agentAsset, options);
  }

  token(options: TokenWalletOptions): Promise<WalletActionPlan> {
    return this.wallets.token(this.agentAsset, options);
  }

  execute(options: ExecuteWalletOptions): Promise<WalletActionPlan> {
    return this.wallets.execute(this.agentAsset, options);
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

function isPublicKeyish(value: unknown): value is PublicKeyish {
  if (typeof value === "string" || value instanceof PublicKey) {
    return true;
  }
  return typeof value === "object"
    && value !== null
    && "toBase58" in value
    && typeof (value as { toBase58?: unknown }).toBase58 === "function";
}

function signerPublicKey(signer: AgentVaultTransactionSigner | undefined): PublicKey | undefined {
  if (!signer?.publicKey) {
    return undefined;
  }
  return signer.publicKey instanceof PublicKey ? signer.publicKey : new PublicKey(signer.publicKey);
}

function inferTokenProgramFromMintOwner(owner: PublicKey): PublicKey {
  if (owner.equals(TOKEN_PROGRAM_ID) || owner.equals(TOKEN_2022_PROGRAM_ID)) {
    return owner;
  }
  throw new Error(`unsupported mint owner: ${owner.toBase58()}`);
}

function resolveSolAmount(
  options: { sol?: DecimalAmountInput; lamports?: U64Input; amount?: U64Input },
  label: string,
): U64Input {
  const count = countDefined(options.sol, options.lamports, options.amount);
  if (count !== 1) {
    throw new Error(`${label} requires exactly one of sol, lamports, or amount`);
  }
  if (options.sol !== undefined) {
    return solToLamports(options.sol);
  }
  return options.lamports ?? (options.amount as U64Input);
}

function resolveTokenAmount(
  options: { tokens?: DecimalAmountInput; baseUnits?: U64Input; amount?: U64Input },
  decimals: number,
  label: string,
): U64Input {
  const count = countDefined(options.tokens, options.baseUnits, options.amount);
  if (count !== 1) {
    throw new Error(`${label} requires exactly one of tokens, baseUnits, or amount`);
  }
  if (options.tokens !== undefined) {
    return tokensToBaseUnits(options.tokens, decimals);
  }
  return options.baseUnits ?? (options.amount as U64Input);
}

function countDefined(...values: unknown[]): number {
  let count = 0;
  for (const value of values) {
    if (value !== undefined) {
      count += 1;
    }
  }
  return count;
}

function requireParsedMint(mint: ParsedMint | undefined): ParsedMint {
  if (mint === undefined) {
    throw new Error("Token-2022 expected fee inference requires reading the mint account");
  }
  return mint;
}

function normalizeListOptions(options: ListWalletsOptions): NormalizedListWalletsOptions {
  const normalized: NormalizedListWalletsOptions = {
    startIndex: validateNonNegativeInteger(options.startIndex ?? 0, "startIndex"),
    limit: validateNonNegativeInteger(options.limit ?? DEFAULT_LIST_LIMIT, "limit"),
    chunkSize: validateChunkSize(options.chunkSize ?? DEFAULT_CHUNK_SIZE),
  };
  if (options.includeClosed !== undefined) {
    normalized.includeClosed = options.includeClosed;
  }
  return normalized;
}

function normalizeListAllOptions(
  options: ListAllWalletsOptions,
  walletCount: number,
): NormalizedListWalletsOptions {
  const startIndex = validateNonNegativeInteger(options.startIndex ?? 0, "startIndex");
  const normalized: NormalizedListWalletsOptions = {
    startIndex,
    limit: Math.max(0, walletCount - startIndex),
    chunkSize: validateChunkSize(options.chunkSize ?? DEFAULT_CHUNK_SIZE),
  };
  if (options.includeClosed !== undefined) {
    normalized.includeClosed = options.includeClosed;
  }
  return normalized;
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
