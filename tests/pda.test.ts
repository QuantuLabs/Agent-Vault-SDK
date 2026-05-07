import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Keypair, PublicKey, SystemProgram, type Connection } from "@solana/web3.js";
import {
  AGENT_VAULT_PROGRAM_ID,
  AGENT_VAULT_TAGS,
  AgentVaultClient,
  AgentVaultInstructions,
  AgentVaultPdas,
  BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  DISCRIMINATOR_GLOBAL_CONFIG,
  DISCRIMINATOR_VAULT_CONFIG,
  DISCRIMINATOR_WALLET,
  DEVNET_RELEASE_MANIFEST,
  GLOBAL_CONFIG_LENGTH,
  NATIVE_MINT_ID,
  SPL_TOKEN_SYNC_NATIVE_TAG,
  TOKEN_PROGRAM_ID,
  VAULT_CONFIG_LENGTH,
  WALLET_LENGTH,
  encodeLabel,
  parseWallet,
  u64Le,
  type AgentVaultReleaseManifest,
} from "../src/index.js";

const agentAsset = new PublicKey("6CTyGPcn8dMwKEqgtvx2XCpkGUd7uqCVK6937RSM5bhA");
const holderSigner = Keypair.generate();
const holder = holderSigner.publicKey;
const registryProgram = new PublicKey("8oo4J9tBB3Hna1jRQ3rWvJjojqM5DYTDJo5cejUuJy3C");
const DEVNET_TEST_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const MAINNET_BETA_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

const pdas = new AgentVaultPdas(AGENT_VAULT_PROGRAM_ID, registryProgram);
const [vaultConfig, vaultConfigBump] = pdas.vaultConfig(agentAsset);
const [wallet0, wallet0Bump] = pdas.wallet(agentAsset, 0);
const [wallet1] = pdas.wallet(agentAsset, 1);
const [agentAccount] = pdas.agentAccount(agentAsset);

assert.equal(vaultConfig.toBase58(), "7DyK3iV6j9cDk1vLZyaPC3Eqmg76VKEwWYVkb4huFkJC");
assert.equal(wallet0.toBase58(), "C3NNg12Wo193KwVJVato1k9DbQVZiF6Eggfozw15qZZ3");
assert.notEqual(wallet0.toBase58(), wallet1.toBase58());
assert.equal(agentAccount.toBase58(), "7Prx1teRbaXepXQFjXZ6zWVR3Sq4wPDcXLU7AkxQcmAj");

const label = encodeLabel("trading");
assert.equal(label.length, 16);
assert.equal(label.subarray(0, 7).toString("utf8"), "trading");
assert.throws(() => encodeLabel("bad\0label"), /NUL/);
assert.throws(() => encodeLabel(Uint8Array.of(98, 97, 100, 0, 1)), /nonzero/);
assert.throws(() => u64Le(Number.MAX_SAFE_INTEGER + 1), /safe integer/);

const devnetE2eSource = readFileSync(new URL("../scripts/e2e-devnet.ts", import.meta.url), "utf8");
for (const expectedCostLabel of [
  "protocol fee SOL",
  "rent SOL",
  "recovered rent SOL",
  "external fees SOL",
  "tx fee SOL",
  "CU",
]) {
  assert.ok(devnetE2eSource.includes(expectedCostLabel), `missing devnet cost label ${expectedCostLabel}`);
}

const walletData = Buffer.alloc(WALLET_LENGTH);
DISCRIMINATOR_WALLET.copy(walletData, 0);
walletData[8] = 0;
walletData[9] = wallet0Bump;
walletData.writeUInt16LE(7, 10);
walletData.writeUInt16LE(1, 12);
encodeLabel("strict").copy(walletData, 14);
const parsedWallet = parseWallet(walletData);
assert.equal(parsedWallet.index, 7);
assert.equal(parsedWallet.isActive, true);
assert.throws(() => parseWallet(Buffer.alloc(WALLET_LENGTH)), /discriminator/);

const createWallet = new AgentVaultInstructions().createWallet(agentAsset, holder, 0, "trading");
assert.equal(createWallet.programId.toBase58(), AGENT_VAULT_PROGRAM_ID.toBase58());
assert.equal(createWallet.data[0], AGENT_VAULT_TAGS.createWallet);
assert.equal(createWallet.data.length, 17);
assert.equal(createWallet.keys.length, 5);
assert.deepEqual(createWallet.keys.map((key) => key.pubkey.toBase58()), [
  holder.toBase58(),
  vaultConfig.toBase58(),
  wallet0.toBase58(),
  agentAsset.toBase58(),
  "11111111111111111111111111111111",
]);

