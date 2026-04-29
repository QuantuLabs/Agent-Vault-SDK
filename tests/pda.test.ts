import assert from "node:assert/strict";
import { Keypair, PublicKey, type Connection } from "@solana/web3.js";
import {
  AGENT_VAULT_PROGRAM_ID,
  AGENT_VAULT_TAGS,
  AgentVaultClient,
  AgentVaultInstructions,
  AgentVaultPdas,
  encodeLabel,
} from "../src/index.js";

const agentAsset = new PublicKey("6CTyGPcn8dMwKEqgtvx2XCpkGUd7uqCVK6937RSM5bhA");
const holderSigner = Keypair.generate();
const holder = holderSigner.publicKey;
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
const client = AgentVaultClient.devnet({ connection, signer: holderSigner });
const setupPreview = await client.wallets.setup(agentAsset, holder, {
  labels: ["trading", "treasury"],
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
  payer: holder,
  amount: 1_000n,
});
assert.equal(deposit.instruction.data[0], AGENT_VAULT_TAGS.depositSol);
assert.equal(deposit.sent, true);
assert.equal(deposit.signed, true);

const withdraw = await client.wallets.send(agentAsset, {
  holder,
  from: 0,
  to: holder,
  amount: 500n,
  send: false,
  sign: false,
});
assert.equal(withdraw.instruction.data[0], AGENT_VAULT_TAGS.withdrawSol);
assert.equal(withdraw.sent, false);
assert.equal(withdraw.signed, false);
