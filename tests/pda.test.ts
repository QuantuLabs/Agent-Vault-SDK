import assert from "node:assert/strict";
import { PublicKey, type Connection } from "@solana/web3.js";
import {
  AGENT_VAULT_PROGRAM_ID,
  AGENT_VAULT_TAGS,
  AgentVaultClient,
  AgentVaultInstructions,
  AgentVaultPdas,
  encodeLabel,
} from "../src/index.js";

const agentAsset = new PublicKey("6CTyGPcn8dMwKEqgtvx2XCpkGUd7uqCVK6937RSM5bhA");
const holder = new PublicKey("2KmHw8VbShuz9xfj3ecEjBM5nPKR5BcYHRDSFfK1286t");
const registryProgram = new PublicKey("8oo4J9tBB3Hna1jRQ3rWvJjojqM5DYTDJo5cejUuJy3C");

const pdas = new AgentVaultPdas(AGENT_VAULT_PROGRAM_ID, registryProgram);
const [vaultConfig] = pdas.vaultConfig(agentAsset);
const [wallet0] = pdas.wallet(agentAsset, 0);
const [wallet1] = pdas.wallet(agentAsset, 1);
const [agentAccount] = pdas.agentAccount(agentAsset);

assert.equal(vaultConfig.toBase58(), "7DyK3iV6j9cDk1vLZyaPC3Eqmg76VKEwWYVkb4huFkJC");
assert.equal(wallet0.toBase58(), "C3NNg12Wo193KwVJVato1k9DbQVZiF6Eggfozw15qZZ3");
assert.notEqual(wallet0.toBase58(), wallet1.toBase58());
assert.equal(agentAccount.toBase58(), "7Prx1teRbaXepXQFjXZ6zWVR3Sq4wPDcXLU7AkxQcmAj");

const label = encodeLabel("trading");
assert.equal(label.length, 16);
assert.equal(label.subarray(0, 7).toString("utf8"), "trading");

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
} as unknown as Connection;
const client = AgentVaultClient.devnet({ connection });
const setup = await client.wallets.setup(agentAsset, holder, {
  labels: ["trading", "treasury"],
});

assert.equal(client.wallets.address(agentAsset, 0).toBase58(), wallet0.toBase58());
assert.equal(setup.vaultExists, false);
assert.equal(setup.nextIndex, 0);
assert.equal(setup.walletAddresses.length, 2);
assert.equal(setup.instructions.length, 3);
assert.equal(setup.instructions[0]?.data[0], AGENT_VAULT_TAGS.initVaultConfig);
assert.equal(setup.instructions[1]?.data[0], AGENT_VAULT_TAGS.createWallet);
assert.equal(setup.instructions[2]?.data[0], AGENT_VAULT_TAGS.createWallet);

const transaction = client.transaction({
  feePayer: holder,
  recentBlockhash: "11111111111111111111111111111111",
  instructions: setup.instructions,
});
assert.equal(transaction.feePayer?.toBase58(), holder.toBase58());
assert.equal(transaction.instructions.length, setup.instructions.length);