const connection = {
  getAccountInfo: async () => null,
  getMultipleAccountsInfo: async () => [],
  getGenesisHash: async () => DEVNET_TEST_GENESIS_HASH,
  getLatestBlockhash: async () => ({
    blockhash: "11111111111111111111111111111111",
    lastValidBlockHeight: 123,
  }),
  sendRawTransaction: async (raw: Buffer | Uint8Array) => {
    assert.ok(raw.length > 0);
    return "4NqC5aAD5yCRQXcYfZ95Hoq5yyT93L1oMRwA7gkBsYk9P";
  },
  confirmTransaction: async () => ({
    context: { slot: 1 },
    value: { err: null },
  }),
} as unknown as Connection;
const client = AgentVaultClient.devnet({ connection, signer: holderSigner, allowUnverifiedDeployment: true });
const failedIdentityClient = AgentVaultClient.devnet({
  connection,
  signer: holderSigner,
  allowUnverifiedDeployment: true,
  identity: {
    registerAgent: async () => ({ success: false, error: "registry rejected" }),
  },
});
await assert.rejects(
  () => failedIdentityClient.identities.create({ assetPubkey: agentAsset }),
  /8004 identity creation failed: registry rejected/,
);
const fallbackIdentityClient = AgentVaultClient.devnet({
  connection,
  signer: holderSigner,
  allowUnverifiedDeployment: true,
  identity: {
    registerAgent: async () => ({ success: true }),
  },
});
const fallbackIdentity = await fallbackIdentityClient.identities.create({ assetPubkey: agentAsset });
assert.equal(fallbackIdentity.agentAsset.toBase58(), agentAsset.toBase58());
const strictClient = new AgentVaultClient({
  connection,
  signer: holderSigner,
  releaseManifest: {
    ...DEVNET_RELEASE_MANIFEST,
    deploymentStatus: "candidate-not-deployed",
  },
});
const mismatchedWalletConnection = {
  ...connection,
  getAccountInfo: async (address: PublicKey) => {
    if (address.equals(wallet0)) {
      return accountInfo(walletData, AGENT_VAULT_PROGRAM_ID, false);
    }
    return null;
  },
} as unknown as Connection;
const mismatchedWalletClient = AgentVaultClient.devnet({
  connection: mismatchedWalletConnection,
  allowUnverifiedDeployment: true,
});
const invalidWalletRecord = await mismatchedWalletClient.wallets.get(agentAsset, 0);
assert.equal(invalidWalletRecord.exists, false);
assert.equal(invalidWalletRecord.dataStatus, "invalid");

const bumpMismatchWalletData = Buffer.from(walletData);
bumpMismatchWalletData[9] = (wallet0Bump + 1) & 0xff;
bumpMismatchWalletData.writeUInt16LE(0, 10);
const bumpMismatchWalletConnection = {
  ...connection,
  getAccountInfo: async (address: PublicKey) => {
    if (address.equals(wallet0)) {
      return accountInfo(bumpMismatchWalletData, AGENT_VAULT_PROGRAM_ID, false);
    }
    return null;
  },
} as unknown as Connection;
const bumpMismatchWalletClient = AgentVaultClient.devnet({
  connection: bumpMismatchWalletConnection,
  allowUnverifiedDeployment: true,
});
const bumpMismatchWalletRecord = await bumpMismatchWalletClient.wallets.get(agentAsset, 0);
assert.equal(bumpMismatchWalletRecord.exists, false);
assert.equal(bumpMismatchWalletRecord.dataStatus, "invalid");

const invalidListedConnection = {
  ...connection,
  getAccountInfo: async (address: PublicKey) => {
    if (address.equals(vaultConfig)) {
      return accountInfo(vaultConfigData(1), AGENT_VAULT_PROGRAM_ID, false);
    }
    return null;
  },
  getMultipleAccountsInfo: async (addresses: PublicKey[]) =>
    addresses.map((address) => (address.equals(wallet0) ? accountInfo(walletData, AGENT_VAULT_PROGRAM_ID, false) : null)),
} as unknown as Connection;
const invalidListedClient = AgentVaultClient.devnet({
  connection: invalidListedConnection,
  allowUnverifiedDeployment: true,
});
const invalidListedRecords = await invalidListedClient.wallets.list(agentAsset);
assert.equal(invalidListedRecords.length, 1);
assert.equal(invalidListedRecords[0]?.dataStatus, "invalid");

