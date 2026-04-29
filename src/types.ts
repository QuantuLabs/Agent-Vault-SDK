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

export type PublicKeyish = PublicKey | string;
export type U64Input = bigint | number | string;
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
  sign?: boolean;
  send?: boolean;
  commitment?: Commitment;
  sendOptions?: SendOptions;
}

export interface SetupWalletOptions extends SetupWalletInstructionsOptions, TransactionPlanOptions {}

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
}

export interface FundWalletOptions extends WalletActionOptions {
  wallet: number;
  payer: PublicKeyish;
  amount: U64Input;
}

export interface SendWalletOptions extends WalletActionOptions {
  holder: PublicKeyish;
  from: number;
  to: number | PublicKeyish;
  amount: U64Input;
  mint?: PublicKeyish;
  decimals?: number;
  tokenProgram?: PublicKeyish;
  expectedFee?: U64Input;
  source?: PublicKeyish;
  destination?: PublicKeyish;
}

export type TokenWalletAction = "createAta" | "closeAta" | "wrapSol" | "unwrapSol";

export interface TokenWalletOptions extends WalletActionOptions {
  action: TokenWalletAction;
  holder: PublicKeyish;
  wallet: number;
  mint?: PublicKeyish;
  tokenProgram?: PublicKeyish;
  amount?: U64Input;
  rentReceiver?: PublicKeyish;
}

export interface ExecuteWalletOptions extends ExecuteCpiCheckedParams, WalletActionOptions {
  holder: PublicKeyish;
  wallet: number;
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
  walletMetaIndex: number;
  targetProgram: PublicKeyish;
  targetAccounts: Array<{
    pubkey: PublicKeyish;
    isSigner?: boolean;
    isWritable?: boolean;
  }>;
  targetInstructionData: Uint8Array;
  postCheckCount: number;
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
  sign?: boolean;
  send?: boolean;
  commitment?: Commitment;
  sendOptions?: SendOptions;
}

export interface WalletInstructionSet {
  initializeGlobalConfig(params: {
    initializer: PublicKeyish;
    registryProgram: PublicKeyish;
    collection: PublicKeyish;
    feeTreasury: PublicKeyish;
    vaultActivationFeeLamports: U64Input;
  }): TransactionInstruction;
}
