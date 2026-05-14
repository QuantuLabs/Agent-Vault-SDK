# Agent Vault SDK

TypeScript SDK for managing Agent Vault PDA wallets for 8004 agents on Solana.

Devnet version.

```text
Program ID: 36u7KMBuxjExvU6V2nfTX5SnNdYMGUupFiYouLzrgpfW
```

There is no mainnet release yet. Do not use with valuable assets.

## Install

Requires Node.js 18+.

```bash
npm install github:QuantuLabs/Agent-Vault-SDK 8004-solana @solana/web3.js
# After npm publication:
# npm install agent-vault 8004-solana @solana/web3.js
```

`8004-solana` is only needed by your app to register the agent. Agent Vault
starts from the returned `agentAsset`. See the
[8004-solana README](https://github.com/QuantuLabs/8004-solana-ts#readme) for
the full registration flow.

## Quickstart

Use `8004-solana` to get `agentAsset`, then use Agent Vault for wallets.
`wallet` is the Solana signer you already use in your script or app, with a
`publicKey` and signing support.

```ts
import { Connection } from "@solana/web3.js";
import { SolanaSDK } from "8004-solana";
import { AgentVaultClient } from "agent-vault";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const identity = new SolanaSDK({ cluster: "devnet", signer: wallet });

const registered = await identity.registerAgent("ipfs://...", {
  collectionPointer,
});
const agentAsset = registered.asset;

const vault = AgentVaultClient.devnet({
  connection,
  signer: wallet,
});

const agent = vault.agent(agentAsset);

await agent.wallets.setup({ labels: ["treasury", "trading"] });

const wallets = await agent.wallets.listAll();
console.log(wallets.map((wallet) => [wallet.index, wallet.address.toBase58()]));

// After funding wallet #0 with the printed address:
await agent.wallets.send({ from: 0, to: recipient, sol: "0.0005" });
```

`recipient` is an external Solana public key. If the agent is already
registered, skip `identity.registerAgent(...)` and reuse the existing 8004 Core
Asset pubkey as `agentAsset`.

## Register Agent (8004-solana)

Agent Vault does not register agents. Register with `8004-solana`, then pass the
returned `asset` to Agent Vault as `agentAsset`.

```ts
import { buildRegistrationFileJson, SolanaSDK } from "8004-solana";

const identity = new SolanaSDK({ cluster: "devnet", signer: wallet });

const metadataJson = buildRegistrationFileJson({
  name: "Trading Agent",
  description: "Agent with isolated vault wallets",
  image: "ipfs://...",
  services: [],
  skills: [],
  domains: [],
});

const metadataUri = await uploadJson(metadataJson);
const registered = await identity.registerAgent(metadataUri, {
  collectionPointer,
});

const agentAsset = registered.asset;
```

`collectionPointer` is the pointer returned by your 8004 collection flow, for
example `c1:...`. `uploadJson` must upload the metadata JSON and return an
`ipfs://...` or HTTPS URI.

If the metadata is already uploaded, pass the URI directly:

```ts
const registered = await identity.registerAgent("ipfs://...", {
  collectionPointer,
});
const agentAsset = registered.asset;
```

More details: [8004-solana README](https://github.com/QuantuLabs/8004-solana-ts#readme).

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

## Funding

Most apps can fund Agent Vault wallets directly from any wallet UI, faucet, CLI,
or backend transfer. List wallets first, then use the address for deposits.

```ts
const wallets = await agent.wallets.listAll();
const treasury = wallets[0];

console.log("SOL deposit address:", treasury.address.toBase58());
```

For SOL, send directly to the wallet address. For SPL and Token-2022, send to
the wallet ATA. Create it once if your sender cannot create recipient ATAs.

```ts
import { TOKEN_2022_PROGRAM_ID } from "agent-vault";

await agent.wallets.token({
  action: "createAta",
  wallet: treasury.index,
  mint: splMint,
});
const splDepositAddress = agent.wallets.ataAddress(treasury.index, splMint);
console.log("SPL deposit address:", splDepositAddress.toBase58());

await agent.wallets.token({
  action: "createAta",
  wallet: treasury.index,
  mint: token2022Mint,
  tokenProgram: TOKEN_2022_PROGRAM_ID,
});
const token2022DepositAddress = agent.wallets.ataAddress(
  treasury.index,
  token2022Mint,
  TOKEN_2022_PROGRAM_ID,
);
console.log("Token-2022 deposit address:", token2022DepositAddress.toBase58());
```

Once the addresses exist, anyone can transfer SOL or tokens to them. Agent Vault
authorization is only needed to move funds out.

## Writes

High-level outbound methods sign, send, and confirm when the client has a
signer:

```ts
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
  feePayer: wallet.publicKey,
  send: false,
  sign: false,
});

const tx = plan.transaction;
```

The same `send: false` / `sign: false` options work on wallet write methods.
Pass `holder` too when the fee payer is not the Core Asset owner.

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
