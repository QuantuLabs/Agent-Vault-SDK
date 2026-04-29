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
const vault = AgentVaultClient.devnet({ connection, identity });

const holder = new PublicKey("...");
const { agentAsset } = await vault.identities.create({
  uri: "ipfs://...",
});

const setup = await vault.wallets.setup(agentAsset, holder, {
  labels: ["treasury", "trading"],
});

const { blockhash } = await connection.getLatestBlockhash();
const tx = vault.transaction({
  feePayer: holder,
  recentBlockhash: blockhash,
  instructions: setup.instructions,
});
```

The SDK builds typed instructions and transactions. Your app or wallet adapter
still owns signing, simulation, sending, and confirmation.

## API Shape

The root client is intentionally small:

```ts
vault.identities
vault.wallets
vault.transaction(...)
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
```

Create the next wallet after a vault already exists:

```ts
const ix = await vault.wallets.createWallet(agentAsset, holder, {
  label: "defi",
});
```

Move SOL:

```ts
const deposit = vault.wallets.depositSol(agentAsset, 0, payer, 1_000_000n);
const withdraw = vault.wallets.withdrawSol(agentAsset, holder, 0, 500_000n, recipient);
const transfer = vault.wallets.transferSol(agentAsset, holder, 0, 1, 250_000n);
```

Use SPL / Token-2022 wallets:

```ts
const createAta = vault.wallets.createAta(agentAsset, holder, 0, mint);
const transferSpl = vault.wallets.transferSpl(agentAsset, holder, 0, {
  mint,
  source,
  destination,
  amount: 100n,
  decimals: 6,
});
```

Wrap and unwrap SOL:

```ts
const wrap = vault.wallets.wrapSol(agentAsset, holder, 0, 1_000_000n);
const unwrap = vault.wallets.unwrapSol(agentAsset, holder, 0);
```

Build a checked CPI for DeFi composition:

```ts
const ix = vault.wallets.executeCpiChecked(agentAsset, holder, 0, {
  walletMetaIndex: 0,
  targetProgram,
  targetAccounts,
  targetInstructionData,
  postCheckCount,
  postCheckData,
});
```

The lower-level `build*` methods remain available when you need explicit
instruction naming or fixed wallet indexes.

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