const bumpMismatchVaultConnection = {
  ...connection,
  getAccountInfo: async (address: PublicKey) => {
    if (address.equals(vaultConfig)) {
      return accountInfo(vaultConfigData(1, (vaultConfigBump + 1) & 0xff), AGENT_VAULT_PROGRAM_ID, false);
    }
    return null;
  },
} as unknown as Connection;
const bumpMismatchVaultClient = AgentVaultClient.devnet({
  connection: bumpMismatchVaultConnection,
  allowUnverifiedDeployment: true,
});
await assert.rejects(() => bumpMismatchVaultClient.wallets.getVault(agentAsset), /vault config bump mismatch/);

let overviewAccountInfoCalls = 0;
let overviewMultipleAccountInfoCalls = 0;
const overviewWalletData = Buffer.from(walletData);
overviewWalletData.writeUInt16LE(0, 10);
const overviewConnection = {
  ...connection,
  getAccountInfo: async (address: PublicKey) => {
    overviewAccountInfoCalls += 1;
    if (address.equals(vaultConfig)) {
      return accountInfo(vaultConfigData(1), AGENT_VAULT_PROGRAM_ID, false);
    }
    return null;
  },
  getMultipleAccountsInfo: async (addresses: PublicKey[]) => {
    overviewMultipleAccountInfoCalls += 1;
    return addresses.map((address) =>
      address.equals(wallet0) ? accountInfo(overviewWalletData, AGENT_VAULT_PROGRAM_ID, false) : null
    );
  },
} as unknown as Connection;
const overviewClient = AgentVaultClient.devnet({
  connection: overviewConnection,
  allowUnverifiedDeployment: true,
});
const overview = await overviewClient.wallets.overview(agentAsset);
assert.equal(overview.vault?.walletCount, 1);
assert.equal(overview.wallets.length, 1);
assert.equal(overviewAccountInfoCalls, 1);
assert.equal(overviewMultipleAccountInfoCalls, 1);

const setupPreview = await client.wallets.setup(agentAsset, holder, {
  labels: ["trading", "treasury"],
  send: false,
  sign: false,
});
const inferredSetupPreview = await client.wallets.setup(agentAsset, {
  labels: ["auto-holder"],
  send: false,
  sign: false,
});

assert.equal(client.wallets.address(agentAsset, 0).toBase58(), wallet0.toBase58());
assert.equal(setupPreview.vaultExists, false);
assert.equal(setupPreview.nextIndex, 0);
assert.equal(setupPreview.walletAddresses.length, 2);
assert.equal(setupPreview.instructions.length, 3);
assert.equal(setupPreview.instructions[0]?.data[0], AGENT_VAULT_TAGS.initVaultConfig);
assert.equal(setupPreview.instructions[1]?.data[0], AGENT_VAULT_TAGS.createWallet);
assert.equal(setupPreview.instructions[2]?.data[0], AGENT_VAULT_TAGS.createWallet);
assert.equal(inferredSetupPreview.transaction.feePayer?.toBase58(), holder.toBase58());
assert.equal(inferredSetupPreview.instructions[0]?.keys[0]?.pubkey.toBase58(), holder.toBase58());

const dustedVaultConnection = {
  ...connection,
  getAccountInfo: async (address: PublicKey) => {
    if (address.equals(vaultConfig)) {
      return accountInfo(Buffer.alloc(0), SystemProgram.programId, false);
    }
    return null;
  },
} as unknown as Connection;
const dustedVaultClient = AgentVaultClient.devnet({
  connection: dustedVaultConnection,
  signer: holderSigner,
  allowUnverifiedDeployment: true,
});
const dustedVaultSetup = await dustedVaultClient.wallets.setup(agentAsset, holder, {
  labels: ["recovered"],
  send: false,
  sign: false,
});
assert.equal(dustedVaultSetup.vaultExists, false);
assert.equal(dustedVaultSetup.instructions[0]?.data[0], AGENT_VAULT_TAGS.initVaultConfig);

const setup = await client.wallets.setup(agentAsset, holder, {
  labels: ["treasury"],
});
assert.equal(setup.blockhash, "11111111111111111111111111111111");
assert.equal(setup.lastValidBlockHeight, 123);
assert.equal(setup.transaction.instructions.length, 2);
assert.equal(setup.sent, true);
assert.equal(setup.signed, true);
assert.equal(setup.signature, "4NqC5aAD5yCRQXcYfZ95Hoq5yyT93L1oMRwA7gkBsYk9P");
assert.equal(setup.confirmation?.value.err, null);
assert.equal(setup.signers[0]?.toBase58(), holder.toBase58());

