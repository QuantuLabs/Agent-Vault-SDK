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
import { SolanaSDK } from "8004-solana";
import { AgentVaultClient } from "agent-vault";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const identity = new SolanaSDK({ cluster: "devnet", signer: wallet });
const vault = AgentVaultClient.devnet({
  connection,
  identity,
  signer: wallet,
});

const { agentAsset } = await vault.identities.create({
  uri: "ipfs://...",
});

const setup = await vault.wallets.setup(agentAsset, {
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
vault.identities
vault.wallets
```

`vault.identities` delegates identity creation to `8004-solana`:

```ts
const { agentAsset } = await vault.identities.create({ uri });
const [agentAccount] = vault.identities.getAgentAccountPda(agentAsset);
```

`vault.wallets` has six high-level methods:

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
const plan = await vault.wallets.setup(agentAsset, {
  labels: ["treasury", "trading", "ops"],
});

console.log(plan.signature);
```

Add another wallet later with the same setup method:

```ts
const plan = await vault.wallets.setup(agentAsset, {
  labels: ["defi"],
});

console.log(plan.walletAddresses[0]?.toBase58(), plan.signature);
```

Fund a wallet with SOL:

```ts
const deposit = await vault.wallets.fund(agentAsset, {
  wallet: 0,
  amount: 1_000_000n,
});
```

Send SOL out or between vault wallets:

```ts
const withdraw = await vault.wallets.send(agentAsset, {
  from: 0,
  to: recipient,
  amount: 500_000n,
});

const internal = await vault.wallets.send(agentAsset, {
  from: 0,
  to: 1,
  amount: 250_000n,
});
```

Send SPL / Token-2022 tokens:

```ts
const tokenTransfer = await vault.wallets.send(agentAsset, {
  from: 0,
  to: destinationTokenAccount,
  mint,
  amount: 100n,
  decimals: 6,
});
```

Manage token accounts and WSOL:

```ts
import { NATIVE_MINT_ID } from "agent-vault";

const createAta = await vault.wallets.token(agentAsset, {
  action: "createAta",
  wallet: 0,
  mint,
});

const createWsolAta = await vault.wallets.token(agentAsset, {
  action: "createAta",
  wallet: 0,
  mint: NATIVE_MINT_ID,
});

const wrap = await vault.wallets.token(agentAsset, {
  action: "wrapSol",
  wallet: 0,
  amount: 1_000_000n,
});
```

Execute a checked CPI for DeFi composition:

```ts
const result = await vault.wallets.execute(agentAsset, {
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
`execute` defaults `walletMetaIndex` to `0`, `targetAccounts` to `[]`,
empty instruction data when omitted, and one post-check.

Helpful read-only helpers are also available:

```ts
const wallet = await vault.wallets.get(agentAsset, 0);
const wallets = await vault.wallets.list(agentAsset);
const address = vault.wallets.address(agentAsset, 0);
const ata = vault.wallets.ataAddress(agentAsset, 0, mint);
```

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

## Security

See [SECURITY.md](SECURITY.md) for reporting and release-status guidance.
