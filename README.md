# Agent Vault SDK

TypeScript SDK for Agent Vault, the 8004-aware multi-wallet PDA vault on Solana.

This package is WIP. It targets the current devnet candidate program and should
not be used with valuable assets until a mainnet release is published.

## Install

```bash
npm install agent-vault 8004-solana @solana/web3.js
```

## Quickstart

```ts
import { Connection, PublicKey } from "@solana/web3.js";
import { SolanaSDK } from "8004-solana";
import { AgentVaultClient } from "agent-vault";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const identity = new SolanaSDK({ cluster: "devnet" });
const vault = AgentVaultClient.devnet({
  connection,
  identity,
  signer: wallet,
});

const holder = new PublicKey("...");
const { agentAsset } = await vault.identities.create({
  uri: "ipfs://...",
});

const setup = await vault.wallets.setup(agentAsset, holder, {
  labels: ["treasury", "trading"],
});

console.log(setup.signature);
console.log(setup.confirmation);
```

Top-level wallet methods merge common instructions, fetch a fresh blockhash,
sign with `client.signer`, send the transaction, confirm it, and return the
signature plus confirmation details.

To return a transaction for external signing instead:

```ts
const setup = await vault.wallets.setup(agentAsset, holder, {
  labels: ["treasury", "trading"],
  send: false,
  sign: false,
});

const tx = setup.transaction;
```

## API Shape

The root client is intentionally small:

```ts
vault.identities
vault.wallets
vault.tx(...)
```

`vault.identities` delegates identity creation to `8004-solana`:

```ts
const { agentAsset } = await vault.identities.create({ uri });
const [agentAccount] = vault.identities.getAgentAccountPda(agentAsset);
```

`vault.wallets` manages Agent Vault PDAs:

```ts
const address = vault.wallets.address(agentAsset, 0);
const ata = vault.wallets.ataAddress(agentAsset, 0, mint);
const overview = await vault.wallets.overview(agentAsset);
const wallets = await vault.wallets.list(agentAsset, { limit: 25 });
```

## Common Flows

Create the vault config and multiple wallets in one plan:

```ts
const plan = await vault.wallets.setup(agentAsset, holder, {
  labels: ["treasury", "trading", "ops"],
});

console.log(plan.signature);
```

Create the next wallet after a vault already exists:

```ts
const plan = await vault.wallets.createWallet(agentAsset, holder, {
  label: "defi",
});

console.log(plan.walletAddress.toBase58(), plan.signature);
```

Move SOL:

```ts
const deposit = await vault.wallets.depositSol(agentAsset, 0, payer, 1_000_000n);
const withdraw = await vault.wallets.withdrawSol(agentAsset, holder, 0, 500_000n, recipient);
const transfer = await vault.wallets.transferSol(agentAsset, holder, 0, 1, 250_000n);
```

Single-instruction flows can still be returned unsigned:

```ts
const deposit = await vault.wallets.depositSol(agentAsset, 0, payer, 1_000_000n, {
  send: false,
  sign: false,
});

await wallet.sendTransaction(deposit.transaction, connection);
```

Use SPL / Token-2022 wallets:

```ts
const createAta = await vault.wallets.createAta(agentAsset, holder, 0, mint);
const transferSpl = await vault.wallets.transferSpl(agentAsset, holder, 0, {
  mint,
  source,
  destination,
  amount: 100n,
  decimals: 6,
});
```

Wrap and unwrap SOL:

```ts
const wrap = await vault.wallets.wrapSol(agentAsset, holder, 0, 1_000_000n);
const unwrap = await vault.wallets.unwrapSol(agentAsset, holder, 0);
```

Build a checked CPI for DeFi composition:

```ts
const result = await vault.wallets.executeCpiChecked(agentAsset, holder, 0, {
  walletMetaIndex: 0,
  targetProgram,
  targetAccounts,
  targetInstructionData,
  postCheckCount,
  postCheckData,
});
```

Use the short methods for normal app code. They return `{ transaction,
signature, confirmation, signed, sent }`. When you only need raw instructions,
use `setupInstructions()` or the `*Instruction()` methods. The lower-level
`build*` methods remain available when you need explicit instruction naming or
fixed wallet indexes.

## RPC Model

Wallet listing does not use an indexer or `getProgramAccounts`.

Default listing path:

```text
1 getAccountInfo(vault_config)
+ ceil(limit / 100) getMultipleAccountsInfo(wallet_pdas)
```

Token discovery is explicit and lazy. Default wallet listing does not scan token
accounts.

## Development

```bash
npm ci
npm run check
npm run pack:dry-run
```
