import { PublicKey } from "@solana/web3.js";

export const AGENT_VAULT_PROGRAM_ID = new PublicKey("36u7KMBuxjExvU6V2nfTX5SnNdYMGUupFiYouLzrgpfW");
export const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const NATIVE_MINT_ID = new PublicKey("So11111111111111111111111111111111111111112");

export const AGENT_VAULT_SEEDS = {
  globalConfig: "global_config",
  vaultConfig: "vault_config",
  agentWallet: "agent_vault",
} as const;

export const AGENT_VAULT_TAGS = {
  initializeGlobalConfig: 0,
  initVaultConfig: 1,
  createWallet: 2,
  updateWalletLabel: 3,
  depositSol: 4,
  withdrawSol: 5,
  transferSol: 6,
  closeWallet: 7,
  reopenWalletForRecovery: 8,
  createWalletAta: 32,
  transferSpl: 33,
  wrapSol: 34,
  unwrapSol: 35,
  closeWalletAta: 36,
  executeCpiChecked: 64,
} as const;

export const LABEL_LENGTH = 16;
export const GLOBAL_CONFIG_LENGTH = 160;
export const VAULT_CONFIG_LENGTH = 24;
export const WALLET_LENGTH = 32;
export const ACCOUNT_VERSION_V0 = 0;
export const DISCRIMINATOR_GLOBAL_CONFIG = Buffer.from("AVGLBCFG", "ascii");
export const DISCRIMINATOR_VAULT_CONFIG = Buffer.from("AVAGTCFG", "ascii");
export const DISCRIMINATOR_WALLET = Buffer.from("AVWALLT0", "ascii");
export const MAX_CPI_ACCOUNTS = 64;
export const MAX_CPI_IX_DATA_LEN = 1024;
export const MAX_POST_CHECKS = 8;
export const SPL_TOKEN_SYNC_NATIVE_TAG = 17;

export const TOKEN_PROGRAM_KIND = {
  tokenkeg: 0,
  token2022: 1,
} as const;

export const DEVNET_RELEASE_MANIFEST = {
  schema: "agent-vault.release-manifest.v0",
  name: "Agent Vault",
  release: "devnet-v0.1.0-candidate",
  cluster: "devnet",
  deploymentStatus: "deployed",
  program: {
    id: AGENT_VAULT_PROGRAM_ID.toBase58(),
    globalConfigPda: "Fv7ffwFuAZBiCZ6dpBPKEgYEGMXpSArmqvaqfH35Gbod",
    globalConfigBump: 255,
    sbfElfSha256: "c191c3ca0ebbb64ebfbb5766a4b4b3b30b61c44ec4e087df99a6a8c065b9bbd4",
    sbfElfSizeBytes: 149888,
  },
  deploymentVerification: {
    programDataAddress: "CQ71N7pQrmH6pGwZtcC9ibXGSA3otJEVvpmpdmtQ5Gsw",
    programDataSha256: "ebe8e8469e47f7ddd66bfabd028ed271945ddb5136e43f4a38afc12ca8695b8a",
    programDataSizeBytes: 149896,
    upgradeAuthority: "2KmHw8VbShuz9xfj3ecEjBM5nPKR5BcYHRDSFfK1286t",
    upgradePolicy: "devnet-upgradeable",
  },
  expectedGlobalConfig: {
    initializer: "2KmHw8VbShuz9xfj3ecEjBM5nPKR5BcYHRDSFfK1286t",
    registryProgram: "8oo4J9tBB3Hna1jRQ3rWvJjojqM5DYTDJo5cejUuJy3C",
    collection: "6CTyGPcn8dMwKEqgtvx2XCpkGUd7uqCVK6937RSM5bhA",
    feeTreasury: "EbHMHsePB6GYxjqgz9k2aC4NACx63vTeBXzXyHWFvqPK",
    vaultActivationFeeLamports: 500_000,
  },
} as const;