await assert.rejects(
  () => strictClient.wallets.fund(agentAsset, {
    wallet: 0,
    payer: holder,
    amount: 1n,
  }),
  /candidate-not-deployed/,
);
await assert.rejects(
  () => strictClient.wallets.fund(agentAsset, {
    wallet: 0,
    payer: holder,
    amount: 1n,
    send: false,
  }),
  /candidate-not-deployed/,
);
const strictUnsignedPreview = await strictClient.wallets.fund(agentAsset, {
  wallet: 0,
  amount: 1n,
  send: false,
  sign: false,
});
assert.equal(strictUnsignedPreview.sent, false);
assert.equal(strictUnsignedPreview.signed, false);

const noSignerClient = AgentVaultClient.devnet({
  connection,
  allowUnverifiedDeployment: true,
});
await assert.rejects(
  () => noSignerClient.wallets.fund(agentAsset, {
    wallet: 0,
    amount: 1n,
    send: false,
    sign: false,
  }),
  /payer is required/,
);
const externalUnsignedDeposit = await noSignerClient.wallets.fund(agentAsset, {
  wallet: 0,
  amount: 1n,
  feePayer: holder,
  send: false,
  sign: false,
});
assert.equal(externalUnsignedDeposit.transaction.feePayer?.toBase58(), holder.toBase58());
assert.equal(externalUnsignedDeposit.instruction.keys[0]?.pubkey.toBase58(), holder.toBase58());

const unsignedSetup = await client.wallets.setup(agentAsset, holder, {
  labels: ["unsigned"],
  send: false,
  sign: false,
});
assert.equal(unsignedSetup.sent, false);
assert.equal(unsignedSetup.signed, false);
assert.equal(unsignedSetup.signature, null);

assert.equal(setupPreview.transaction.feePayer?.toBase58(), holder.toBase58());
assert.equal(setupPreview.transaction.instructions.length, setupPreview.instructions.length);

const deposit = await client.wallets.fund(agentAsset, {
  wallet: 0,
  amount: 1_000n,
});
assert.equal(deposit.instruction.data[0], AGENT_VAULT_TAGS.depositSol);
assert.equal(deposit.instructions.length, 1);
assert.equal(deposit.sent, true);
assert.equal(deposit.signed, true);
assert.equal(deposit.instruction.keys[0]?.pubkey.toBase58(), holder.toBase58());

const withdraw = await client.wallets.send(agentAsset, {
  from: 0,
  to: holder,
  amount: 500n,
  send: false,
  sign: false,
});
assert.equal(withdraw.instruction.data[0], AGENT_VAULT_TAGS.withdrawSol);
assert.equal(withdraw.sent, false);
assert.equal(withdraw.signed, false);
assert.equal(withdraw.instruction.keys[0]?.pubkey.toBase58(), holder.toBase58());

const tokenTransferPreview = await client.wallets.send(agentAsset, {
  from: 0,
  to: client.wallets.ataAddress(agentAsset, 1, agentAsset),
  mint: agentAsset,
  amount: 1n,
  decimals: 9,
  send: false,
  sign: false,
});
assert.equal(tokenTransferPreview.instruction.data[0], AGENT_VAULT_TAGS.transferSpl);
assert.equal(tokenTransferPreview.instruction.keys[0]?.pubkey.toBase58(), holder.toBase58());

const inferredMintClient = AgentVaultClient.devnet({
  connection: {
    ...connection,
    getAccountInfo: async (address: PublicKey) => {
      if (address.equals(agentAsset)) {
        return accountInfo(mintData(6), TOKEN_PROGRAM_ID, false);
      }
      return null;
    },
  } as unknown as Connection,
  signer: holderSigner,
  allowUnverifiedDeployment: true,
});
const inferredTokenTransferPreview = await inferredMintClient.wallets.send(agentAsset, {
  from: 0,
  to: client.wallets.ataAddress(agentAsset, 1, agentAsset),
  mint: agentAsset,
  amount: 1n,
  send: false,
  sign: false,
});
assert.equal(inferredTokenTransferPreview.instruction.data[0], AGENT_VAULT_TAGS.transferSpl);
assert.equal(inferredTokenTransferPreview.instruction.data[11], 6);
assert.equal(inferredTokenTransferPreview.instruction.keys[8]?.pubkey.toBase58(), TOKEN_PROGRAM_ID.toBase58());

