# Agent Vault SDK

TypeScript SDK for Agent Vault, the 8004-aware multi-wallet PDA vault on Solana.

This package is WIP. It targets the current deployed devnet candidate and should
not be used with valuable assets until a mainnet release is published.

## Install

```bash
npm install github:QuantuLabs/Agent-Vault-SDK 8004-solana @solana/web3.js
# After npm publication:
# npm install agent-vault 8004-solana @solana/web3.js
```

## Quickstart

```ts
import { Connection } from "@solana/web3.js";
import { ServiceType, SolanaSDK } from "8004-solana";
import { AgentVaultClient } from "agent-vault";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const identity = new SolanaSDK({ cluster: "devnet", signer: wallet });
const vault = AgentVaultClient.devnet({
  connection,
  identity,
  signer: wallet,
});

const { agentAsset, metadataUri } = await vault.registerAgent({
  name: "Trading Agent",
  description: "Agent with isolated treasury and DeFi wallets",
  image: "ipfs://...",
  services: [{ type: ServiceType.MCP, value: "https://agent.example/mcp" }],
  skills: ["natural_language_processing/natural_language_generation/text_completion"],
  domains: ["technology/software_engineering/software_engineering"],
}, {
  collectionPointer: collection.pointer!,
  uploadJson: async (json) => `ipfs://${await ipfs.addJson(json)}`,
});
const agent = vault.agent(agentAsset);

const setup = await agent.wallets.setup({
  labels: ["treasury", "trading"],
});

console.log(setup.signature);
console.log(setup.confirmation);
```

Top-level wallet methods merge common instructions, fetch a fresh blockhash,
sign with `client.signer`, send the transaction, confirm it, and return the
signature plus confirmation details.

Signed write methods and signed previews fail closed unless the bundled release
manifest is marked `deployed`, the RPC endpoint is not mainnet-beta, and live
deployment verification passes. Use `allowUnverifiedDeployment` only for explicit
local/devnet testing against a deployment you control.

Deployment verification is explicit and cheap to run before writes:

```ts
const verification = await vault.wallets.verifyDeployment();
if (!verification.ok) {
  throw new Error(verification.issues.join("\n"));
}
```

The devnet manifest checks the program account, ProgramData address, ProgramData
account, deployed ELF hash and size, upgrade authority, global config PDA,
global config bump, and expected global config fields.

To return a transaction for external signing instead:

```ts
const setup = await vault.wallets.setup(agentAsset, {
  labels: ["treasury", "trading"],
  send: false,
  sign: false,
});

const tx = setup.transaction;
```

## API Shape

The root client is intentionally small:

```ts
vault.registerAgent
vault.identities
vault.wallets
```

Agent registration is intentionally the same flow as `8004-solana`, with the
metadata JSON and metadata URI creation handled in the same call:

```ts
const { agentAsset, metadataUri } = await vault.registerAgent({
  name: "Trading Agent",
  description: "Agent with isolated treasury and DeFi wallets",
  image: "ipfs://...",
  services: [{ type: ServiceType.MCP, value: "https://agent.example/mcp" }],
  skills: ["natural_language_processing/natural_language_generation/text_completion"],
  domains: ["technology/software_engineering/software_engineering"],
}, {
  collectionPointer: collection.pointer!,
  uploadJson: async (json) => await ipfs.addJson(json),
});
const [agentAccount] = vault.identities.getAgentAccountPda(agentAsset);
```

If the metadata URI already exists, pass it directly:

```ts
const { agentAsset } = await vault.registerAgent(metadataUri, {
  collectionPointer: collection.pointer!,
});
```

`vault.agent(agentAsset).wallets` is the recommended beginner surface. It binds
the agent identity once, so wallet calls do not repeat `agentAsset`:

```ts
const agent = vault.agent(agentAsset);

await agent.wallets.setup({ labels: ["treasury", "defi"] });
await agent.wallets.fund({ wallet: 0, sol: "0.001" });
await agent.wallets.send({ from: 0, to: recipient, sol: "0.0005" });
```

`vault.wallets` also exposes the same six high-level methods when you prefer
passing `agentAsset` per call:

```ts
vault.wallets.setup(...)
vault.wallets.list(...)
vault.wallets.fund(...)
vault.wallets.send(...)
vault.wallets.token(...)
vault.wallets.execute(...)
```

## Common Flows

Create the vault config and multiple wallets in one plan:

```ts
const agent = vault.agent(agentAsset);

