# Agent Vault SDK Spec

## Package

The npm package name is `agent-vault`. Until npm publication, consume the
package from `github:QuantuLabs/Agent-Vault-SDK` or a local checkout.

Description:

```text
TypeScript SDK for Agent Vault: multi-wallet PDA management for 8004 agents on Solana.
```

The SDK is focused on Agent Vault wallets. Apps should use the public
`8004-solana` package for 8004 identity registration, then pass the returned
Core Asset public key to this SDK as `agentAsset`.

## DX Contract

The SDK should let `8004-solana` own identity registration and make the Agent
Vault wallet path short and hard to misuse:

```ts
const registered = await identity.registerAgent(metadataUri)
const vault = AgentVaultClient.devnet({ connection, signer })
const agentAsset = registered.asset
if (!agentAsset) throw new Error("8004 registration did not return an agent asset")
const agent = vault.agent(agentAsset)

await agent.wallets.setup({ labels: ["treasury", "defi"] })
await agent.wallets.listAll()
```

Docs and examples must reserve `agentAsset` for the 8004 Core Asset pubkey and `wallet` for a
numeric Agent Vault wallet index. Examples should use `sol` and `tokens` for human-facing amounts;
raw `lamports` and `baseUnits` are advanced escape hatches.

## Product Surface

The root client exposes the Agent Vault wallet surface:

```ts
client.wallets
```

Primary app docs should use `8004-solana` directly for identity registration,
then pass the returned `asset` to Agent Vault as `agentAsset`.

Target identity handoff:

```ts
const registered = await identity.registerAgent(metadataUri)
const client = AgentVaultClient.devnet({ connection, signer })
const agentAsset = registered.asset
if (!agentAsset) throw new Error("8004 registration did not return an agent asset")
const agent = client.agent(agentAsset)
```

`client.wallets` is the Agent Vault surface. Beginner-facing flows should prefer binding the agent
once:

```ts
const agent = client.agent(agentAsset)

agent.wallets.setup({ labels })
agent.wallets.list({ startIndex, limit, includeClosed })
agent.wallets.listAll({ startIndex, includeClosed })
agent.wallets.send({ from, to, sol })
agent.wallets.send({ from, to, mint, tokens })
agent.wallets.token({ action, wallet, mint, sol })
agent.wallets.execute({ wallet, targetProgram, targetInstructionData, postCheckData })
```

The unscoped form remains available for advanced callers:

Target API:

```ts
client.wallets.setup(agentAsset, { labels, includeVaultInit, feePayer, signer, send })
client.wallets.list(agentAsset, { startIndex, limit, includeClosed })
client.wallets.listAll(agentAsset, { startIndex, includeClosed })
client.wallets.send(agentAsset, { from, to, sol })
client.wallets.send(agentAsset, { from, to, mint, tokens, tokenProgram })
client.wallets.token(agentAsset, { action, wallet, mint, sol, tokenProgram })
client.wallets.execute(agentAsset, { wallet, targetProgram, targetInstructionData, postCheckData })
```

The write methods are the default DX surface. They sign, send, and confirm by
default when a signer is configured on the client or passed per call. Protected
wallet methods infer `holder` from the configured signer. Advanced callers may
still pass `holder` explicitly when the action authority is not the configured
signer. Passing
`send: false` returns a transaction without sending it; passing `send: false`
and `sign: false` returns a transaction for external signing. `execute`
defaults `walletMetaIndex` to `0`, `targetAccounts` to `[]`, empty instruction
data when omitted, and one post-check; callers pass the explicit fields only
for more complex CPI plans. Token transfers infer mint decimals when omitted,
and Token-2022 transfers can infer the expected transfer fee from the mint when
the caller omits `expectedFee`.

High-level SOL methods accept `sol` as a decimal number or string. High-level
token transfers accept `tokens` as a decimal number or string and convert it
after mint decimal inference. Raw integer units remain available for advanced
callers as `lamports`, `baseUnits`, and deprecated backward-compatible
`amount`, but beginner documentation must use `sol` and `tokens`.

Read-only helpers remain available:

```ts
client.wallets.getVault(agentAsset)
client.wallets.get(agentAsset, index)
client.wallets.address(agentAsset, index)
client.wallets.ataAddress(agentAsset, index, mint, tokenProgram)
client.wallets.overview(agentAsset, { limit })
client.wallets.verifyDeployment()
```

`agentAsset` is the 8004 Core Asset public key returned by registration. The `wallet` field is the
numeric Agent Vault wallet index (`0`, `1`, ...), not the wallet PDA address.

Raw instruction construction is available through `client.wallets.instructions`.

## RPC Rules

Wallet listing must not call `getProgramAccounts`.

Default listing path:

```text
1 getAccountInfo(vault_config)
+ ceil(limit / 100) getMultipleAccountsInfo(wallet_pdas)
```

`list` is paginated. `listAll` uses the same flow with `limit = wallet_count - startIndex`, making
full enumeration explicit without introducing an indexer.

Token discovery is explicit and lazy. Default wallet listing does not scan token
accounts.
Token-2022 mints with transfer hooks, confidential transfer, default frozen
state, or non-transferable extensions require mint-specific handling beyond the
generic ATA and checked-transfer helpers.

## Deployment Verification

The SDK accepts a release manifest with:

```ts
schema: "agent-vault.release-manifest.v0"
name: "Agent Vault"
```

Signed writes and signed previews fail closed unless the bundled manifest is
marked `deployed`, the RPC genesis hash is not mainnet-beta, and live deployment
verification passes. Mainnet writes remain blocked until a canonical mainnet
manifest and upgrade policy are published. `allowUnverifiedDeployment` is only an
explicit local/devnet escape hatch for testing deployments under direct control.

`client.wallets.verifyDeployment()` verifies the configured release manifest
against the live cluster. The devnet manifest includes ProgramData address,
ProgramData SHA-256 and allocated size, upgrade authority, local SBF hash/size,
global config PDA, global config bump, and expected global config fields.

Positive deployment verification is not reused as an authorization cache for
signed writes. Each signed write or signed preview performs a fresh live
verification so a post-verification ProgramData or global-config mismatch is
caught before signing.

## Identity Handoff

Identity registration should normally be done directly with `8004-solana`:

```ts
const identity = new SolanaSDK({ cluster: "devnet", signer });
const registered = await identity.registerAgent(metadataUri);
const agentAsset = registered.asset;
if (!agentAsset) throw new Error("8004 registration did not return an agent asset");

const client = AgentVaultClient.devnet({ connection, signer });
const agent = client.agent(agentAsset);
```

Agent Vault does not upload metadata, register agents, set collection pointers,
manage ATOM, or mutate other 8004 identity state. Those flows stay in
`8004-solana`.
