import type {
  AccountInfo,
  Commitment,
  Connection,
  PublicKey,
  RpcResponseAndContext,
  SendOptions,
  SignatureResult,
  Signer,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import type { SolanaSDK } from "8004-solana";

export type PublicKeyish = PublicKey | string | { toBase58(): string };
export type U64Input = bigint | number | string;
export type DecimalAmountInput = number | string;
export type TokenProgramKind = "tokenkeg" | "token2022";
export type AgentVaultTransactionSigner =
  | Signer
  | {
      publicKey?: PublicKey;
      signTransaction(transaction: Transaction): Promise<Transaction> | Transaction;
    };

export type AgentVaultCluster = "devnet" | "mainnet" | "localnet";

export interface AgentVaultReleaseManifest {
  schema: "agent-vault.release-manifest.v0";
  name: "Agent Vault";
  release: string;
  cluster: AgentVaultCluster;
  deploymentStatus: "candidate-not-deployed" | "deployed";
  program: {
    id: string;
    globalConfigPda: string;
    globalConfigBump: number;
    sbfElfSha256: string;
    sbfElfSizeBytes: number;
  };
  deploymentVerification?: {
    programDataAddress?: string;
    programDataSha256?: string;
    programDataSizeBytes?: number;
    upgradeAuthority?: string | null;
    upgradePolicy?: string;
  };
  expectedGlobalConfig: {
    initializer: string;
    registryProgram: string;
    collection: string;
    feeTreasury: string;
    vaultActivationFeeLamports: number;
  };
}

export type IdentitySdk = Pick<SolanaSDK, "registerAgent">;

export interface AgentVaultClientConfig {
  connection: Connection;
  programId?: PublicKeyish;
  registryProgram?: PublicKeyish;
  releaseManifest?: AgentVaultReleaseManifest;
  identity?: IdentitySdk;
  signer?: AgentVaultTransactionSigner;
  allowUnverifiedDeployment?: boolean;
}

export interface CreateIdentityParams {
  uri?: string;
  atomEnabled?: boolean;
  collectionPointer?: string;
  collectionLock?: boolean;
  skipSend?: boolean;
  signer?: PublicKey;
  assetPubkey?: PublicKey;
  options?: Record<string, unknown>;
}

export type RegisterIdentityOptions = Omit<CreateIdentityParams, "uri">;

export interface CreateIdentityResult {
  agentAsset: PublicKey;
  result: unknown;
}

export interface VaultConfig {
  address: PublicKey;
  bump: number;
  walletCount: number;
  createdAt: bigint;
}

export interface AgentWalletAccount {
  bump: number;
  index: number;
  flags: number;
  label: string;
  isActive: boolean;
  isRecoveryOnly: boolean;
}

export type WalletDataStatus = "active" | "recovery" | "closed" | "dusted" | "invalid";

export interface WalletRecord {
  agentAsset: PublicKey;
  index: number;
  address: PublicKey;
  exists: boolean;
  dataStatus: WalletDataStatus;
  label: string | null;
  lamports: number;
  account: AgentWalletAccount | null;
  rawAccount: AccountInfo<Buffer> | null;
}

export interface WalletOverview {
  vault: VaultConfig | null;
  wallets: WalletRecord[];
  nextIndex: number | null;
}

export interface AgentVaultAgentScope {
  agentAsset: PublicKey;
  wallets: AgentVaultScopedWallets;
}

export interface ListWalletsOptions {
  startIndex?: number;
  limit?: number;
  includeClosed?: boolean;
  chunkSize?: number;
}

export interface SetupWalletInstructionsOptions {
  labels?: Array<string | Uint8Array>;
  includeVaultInit?: "auto" | "always" | "never";
}

export interface TransactionPlanOptions {
  feePayer?: PublicKeyish;
  recentBlockhash?: string;
  signer?: AgentVaultTransactionSigner;
  signers?: AgentVaultTransactionSigner[];
  sign?: boolean;
  send?: boolean;
  commitment?: Commitment;
  sendOptions?: SendOptions;
  allowUnverifiedDeployment?: boolean;
}

export interface SetupWalletOptions extends SetupWalletInstructionsOptions, TransactionPlanOptions {
  holder?: PublicKeyish;
}

export interface SetupWalletInstructionsPlan {
  agentAsset: PublicKey;
  vaultExists: boolean;
  nextIndex: number;
  walletAddresses: PublicKey[];
  instructions: TransactionInstruction[];
}

export interface PreparedVaultTransaction {
  transaction: Transaction;
  blockhash: string;
  lastValidBlockHeight: number | null;
  signed: boolean;
  signer: PublicKey | null;
  signers: PublicKey[];
}

export interface ExecutedVaultTransaction extends PreparedVaultTransaction {
  sent: boolean;
  signature: string | null;
  confirmation: RpcResponseAndContext<SignatureResult> | null;
}

export interface SetupWalletPlan extends SetupWalletInstructionsPlan, ExecutedVaultTransaction {}

export type WalletActionOptions = TransactionPlanOptions;

export interface WalletActionPlan extends ExecutedVaultTransaction {
  instruction: TransactionInstruction;
  instructions: TransactionInstruction[];
}

export type SolAmountOptions =
  | {
      sol: DecimalAmountInput;
      lamports?: never;
      /** @deprecated Use `sol` for app-facing SOL amounts or `lamports` for explicit raw units. */
      amount?: never;
    }
  | {
      sol?: never;
      lamports: U64Input;
      /** @deprecated Use `sol` for app-facing SOL amounts or `lamports` for explicit raw units. */
      amount?: never;
    }
  | {
      sol?: never;
      lamports?: never;
      /** @deprecated Use `sol` for app-facing SOL amounts or `lamports` for explicit raw units. */
      amount: U64Input;
    };

export type TokenAmountOptions =
  | {
      tokens: DecimalAmountInput;
      baseUnits?: never;
      /** @deprecated Use `tokens` for app-facing token amounts or `baseUnits` for explicit raw units. */
      amount?: never;
    }
  | {
      tokens?: never;
      baseUnits: U64Input;
      /** @deprecated Use `tokens` for app-facing token amounts or `baseUnits` for explicit raw units. */
      amount?: never;
    }
  | {
      tokens?: never;
      baseUnits?: never;
      /** @deprecated Use `tokens` for app-facing token amounts or `baseUnits` for explicit raw units. */
      amount: U64Input;
    };

export type FundWalletOptions = WalletActionOptions & SolAmountOptions & {
  wallet: number;
  payer?: PublicKeyish;
};

export type SolSendWalletOptions = WalletActionOptions & SolAmountOptions & {
  holder?: PublicKeyish;
  from: number;
  to: number | PublicKeyish;
  mint?: undefined;
};

export type TokenSendWalletOptions = WalletActionOptions & TokenAmountOptions & {
  holder?: PublicKeyish;
  from: number;
  to: number | PublicKeyish;
  mint: PublicKeyish;
  decimals?: number;
  tokenProgram?: PublicKeyish;
  expectedFee?: U64Input;
  source?: PublicKeyish;
  destination?: PublicKeyish;
};

export type SendWalletOptions = SolSendWalletOptions | TokenSendWalletOptions;

export type TokenWalletOptions =
  | (WalletActionOptions & {
      action: "createAta";
      holder?: PublicKeyish;
      wallet: number;
      mint: PublicKeyish;
      tokenProgram?: PublicKeyish;
    })
  | (WalletActionOptions & {
      action: "closeAta";
      holder?: PublicKeyish;
      wallet: number;
      mint: PublicKeyish;
      tokenProgram?: PublicKeyish;
      rentReceiver?: PublicKeyish;
    })
  | (WalletActionOptions & SolAmountOptions & {
      action: "wrapSol";
      holder?: PublicKeyish;
      wallet: number;
    })
  | (WalletActionOptions & {
      action: "unwrapSol";
      holder?: PublicKeyish;
      wallet: number;
    });

export interface ExecuteWalletOptions extends ExecuteCpiCheckedParams, WalletActionOptions {
  holder?: PublicKeyish;
  wallet: number;
}

export interface AgentVaultScopedWallets {
  setup(options?: SetupWalletOptions): Promise<SetupWalletPlan>;
  list(options?: ListWalletsOptions): Promise<WalletRecord[]>;
  overview(options?: ListWalletsOptions): Promise<WalletOverview>;
  get(index: number): Promise<WalletRecord>;
  address(index: number): PublicKey;
  ataAddress(index: number, mint: PublicKeyish, tokenProgram?: PublicKeyish): PublicKey;
  fund(options: FundWalletOptions): Promise<WalletActionPlan>;
  send(options: SendWalletOptions): Promise<WalletActionPlan>;
  token(options: TokenWalletOptions): Promise<WalletActionPlan>;
  execute(options: ExecuteWalletOptions): Promise<WalletActionPlan>;
}

export interface TransferSplParams {
  mint: PublicKeyish;
  source: PublicKeyish;
  destination: PublicKeyish;
  amount: U64Input;
  decimals: number;
  tokenProgram?: PublicKeyish;
  expectedFee?: U64Input;
}

export interface ExecuteCpiCheckedParams {
  walletMetaIndex?: number;
  targetProgram: PublicKeyish;
  targetAccounts?: Array<{
    pubkey: PublicKeyish;
    isSigner?: boolean;
    isWritable?: boolean;
  }>;
  targetInstructionData?: Uint8Array;
  postCheckCount?: number;
  postCheckData: Uint8Array;
}

export interface DeploymentVerification {
  ok: boolean;
  status: "verified" | "missing" | "mismatch";
  issues: string[];
}

export interface BuildTransactionOptions {
  feePayer: PublicKeyish;
  instructions: TransactionInstruction[];
  recentBlockhash?: string;
  signer?: AgentVaultTransactionSigner;
  signers?: AgentVaultTransactionSigner[];
  sign?: boolean;
  send?: boolean;
  commitment?: Commitment;
  sendOptions?: SendOptions;
}
