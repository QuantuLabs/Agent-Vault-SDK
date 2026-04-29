import { PublicKey } from "@solana/web3.js";
import { decodeLabel } from "./codec.js";
import {
  ACCOUNT_VERSION_V0,
  DISCRIMINATOR_GLOBAL_CONFIG,
  DISCRIMINATOR_VAULT_CONFIG,
  DISCRIMINATOR_WALLET,
  GLOBAL_CONFIG_LENGTH,
  VAULT_CONFIG_LENGTH,
  WALLET_LENGTH,
} from "./constants.js";
import type { AgentVaultReleaseManifest, AgentWalletAccount, VaultConfig } from "./types.js";

const GLOBAL_CONFIG_INITIALIZER_OFFSET = 10;
const GLOBAL_CONFIG_REGISTRY_PROGRAM_OFFSET = 42;
const GLOBAL_CONFIG_COLLECTION_OFFSET = 74;
const GLOBAL_CONFIG_FEE_TREASURY_OFFSET = 106;
const GLOBAL_CONFIG_FEE_OFFSET = 138;
const GLOBAL_CONFIG_RESERVED_OFFSET = 146;
const VAULT_CONFIG_WALLET_COUNT_OFFSET = 10;
const VAULT_CONFIG_FLAGS_OFFSET = 12;
const VAULT_CONFIG_CREATED_AT_OFFSET = 14;
const VAULT_CONFIG_RESERVED_OFFSET = 22;
const WALLET_INDEX_OFFSET = 10;
const WALLET_FLAGS_OFFSET = 12;
const WALLET_LABEL_OFFSET = 14;
const WALLET_RESERVED_OFFSET = 30;
const WALLET_FLAG_ACTIVE = 1 << 0;
const WALLET_FLAG_RECOVERY_ONLY = 1 << 1;

export interface GlobalConfigAccount {
  bump: number;
  initializer: PublicKey;
  registryProgram: PublicKey;
  collection: PublicKey;
  feeTreasury: PublicKey;
  vaultActivationFeeLamports: bigint;
}

export function parseGlobalConfig(data: Buffer): GlobalConfigAccount {
  const bump = validateHeader(data, GLOBAL_CONFIG_LENGTH, DISCRIMINATOR_GLOBAL_CONFIG, "global config");
  requireZero(data, GLOBAL_CONFIG_RESERVED_OFFSET, GLOBAL_CONFIG_LENGTH, "global config reserved bytes");
  return {
    bump,
    initializer: new PublicKey(data.subarray(GLOBAL_CONFIG_INITIALIZER_OFFSET, GLOBAL_CONFIG_INITIALIZER_OFFSET + 32)),
    registryProgram: new PublicKey(data.subarray(GLOBAL_CONFIG_REGISTRY_PROGRAM_OFFSET, GLOBAL_CONFIG_REGISTRY_PROGRAM_OFFSET + 32)),
    collection: new PublicKey(data.subarray(GLOBAL_CONFIG_COLLECTION_OFFSET, GLOBAL_CONFIG_COLLECTION_OFFSET + 32)),
    feeTreasury: new PublicKey(data.subarray(GLOBAL_CONFIG_FEE_TREASURY_OFFSET, GLOBAL_CONFIG_FEE_TREASURY_OFFSET + 32)),
    vaultActivationFeeLamports: data.readBigUInt64LE(GLOBAL_CONFIG_FEE_OFFSET),
  };
}

export function parseVaultConfig(address: PublicKey, data: Buffer): VaultConfig {
  const bump = validateHeader(data, VAULT_CONFIG_LENGTH, DISCRIMINATOR_VAULT_CONFIG, "vault config");
  const flags = data.readUInt16LE(VAULT_CONFIG_FLAGS_OFFSET);
  if (flags !== 0) {
    throw new Error("invalid vault config flags");
  }
  requireZero(data, VAULT_CONFIG_RESERVED_OFFSET, VAULT_CONFIG_LENGTH, "vault config reserved bytes");
  return {
    address,
    bump,
    walletCount: data.readUInt16LE(VAULT_CONFIG_WALLET_COUNT_OFFSET),
    createdAt: data.readBigInt64LE(VAULT_CONFIG_CREATED_AT_OFFSET),
  };
}

export function parseWallet(data: Buffer): AgentWalletAccount {
  const bump = validateHeader(data, WALLET_LENGTH, DISCRIMINATOR_WALLET, "wallet");
  const flags = data.readUInt16LE(WALLET_FLAGS_OFFSET);
  const knownFlags = WALLET_FLAG_ACTIVE | WALLET_FLAG_RECOVERY_ONLY;
  if ((flags & ~knownFlags) !== 0) {
    throw new Error("invalid wallet flags");
  }
  const isActive = (flags & WALLET_FLAG_ACTIVE) !== 0;
  const isRecoveryOnly = (flags & WALLET_FLAG_RECOVERY_ONLY) !== 0;
  if (isActive === isRecoveryOnly) {
    throw new Error("invalid wallet state flags");
  }
  requireZero(data, WALLET_RESERVED_OFFSET, WALLET_LENGTH, "wallet reserved bytes");
  return {
    bump,
    index: data.readUInt16LE(WALLET_INDEX_OFFSET),
    flags,
    label: decodeLabel(data.subarray(WALLET_LABEL_OFFSET, WALLET_LABEL_OFFSET + 16)),
    isActive,
    isRecoveryOnly,
  };
}

export function compareGlobalConfigToManifest(
  account: GlobalConfigAccount,
  manifest: AgentVaultReleaseManifest,
): string[] {
  const expected = manifest.expectedGlobalConfig;
  const issues: string[] = [];
  compare("initializer", account.initializer.toBase58(), expected.initializer, issues);
  compare("registryProgram", account.registryProgram.toBase58(), expected.registryProgram, issues);
  compare("collection", account.collection.toBase58(), expected.collection, issues);
  compare("feeTreasury", account.feeTreasury.toBase58(), expected.feeTreasury, issues);
  compare(
    "vaultActivationFeeLamports",
    account.vaultActivationFeeLamports.toString(),
    String(expected.vaultActivationFeeLamports),
    issues,
  );
  return issues;
}

function compare(name: string, actual: string, expected: string, issues: string[]): void {
  if (actual !== expected) {
    issues.push(`${name} mismatch: expected ${expected}, got ${actual}`);
  }
}

function requireLength(data: Buffer, expected: number, label: string): void {
  if (data.length !== expected) {
    throw new Error(`invalid ${label} length: expected ${expected}, got ${data.length}`);
  }
}

function validateHeader(data: Buffer, expected: number, discriminator: Buffer, label: string): number {
  requireLength(data, expected, label);
  if (!data.subarray(0, 8).equals(discriminator)) {
    throw new Error(`invalid ${label} discriminator`);
  }
  if (data[8] !== ACCOUNT_VERSION_V0) {
    throw new Error(`unsupported ${label} version`);
  }
  return data[9] ?? 0;
}

function requireZero(data: Buffer, start: number, end: number, label: string): void {
  for (let index = start; index < end; index += 1) {
    if (data[index] !== 0) {
      throw new Error(`invalid ${label}`);
    }
  }
}