const createAtaPreview = await client.wallets.token(agentAsset, {
  action: "createAta",
  wallet: 0,
  mint: agentAsset,
  send: false,
  sign: false,
});
assert.equal(createAtaPreview.instruction.data[0], AGENT_VAULT_TAGS.createWalletAta);
assert.equal(createAtaPreview.instruction.keys[0]?.pubkey.toBase58(), holder.toBase58());

const closeAtaPreview = await client.wallets.token(agentAsset, {
  action: "closeAta",
  wallet: 0,
  mint: agentAsset,
  send: false,
  sign: false,
});
assert.equal(closeAtaPreview.instruction.data[0], AGENT_VAULT_TAGS.closeWalletAta);
assert.equal(closeAtaPreview.instruction.keys[7]?.pubkey.toBase58(), holder.toBase58());

const wrap = await client.wallets.token(agentAsset, {
  action: "wrapSol",
  wallet: 0,
  amount: 123n,
  send: false,
  sign: false,
});
assert.equal(wrap.instructions.length, 2);
assert.equal(wrap.instructions[0]?.data[0], AGENT_VAULT_TAGS.wrapSol);
assert.equal(wrap.instructions[1]?.programId.toBase58(), TOKEN_PROGRAM_ID.toBase58());
assert.equal(wrap.instructions[1]?.data[0], SPL_TOKEN_SYNC_NATIVE_TAG);
assert.equal(
  wrap.instructions[1]?.keys[0]?.pubkey.toBase58(),
  client.wallets.ataAddress(agentAsset, 0, NATIVE_MINT_ID).toBase58(),
);

const executePreview = await client.wallets.execute(agentAsset, {
  wallet: 0,
  targetProgram: SystemProgram.programId,
  postCheckData: Buffer.alloc(10),
  send: false,
  sign: false,
});
assert.equal(executePreview.instruction.data[0], AGENT_VAULT_TAGS.executeCpiChecked);
assert.equal(executePreview.instruction.keys[0]?.pubkey.toBase58(), holder.toBase58());
assert.equal(executePreview.instruction.data[3], 0);
assert.equal(executePreview.instruction.data[4], 0);
assert.equal(executePreview.instruction.data[7], 1);

await assert.rejects(() => client.wallets.list(agentAsset, { chunkSize: 0 }), /chunkSize/);
new AgentVaultInstructions().transferSpl(agentAsset, holder, 0, {
  mint: agentAsset,
  source: client.wallets.ataAddress(agentAsset, 0, agentAsset),
  destination: client.wallets.ataAddress(agentAsset, 1, agentAsset),
  amount: 1n,
  decimals: 9,
});
assert.throws(
  () => new AgentVaultInstructions().transferSpl(agentAsset, holder, 0, {
    mint: agentAsset,
    source: client.wallets.ataAddress(agentAsset, 0, agentAsset),
    destination: client.wallets.ataAddress(agentAsset, 1, agentAsset),
    amount: 1n,
    decimals: 256,
  }),
  /decimals/,
);
assert.throws(
  () => new AgentVaultInstructions().executeCpiChecked(agentAsset, holder, 0, {
    walletMetaIndex: 0,
    targetProgram: holder,
    targetAccounts: [],
    targetInstructionData: Buffer.alloc(0),
    postCheckCount: 0,
    postCheckData: Buffer.alloc(0),
  }),
  /postCheckCount/,
);

const failedConnection = {
  ...connection,
  confirmTransaction: async () => ({
    context: { slot: 1 },
    value: { err: { InstructionError: [0, "Custom"] } },
  }),
} as unknown as Connection;
const failedClient = AgentVaultClient.devnet({
  connection: failedConnection,
  signer: holderSigner,
  allowUnverifiedDeployment: true,
});
await assert.rejects(
  () => failedClient.wallets.fund(agentAsset, {
    wallet: 0,
    payer: holder,
    amount: 1n,
  }),
  /failed confirmation/,
);

