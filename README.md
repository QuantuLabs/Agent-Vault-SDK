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
import { AgentVaultClient } from "agent-vault";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const agentAsset = "Your8004CoreAssetPubkey...";

const vault = AgentVaultClient.devnet({
  connection,
  signer: wallet,
});

const agent = vault.agent(agentAsset);

// Creates two wallets: one per label.
await agent.wallets.setup({ labels: ["treasury", "trading"] });

const wallets = await agent.wallets.listAll();
console.log(wallets.map((wallet) => [wallet.index, wallet.address.toBase58()]));

// After funding wallet #0 with the printed address:
await agent.wallets.send({ from: 0, to: recipient, sol: "0.0005" });
```

`agentAsset` is returned by `8004-solana` registration. `recipient` is an
external Solana public key.

## Register Agent (8004-solana)

Agent Vault does not register agents. Register with `8004-solana`, then pass the
returned `asset` to Agent Vault as `agentAsset`.

```ts
import {
  IPFSClient,
  ServiceType,
  SolanaSDK,
  buildRegistrationFileJson,
} from "8004-solana";

const pinataJwt = process.env.PINATA_JWT;
const ipfs = pinataJwt
  ? new IPFSClient({ pinataEnabled: true, pinataJwt })
  : new IPFSClient({ url: "http://localhost:5001" });
const identity = new SolanaSDK({
  cluster: "devnet",
  signer: wallet,
  ipfsClient: ipfs,
});

const metadata = buildRegistrationFileJson({
  name: "Trading Agent",
  description: "Agent with isolated vault wallets",
  image: "ipfs://...",
  services: [{ type: ServiceType.MCP, value: "https://api.example.com/mcp" }],
  skills: ["natural_language_processing/natural_language_generation/text_completion"],
  domains: ["technology/software_engineering/software_engineering"],
});

const metadataUri = `ipfs://${await ipfs.addJson(metadata)}`;
const registered = await identity.registerAgent(metadataUri);
const agentAsset = registered.asset;
if (!agentAsset) throw new Error("8004 registration did not return an agent asset");
```

`ipfs.addJson()` returns a CID, so register with `ipfs://<cid>`. Set
`PINATA_JWT` or run an IPFS HTTP API on `http://localhost:5001`. For collection,
ATOM options, or richer metadata examples, use the
[8004-solana README](https://github.com/QuantuLabs/8004-solana-ts#readme).

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

Create one wallet:

```ts
await agent.wallets.setup({ labels: ["treasury"] });
```

`setup()` creates one wallet per label. For example,
`labels: ["treasury", "trading", "ops"]` creates three wallets.

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
if (!treasury) throw new Error("treasury wallet missing");

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

Token-2022 mints with hooks, confidential transfers, frozen accounts, or
non-transferable rules may require mint-specific handling outside this SDK.

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

This is only for apps that prepare a transaction in one place and sign it
elsewhere, for example a browser wallet, custody flow, or multisig. Normal
scripts with `AgentVaultClient.devnet({ signer: wallet })` can ignore this.

Example: prepare a withdrawal from wallet #0, let the user's wallet sign it,
then send it yourself:

```ts
const plan = await agent.wallets.send({
  from: 0,
  to: recipient,
  sol: "0.0005",
  holder: wallet.publicKey,
  feePayer: wallet.publicKey,
  send: false,
  sign: false,
});

const signedTx = await wallet.signTransaction(plan.transaction);
const simulation = await connection.simulateTransaction(signedTx);
if (simulation.value.err) throw new Error(JSON.stringify(simulation.value.err));

const signature = await connection.sendRawTransaction(signedTx.serialize());
const confirmation = await connection.confirmTransaction(signature, "confirmed");
if (confirmation.value.err) throw new Error(JSON.stringify(confirmation.value.err));
```

`holder` is the current 8004 Core Asset owner that must authorize funds moving
out. `feePayer` is the account paying the Solana transaction fee. The SDK still
runs deployment and mainnet guards before returning the unsigned transaction.

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
