# Agent Vault SDK Spec

## Package

The npm package name is `agent-vault`. Until npm publication, consume the WIP
package from `github:QuantuLabs/Agent-Vault-SDK` or a local checkout.

Description:

```text
TypeScript SDK for Agent Vault: 8004 identity creation and multi-wallet PDA management on Solana.
```

The SDK is standalone and imports the existing public `8004-solana` package for
8004 identity creation and registry PDA compatibility.

## Product Surface

The root client exposes two namespaces:

```ts
client.identities
client.wallets
```

`client.identities` is the 8004-aware surface. It delegates agent identity
creation to `8004-solana` and exposes PDA helpers for the 8004 AgentAccount.

Target API:

```ts
AgentVaultClient.devnet({ connection, identity, signer })

client.identities.create({ uri, atomEnabled, collectionPointer })
client.identities.getAgentAccountPda(agentAsset)
client.identities.requireIdentitySdk()
```

`client.wallets` is the Agent Vault surface. The recommended high-level surface
has six methods:

Target API:

```ts
client.wallets.setup(agentAsset, { labels, includeVaultInit, feePayer, signer, send })
client.wallets.list(agentAsset, { startIndex, limit, includeClosed })
client.wallets.fund(agentAsset, { wallet, amount, feePayer, signer, send })
client.wallets.send(agentAsset, { from, to, amount, mint, decimals, tokenProgram })
client.wallets.token(agentAsset, { action, wallet, mint, amount, tokenProgram })
client.wallets.execute(agentAsset, { wallet, targetProgram, targetInstructionData, postCheckData })
```

The write methods are the default DX surface. They sign, send, and confirm by
default when a signer is configured on the client or passed per call. Protected
wallet methods infer `holder` from the configured signer; funding infers `payer`
from the same signer. Advanced callers may still pass `holder` or `payer`
explicitly when the action authority is not the configured signer. Passing
`send: false` returns a transaction without sending it; passing `send: false`
and `sign: false` returns a transaction for external signing. `execute`
defaults `walletMetaIndex` to `0`, `targetAccounts` to `[]`, empty instruction
data when omitted, and one post-check; callers pass the explicit fields only
for more complex CPI plans.

Read-only helpers remain available:

```ts
client.wallets.getVault(agentAsset)
client.wallets.get(agentAsset, index)
client.wallets.address(agentAsset, index)
client.wallets.ataAddress(agentAsset, index, mint, tokenProgram)
client.wallets.overview(agentAsset, { limit })
client.wallets.verifyDeployment()
```

Raw instruction construction is available through `client.wallets.instructions`.

## RPC Rules

Wallet listing must not call `getProgramAccounts`.

Default listing path:

```text
1 getAccountInfo(vault_config)
+ ceil(limit / 100) getMultipleAccountsInfo(wallet_pdas)
```

Token discovery is explicit and lazy. Default wallet listing does not scan token
accounts.

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

## Identity Creation

Identity creation is delegated to `8004-solana`:

```ts
const identity = new SolanaSDK({ cluster: "devnet", signer });
const client = new AgentVaultClient({ connection, identity, signer });
await client.identities.create({ uri: "ipfs://..." });
```

The returned value normalizes the 8004 response into:

```ts
{
  agentAsset: PublicKey
  result: unknown
}
```

If no identity SDK is configured, identity creation fails with an actionable
error instead of silently building partial transactions.
