# Agent Vault SDK

TypeScript SDK for registering 8004 agents and managing their Agent Vault PDA
wallets on Solana.

WIP devnet candidate. Do not use with valuable assets until a mainnet release is
published.

## Install

Requires Node.js 18+.

```bash
npm install github:QuantuLabs/Agent-Vault-SDK 8004-solana @solana/web3.js
# After npm publication:
# npm install agent-vault 8004-solana @solana/web3.js
```

## Quickstart

You provide the wallet signer, an 8004 collection pointer, and a JSON uploader.
`wallet` is the Solana signer you already use in your script or app, with a
`publicKey` and signing support.

```ts
import { Connection } from "@solana/web3.js";
import { SolanaSDK } from "8004-solana";
import { AgentVaultClient } from "agent-vault";

const metadata = {
  name: "Trading Agent",
  description: "Agent with isolated vault wallets",
  image: "ipfs://...",
  services: [],
  skills: [],
  domains: [],
};

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const identity = new SolanaSDK({ cluster: "devnet", signer: wallet });

const vault = AgentVaultClient.devnet({
  connection,
  identity,
  signer: wallet,
});

const { agentAsset } = await vault.registerAgent(metadata, {
  collectionPointer,
  uploadJson,
});

const agent = vault.agent(agentAsset);

await agent.wallets.setup({ labels: ["treasury", "trading"] });

const wallets = await agent.wallets.listAll();

await agent.wallets.fund({ wallet: 0, sol: "0.001" });
await agent.wallets.send({ from: 0, to: recipient, sol: "0.0005" });
```

`collectionPointer` is the pointer returned by your 8004 collection flow, for
example `c1:...`. `uploadJson` must upload the metadata JSON and return an
`ipfs://...` URI, HTTPS URI, or bare IPFS CID. `recipient` is an external Solana
public key.

If the metadata is already uploaded, pass its URI directly:

```ts
const { agentAsset } = await vault.registerAgent("ipfs://...", {
  collectionPointer,
});
```

For app code, prefer the scoped API:

```ts
const agent = vault.agent(agentAsset);
await agent.wallets.listAll();
```

Use `vault.wallets.*` only when you intentionally want to pass `agentAsset` on
every call.

## IDs

There are two ids to keep straight:

| Name | Pass this | Meaning |
| --- | --- | --- |
| `agentAsset` | Public key or string | The 8004 Core Asset returned by `registerAgent`. It identifies the agent vault. |
| `wallet` | Number | The wallet index inside that agent vault: `0`, `1`, `2`, ... |

Do not pass the wallet PDA where the SDK asks for `agentAsset`.

```ts
await agent.wallets.fund({ wallet: 0, sol: "0.001" });

const walletPda = agent.wallets.address(0);
```

## Wallets

Create wallets:

```ts
await agent.wallets.setup({ labels: ["treasury", "trading", "ops"] });
```

List all wallets for one agent:

```ts
const wallets = await agent.wallets.listAll();

for (const wallet of wallets) {
  console.log(wallet.index, wallet.label, wallet.address.toBase58(), wallet.dataStatus);
}
```

Use pagination for large UIs:

```ts
await agent.wallets.list({ startIndex: 0, limit: 100 });
await agent.wallets.listAll({ startIndex: 100 });
```

Closed or dusted wallet PDAs are hidden by default:

```ts
await agent.wallets.listAll({ includeClosed: true });
```

`listAll()` reads the vault wallet count, derives every wallet PDA, and fetches
accounts in chunks with `getMultipleAccountsInfo`. It does not require an
indexer.

## Writes

High-level methods sign, send, and confirm when the client has a signer:

```ts
await agent.wallets.fund({ wallet: 0, sol: "0.001" });
await agent.wallets.send({ from: 0, to: 1, sol: "0.0001" });
await agent.wallets.send({ from: 0, to: recipient, sol: "0.0005" });
await agent.wallets.send({ from: 0, to: tokenAccount, mint, tokens: "12.5" });
```

Use `sol` and `tokens` in app code. Use raw `lamports` and `baseUnits` only when
you explicitly need integer units. For token sends, `mint` is the SPL mint and
`to` is either another wallet index or a destination token account.

## External Signing

Return a transaction without signing or sending:

```ts
const plan = await agent.wallets.setup({
  labels: ["treasury"],
  send: false,
  sign: false,
});

const tx = plan.transaction;
```

The same `send: false` / `sign: false` options work on wallet write methods.

## Deployment Safety

Signed writes fail closed unless the configured release manifest and live
deployment verify. `AgentVaultClient.devnet(...)` uses the bundled devnet
manifest. Check it explicitly when debugging:

```ts
const verification = await vault.wallets.verifyDeployment();

if (!verification.ok) {
  throw new Error(verification.issues.join("\n"));
}
```

Use `allowUnverifiedDeployment` only as a client option for local or controlled
devnet testing.

## Development

```bash
npm install
NO_DNA=1 npm run check
NO_DNA=1 npm run e2e:devnet
NO_DNA=1 npm run pack:dry-run
```

`e2e:devnet` is preflight-only unless `AGENT_VAULT_E2E_SEND=1` is set.

Useful docs:

- [`SPEC.md`](SPEC.md): API contract and RPC rules.
- [`SECURITY.md`](SECURITY.md): security model and release checks.
- [`skill/SKILL.md`](skill/SKILL.md): short agent-facing integration guide.