const programDataAddress = Keypair.generate().publicKey;
const elfBytes = Buffer.from("agent-vault-fixture-elf", "utf8");
const elfHash = createHash("sha256").update(elfBytes).digest("hex");
let liveElfBytes = Buffer.from(elfBytes);
const customManifest = {
  ...DEVNET_RELEASE_MANIFEST,
  program: {
    ...DEVNET_RELEASE_MANIFEST.program,
    sbfElfSha256: elfHash,
    sbfElfSizeBytes: elfBytes.length,
  },
  expectedGlobalConfig: {
    ...DEVNET_RELEASE_MANIFEST.expectedGlobalConfig,
    feeTreasury: holder.toBase58(),
  },
  deploymentVerification: {
    programDataAddress: programDataAddress.toBase58(),
    programDataSha256: elfHash,
    upgradeAuthority: holder.toBase58(),
    upgradePolicy: "devnet-upgradeable",
  },
} satisfies AgentVaultReleaseManifest;
const globalConfigAddress = new AgentVaultPdas(AGENT_VAULT_PROGRAM_ID, registryProgram).globalConfig()[0];
const verifiedConnection = {
  ...connection,
  getAccountInfo: async (address: PublicKey) => {
    if (address.equals(AGENT_VAULT_PROGRAM_ID)) {
      return accountInfo(programStateData(programDataAddress), BPF_LOADER_UPGRADEABLE_PROGRAM_ID, true);
    }
    if (address.equals(programDataAddress)) {
      return accountInfo(programDataStateData(liveElfBytes, holder), BPF_LOADER_UPGRADEABLE_PROGRAM_ID, false);
    }
    if (address.equals(globalConfigAddress)) {
      return accountInfo(globalConfigData(customManifest), AGENT_VAULT_PROGRAM_ID, false);
    }
    return null;
  },
} as unknown as Connection;
const verifiedClient = new AgentVaultClient({
  connection: verifiedConnection,
  releaseManifest: customManifest,
  signer: holderSigner,
});
const verification = await verifiedClient.wallets.verifyDeployment();
assert.equal(verification.ok, true);
assert.equal(verification.status, "verified");
liveElfBytes = Buffer.from(elfBytes);

const verifiedPreview = await verifiedClient.wallets.fund(agentAsset, {
  wallet: 0,
  payer: holder,
  amount: 1n,
  send: false,
});
assert.equal(verifiedPreview.sent, false);
assert.equal(verifiedPreview.signed, true);

await verifiedClient.wallets.verifyDeployment();
liveElfBytes = Buffer.from(elfBytes);
liveElfBytes[0] = (liveElfBytes[0] ?? 0) ^ 1;
await assert.rejects(
  () => verifiedClient.wallets.fund(agentAsset, {
    wallet: 0,
    payer: holder,
    amount: 1n,
    send: false,
  }),
  /deployment verification failed: program data sha256 mismatch/,
);
liveElfBytes = Buffer.from(elfBytes);

const missingDeploymentClient = new AgentVaultClient({
  connection,
  releaseManifest: DEVNET_RELEASE_MANIFEST,
  signer: holderSigner,
});
await assert.rejects(
  () => missingDeploymentClient.wallets.fund(agentAsset, {
    wallet: 0,
    payer: holder,
    amount: 1n,
    send: false,
  }),
  /deployment verification failed: program missing/,
);

const unsafeMainnetClient = new AgentVaultClient({
  connection,
  releaseManifest: {
    ...DEVNET_RELEASE_MANIFEST,
    cluster: "mainnet",
  },
  signer: holderSigner,
  allowUnverifiedDeployment: true,
});
await assert.rejects(
  () => unsafeMainnetClient.wallets.fund(agentAsset, {
    wallet: 0,
    payer: holder,
    amount: 1n,
    send: false,
  }),
  /mainnet writes require canonical deployment verification/,
);
const unsafeMainnetUnsignedPreview = await unsafeMainnetClient.wallets.fund(agentAsset, {
  wallet: 0,
  payer: holder,
  amount: 1n,
  send: false,
  sign: false,
});
assert.equal(unsafeMainnetUnsignedPreview.sent, false);
assert.equal(unsafeMainnetUnsignedPreview.signed, false);

const realMainnetRpcClient = AgentVaultClient.devnet({
  connection: {
    ...connection,
    getGenesisHash: async () => MAINNET_BETA_GENESIS_HASH,
  } as unknown as Connection,
  signer: holderSigner,
  allowUnverifiedDeployment: true,
});
await assert.rejects(
  () => realMainnetRpcClient.wallets.fund(agentAsset, {
    wallet: 0,
    payer: holder,
    amount: 1n,
    send: false,
  }),
  /mainnet writes require canonical deployment verification/,
);

const badProgramIdClient = new AgentVaultClient({
  connection: verifiedConnection,
  programId: wallet0,
  releaseManifest: customManifest,
  signer: holderSigner,
});
const badProgramIdVerification = await badProgramIdClient.wallets.verifyDeployment();
assert.equal(badProgramIdVerification.ok, false);
assert.match(badProgramIdVerification.issues.join("\n"), /program id mismatch/);

