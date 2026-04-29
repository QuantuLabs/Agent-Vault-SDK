import { PublicKey, SystemProgram, type AccountInfo, type Connection, type TransactionInstruction } from "@solana/web3.js";
import { compareGlobalConfigToManifest, parseGlobalConfig, parseVaultConfig, parseWallet } from "./accounts.js";
import { DEVNET_RELEASE_MANIFEST, TOKEN_PROGRAM_ID, WALLET_LENGTH } from "./constants.js";
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

export class AgentVaultWalletsClient {
  readonly instructions: AgentVaultInstructions;

  constructor(
    private readonly connection: Connection,
    params: {
      programId?: PublicKeyish;
      registryProgram?: PublicKeyish;
      releaseManifest?: AgentVaultReleaseManifest;
      signer?: AgentVaultTransactionSigner;
    } = {},
  ) {
    this.signer = params.signer;
    this.instructions = new AgentVaultInstructions(params);
  }

  private readonly signer: AgentVaultTransactionSigner | undefined;

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
    const vault = await this.getVault(asset);
    if (!vault) {
      return [];
    }
    const startIndex = options.startIndex ?? 0;
    const limit = options.limit ?? DEFAULT_LIST_LIMIT;
    const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
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
        if (options.includeClosed || record.exists) {
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
      if (options.amount === undefined) {
        throw new Error("amount is required for wrapSol");
      }
      return this.prepareAction(
        this.instructions.wrapSol(agentAsset, options.holder, options.wallet, options.amount),
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
    if (options.mint === undefined) {
      throw new Error("mint is required for token ATA actions");
    }
    if (options.action === "createAta") {
      const instruction = options.tokenProgram === undefined
        ? this.instructions.createAta(agentAsset, options.holder, options.wallet, options.mint)
        : this.instructions.createAta(agentAsset, options.holder, options.wallet, options.mint, options.tokenProgram);
      return this.prepareAction(instruction, options.holder, options);
    }
    if (options.rentReceiver === undefined) {
      throw new Error("rentReceiver is required for closeAta");
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

  async verifyDeployment(manifest: AgentVaultReleaseManifest = DEVNET_RELEASE_MANIFEST): Promise<DeploymentVerification> {
    const expectedProgramId = new PublicKey(manifest.program.id);
    if (!expectedProgramId.equals(this.instructions.programId)) {
      return {
        ok: false,
        status: "mismatch",
        issues: [`program id mismatch: expected ${manifest.program.id}, got ${this.instructions.programId.toBase58()}`],
      };
    }

    const globalConfig = this.pdas.globalConfig()[0];
    const info = await this.connection.getAccountInfo(globalConfig);
    if (!info) {
      return {
        ok: false,
        status: "missing",
        issues: [`global config missing at ${globalConfig.toBase58()}`],
      };
    }
    const parsed = parseGlobalConfig(Buffer.from(info.data));
    const issues = compareGlobalConfigToManifest(parsed, manifest);
    return {
      ok: issues.length === 0,
      status: issues.length === 0 ? "verified" : "mismatch",
      issues,
    };
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
    const transactionOptions: BuildTransactionOptions = {
      feePayer: options.feePayer ?? defaultFeePayer,
      instructions: [instruction],
    };
    applyTransactionOptions(transactionOptions, options);

    return {
      instruction,
      ...(await executeTransaction(this.connection, transactionOptions, this.signer)),
    };
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
      const wallet = parseWallet(Buffer.from(info.data));
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

function applyTransactionOptions(target: BuildTransactionOptions, options: WalletActionOptions): void {
  if (options.recentBlockhash !== undefined) {
    target.recentBlockhash = options.recentBlockhash;
  }
  if (options.signer !== undefined) {
    target.signer = options.signer;
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