const plan = await agent.wallets.setup({
  labels: ["treasury", "trading", "ops"],
});

console.log(plan.signature);
```

Add another wallet later with the same setup method:

```ts
const plan = await agent.wallets.setup({
  labels: ["defi"],
});

console.log(plan.walletAddresses[0]?.toBase58(), plan.signature);
```

Fund a wallet with SOL:

```ts
const deposit = await agent.wallets.fund({
  wallet: 0,
  sol: "0.001",
});
```

Send SOL out or between vault wallets:

```ts
const withdraw = await agent.wallets.send({
  from: 0,
  to: recipient,
  sol: "0.0005",
});

const internal = await agent.wallets.send({
  from: 0,
  to: 1,
  sol: "0.00025",
});
```

Send SPL / Token-2022 tokens:

```ts
const tokenTransfer = await agent.wallets.send({
  from: 0,
  to: destinationTokenAccount,
  mint,
  tokens: "100",
});
```

Manage token accounts and WSOL:

```ts
import { NATIVE_MINT_ID } from "agent-vault";

const createAta = await agent.wallets.token({
  action: "createAta",
  wallet: 0,
  mint,
});

const createWsolAta = await agent.wallets.token({
  action: "createAta",
  wallet: 0,
  mint: NATIVE_MINT_ID,
});

const wrap = await agent.wallets.token({
  action: "wrapSol",
  wallet: 0,
  sol: "0.001",
});
```

Execute a checked CPI for DeFi composition:

```ts
const result = await agent.wallets.execute({
  wallet: 0,
  targetProgram,
  targetInstructionData,
  postCheckData,
});
```

Write methods return `{ transaction, signature, confirmation, signed, sent }`.
By default, protected actions infer the holder from `client.signer.publicKey`,
and funding infers the payer from the same signer. Pass `holder` or `payer`
only when it differs from the configured signer. For external signing, pass
`{ send: false, sign: false, feePayer }`. For advanced raw instruction
construction, use `vault.wallets.instructions`.
Beginner-facing SOL actions accept `sol`; token actions accept `tokens`. Raw
units remain available as `lamports`, `baseUnits`, or deprecated `amount` for
advanced integrations that already work in exact integer units.
`execute` defaults `walletMetaIndex` to `0`, `targetAccounts` to `[]`,
empty instruction data when omitted, and one post-check.
Token transfers infer the mint decimals when `decimals` is omitted. Tokenkeg is
used directly when explicit decimals are provided without `tokenProgram`;
Token-2022 callers can pass `tokenProgram` and `expectedFee`, or omit decimals
to let the SDK read the mint and compute the expected transfer fee.

Helpful read-only helpers are also available:

```ts
const wallet = await vault.wallets.get(agentAsset, 0);
const wallets = await vault.wallets.list(agentAsset);
const address = vault.wallets.address(agentAsset, 0);
const ata = vault.wallets.ataAddress(agentAsset, 0, mint);
```

The scoped equivalents are available as `agent.wallets.get(0)`,
`agent.wallets.list()`, `agent.wallets.address(0)`, and
`agent.wallets.ataAddress(0, mint)`.

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
npm run e2e:devnet
npm run pack:dry-run
```

`npm run e2e:devnet` performs live devnet deployment preflight before any
write. Set `AGENT_VAULT_E2E_SEND=1` only when the Agent Vault program and global
config are deployed and the signer is funded. If the program is deployed but
the global config is missing, set both `AGENT_VAULT_E2E_SEND=1` and
`AGENT_VAULT_INIT_GLOBAL=1`; the script only initializes global config when
deployment verification reports `missing`, not on hash or authority mismatches.
The e2e report prints transaction-level CU and cost rows; the program
repository's LiteSVM release report separates Agent Vault checked-CPI overhead
from target-program estimates.

Mainnet writes are intentionally blocked until a canonical mainnet manifest and
upgrade policy are published.

## Agent Skill

The repo includes [skill/SKILL.md](skill/SKILL.md), a compact AI-agent guide for
using the SDK with the scoped beginner surface and the expected verification
commands.

## Security

See [SECURITY.md](SECURITY.md) for reporting and release-status guidance.