const badGlobalPdaClient = new AgentVaultClient({
  connection: verifiedConnection,
  releaseManifest: {
    ...customManifest,
    program: {
      ...customManifest.program,
      globalConfigPda: wallet0.toBase58(),
    },
  },
  signer: holderSigner,
});
const badGlobalPdaVerification = await badGlobalPdaClient.wallets.verifyDeployment();
assert.equal(badGlobalPdaVerification.ok, false);
assert.match(badGlobalPdaVerification.issues.join("\n"), /global config PDA mismatch/);

const badGlobalBumpClient = new AgentVaultClient({
  connection: verifiedConnection,
  releaseManifest: {
    ...customManifest,
    program: {
      ...customManifest.program,
      globalConfigBump: 1,
    },
  },
  signer: holderSigner,
});
const badGlobalBumpVerification = await badGlobalBumpClient.wallets.verifyDeployment();
assert.equal(badGlobalBumpVerification.ok, false);
assert.match(badGlobalBumpVerification.issues.join("\n"), /global config bump mismatch/);

const badHashManifest = {
  ...customManifest,
  program: {
    ...customManifest.program,
    sbfElfSha256: "0".repeat(64),
  },
  deploymentVerification: {
    ...customManifest.deploymentVerification,
    programDataSha256: "0".repeat(64),
  },
};
const badHashClient = new AgentVaultClient({
  connection: verifiedConnection,
  releaseManifest: badHashManifest,
  signer: holderSigner,
});
const badHashVerification = await badHashClient.wallets.verifyDeployment();
assert.equal(badHashVerification.ok, false);
assert.match(badHashVerification.issues.join("\n"), /program data sha256 mismatch/);

const badProgramDataAddressClient = new AgentVaultClient({
  connection: verifiedConnection,
  releaseManifest: {
    ...customManifest,
    deploymentVerification: {
      ...customManifest.deploymentVerification,
      programDataAddress: Keypair.generate().publicKey.toBase58(),
    },
  },
  signer: holderSigner,
});
const badProgramDataAddressVerification = await badProgramDataAddressClient.wallets.verifyDeployment();
assert.equal(badProgramDataAddressVerification.ok, false);
assert.match(badProgramDataAddressVerification.issues.join("\n"), /program data address mismatch/);

const badUpgradeAuthorityClient = new AgentVaultClient({
  connection: verifiedConnection,
  releaseManifest: {
    ...customManifest,
    deploymentVerification: {
      ...customManifest.deploymentVerification,
      upgradeAuthority: Keypair.generate().publicKey.toBase58(),
    },
  },
  signer: holderSigner,
});
const badUpgradeAuthorityVerification = await badUpgradeAuthorityClient.wallets.verifyDeployment();
assert.equal(badUpgradeAuthorityVerification.ok, false);
assert.match(badUpgradeAuthorityVerification.issues.join("\n"), /upgrade authority mismatch/);

const badGlobalFieldClient = new AgentVaultClient({
  connection: verifiedConnection,
  releaseManifest: {
    ...customManifest,
    expectedGlobalConfig: {
      ...customManifest.expectedGlobalConfig,
      collection: Keypair.generate().publicKey.toBase58(),
    },
  },
  signer: holderSigner,
});
const badGlobalFieldVerification = await badGlobalFieldClient.wallets.verifyDeployment();
assert.equal(badGlobalFieldVerification.ok, false);
assert.match(badGlobalFieldVerification.issues.join("\n"), /collection mismatch/);

const uninitializedGlobalConfigClient = new AgentVaultClient({
  connection: {
    ...verifiedConnection,
    getAccountInfo: async (address: PublicKey) => {
      if (address.equals(globalConfigAddress)) {
        return accountInfo(Buffer.alloc(0), SystemProgram.programId, false);
      }
      return verifiedConnection.getAccountInfo(address);
    },
  } as unknown as Connection,
  releaseManifest: customManifest,
  signer: holderSigner,
});
const uninitializedGlobalConfigVerification = await uninitializedGlobalConfigClient.wallets.verifyDeployment();
assert.equal(uninitializedGlobalConfigVerification.ok, false);
assert.equal(uninitializedGlobalConfigVerification.status, "missing");
assert.match(uninitializedGlobalConfigVerification.issues.join("\n"), /global config uninitialized/);

