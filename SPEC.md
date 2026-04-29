# Agent Vault SDK Spec

## Package

The npm package name is `agent-vault`.

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
client.wallets.setup(agentAsset, holder, { labels, includeVaultInit, feePayer, signer, send })
client.wallets.list(agentAsset, { startIndex, limit, includeClosed })
client.wallets.fund(agentAsset, { wallet, payer, amount, feePayer, signer, send })
client.wallets.send(agentAsset, { holder, from, to, amount, mint, decimals, tokenProgram })
client.wallets.token(agentAsset, { action, holder, wallet, mint, amount, tokenProgram })
client.wallets.execute(agentAsset, { holder, wallet, targetProgram, targetAccounts, postCheckData })
```

The write methods are the default DX surface. They sign, send, and confirm by
default when a signer is configured on the client or passed per call. Passing
`send: false` returns a transaction without sending it; passing `send: false`
and `sign: false` returns a transaction for external signing.

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

Writes fail closed when the bundled manifest is not marked `deployed`, and
mainnet writes remain blocked by default. `allowUnverifiedDeployment` is only an
explicit local/devnet escape hatch for testing deployments under direct control.

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