liveElfBytes = Buffer.from(elfBytes);
liveElfBytes[0] = (liveElfBytes[0] ?? 0) ^ 1;
const badProgramDataUninitializedGlobalConfigClient = new AgentVaultClient({
  connection: {
    ...verifiedConnection,
    getAccountInfo: async (address: PublicKey) => {
      if (address.equals(globalConfigAddress)) {
        return accountInfo(Buffer.alloc(0), SystemProgram.programId, false);
      }
      return verifiedConnection.getAccountInfo(address);
    },
  } as unknown as Connection,
  releaseManifest: customManifest,
  signer: holderSigner,
});
const badProgramDataUninitializedGlobalConfigVerification =
  await badProgramDataUninitializedGlobalConfigClient.wallets.verifyDeployment();
assert.equal(badProgramDataUninitializedGlobalConfigVerification.ok, false);
assert.equal(badProgramDataUninitializedGlobalConfigVerification.status, "mismatch");
assert.match(badProgramDataUninitializedGlobalConfigVerification.issues.join("\n"), /program data sha256 mismatch/);
assert.match(badProgramDataUninitializedGlobalConfigVerification.issues.join("\n"), /global config uninitialized/);
liveElfBytes = Buffer.from(elfBytes);

const malformedGlobalConfigClient = new AgentVaultClient({
  connection: {
    ...verifiedConnection,
    getAccountInfo: async (address: PublicKey) => {
      if (address.equals(globalConfigAddress)) {
        return accountInfo(Buffer.alloc(1), AGENT_VAULT_PROGRAM_ID, false);
      }
      return verifiedConnection.getAccountInfo(address);
    },
  } as unknown as Connection,
  releaseManifest: customManifest,
  signer: holderSigner,
});
const malformedGlobalConfigVerification = await malformedGlobalConfigClient.wallets.verifyDeployment();
assert.equal(malformedGlobalConfigVerification.ok, false);
assert.equal(malformedGlobalConfigVerification.status, "mismatch");
assert.match(malformedGlobalConfigVerification.issues.join("\n"), /global config parse failed/);

function accountInfo(data: Buffer, owner: PublicKey, executable: boolean) {
  return {
    data,
    owner,
    executable,
    lamports: 1,
    rentEpoch: 0,
  };
}

function programStateData(programData: PublicKey): Buffer {
  const data = Buffer.alloc(36);
  data.writeUInt32LE(2, 0);
  programData.toBuffer().copy(data, 4);
  return data;
}

function programDataStateData(elf: Buffer, upgradeAuthority: PublicKey | null): Buffer {
  const data = Buffer.alloc(45 + elf.length);
  data.writeUInt32LE(3, 0);
  data.writeBigUInt64LE(1n, 4);
  if (upgradeAuthority) {
    data[12] = 1;
    upgradeAuthority.toBuffer().copy(data, 13);
  }
  elf.copy(data, 45);
  return data;
}

function mintData(decimals: number): Buffer {
  const data = Buffer.alloc(82);
  data.writeUInt32LE(0, 0);
  data.writeBigUInt64LE(0n, 36);
  data[44] = decimals;
  data[45] = 1;
  data.writeUInt32LE(0, 46);
  return data;
}

function vaultConfigData(walletCount: number, bump = vaultConfigBump): Buffer {
  const data = Buffer.alloc(VAULT_CONFIG_LENGTH);
  DISCRIMINATOR_VAULT_CONFIG.copy(data, 0);
  data[8] = 0;
  data[9] = bump;
  data.writeUInt16LE(walletCount, 10);
  data.writeUInt16LE(0, 12);
  data.writeBigInt64LE(1n, 14);
  return data;
}

function globalConfigData(manifest: AgentVaultReleaseManifest): Buffer {
  const data = Buffer.alloc(GLOBAL_CONFIG_LENGTH);
  DISCRIMINATOR_GLOBAL_CONFIG.copy(data, 0);
  data[8] = 0;
  data[9] = manifest.program.globalConfigBump;
  new PublicKey(manifest.expectedGlobalConfig.initializer).toBuffer().copy(data, 10);
  new PublicKey(manifest.expectedGlobalConfig.registryProgram).toBuffer().copy(data, 42);
  new PublicKey(manifest.expectedGlobalConfig.collection).toBuffer().copy(data, 74);
  new PublicKey(manifest.expectedGlobalConfig.feeTreasury).toBuffer().copy(data, 106);
  data.writeBigUInt64LE(BigInt(manifest.expectedGlobalConfig.vaultActivationFeeLamports), 138);
  return data;
}
