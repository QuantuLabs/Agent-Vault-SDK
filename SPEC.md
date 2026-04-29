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
AgentVaultClient.devnet({ connection, identity })
client.transaction({ feePayer, recentBlockhash, instructions })
client.prepare({ feePayer, recentBlockhash, instructions })
client.execute({ feePayer, recentBlockhash, instructions })
client.tx({ feePayer, recentBlockhash, instructions })

client.identities.create({ uri, atomEnabled, collectionPointer })
client.identities.getAgentAccountPda(agentAsset)
client.identities.requireIdentitySdk()
```

`client.wallets` is the Agent Vault surface. It builds instructions, derives
PDAs, lists wallets without an indexer, and verifies deployment metadata.

Target API:

```ts
client.wallets.getVault(agentAsset)
client.wallets.get(agentAsset, index)
client.wallets.address(agentAsset, index)
client.wallets.ataAddress(agentAsset, index, mint, tokenProgram)
client.wallets.overview(agentAsset, { limit })
client.wallets.list(agentAsset, { startIndex, limit, includeClosed })
client.wallets.listAll(agentAsset)
client.wallets.setup(agentAsset, holder, { labels, includeVaultInit, feePayer, signer, send })
client.wallets.setupInstructions(agentAsset, holder, { labels, includeVaultInit })
client.wallets.createWallet(agentAsset, holder, { label, feePayer, signer, send })
client.wallets.createWalletInstruction(agentAsset, holder, { label })
client.wallets.initVault(agentAsset, holder)
client.wallets.updateLabel(agentAsset, holder, index, label)
client.wallets.depositSol(agentAsset, index, funder, amount)
client.wallets.withdrawSol(agentAsset, holder, index, amount, destination)
client.wallets.transferSol(agentAsset, holder, fromIndex, toIndex, amount)
client.wallets.createAta(agentAsset, holder, index, mint, tokenProgram)
client.wallets.transferSpl(agentAsset, holder, index, params)
client.wallets.wrapSol(agentAsset, holder, index, amount)
client.wallets.unwrapSol(agentAsset, holder, index)
client.wallets.closeAta(agentAsset, holder, index, mint, tokenProgram, rentReceiver)
client.wallets.executeCpiChecked(agentAsset, holder, index, params)
client.wallets.reopenForRecovery(agentAsset, holder, index, { label })
client.wallets.close(agentAsset, holder, index, rentReceiver)
client.wallets.buildInitVault(agentAsset, holder)
client.wallets.buildCreate(agentAsset, holder, { index, label })
client.wallets.buildUpdateLabel(agentAsset, holder, index, label)
client.wallets.buildDepositSol(agentAsset, index, funder, amount)
client.wallets.buildWithdrawSol(agentAsset, holder, index, amount, destination)
client.wallets.buildTransferSol(agentAsset, holder, fromIndex, toIndex, amount)
client.wallets.buildCreateAta(agentAsset, holder, index, mint, tokenProgram)
client.wallets.buildTransferSpl(agentAsset, holder, index, params)
client.wallets.buildWrapSol(agentAsset, holder, index, amount)
client.wallets.buildUnwrapSol(agentAsset, holder, index)
client.wallets.buildCloseAta(agentAsset, holder, index, mint, tokenProgram, rentReceiver)
client.wallets.buildExecuteCpiChecked(agentAsset, holder, index, params)
client.wallets.buildReopenForRecovery(agentAsset, holder, index, { label })
client.wallets.buildClose(agentAsset, holder, index, rentReceiver)
client.wallets.verifyDeployment()
```

The short methods are the default DX surface. They sign, send, and confirm by
default when a signer is configured on the client or passed per call. Passing
`send: false` returns a transaction without sending it; passing `send: false`
and `sign: false` returns a transaction for external signing.

The `*Instruction()` and `build*` methods are retained as explicit low-level
aliases for deterministic instruction construction.

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

Mainnet builders fail closed until canonical deployment verification is
implemented and passes. Devnet/localnet may warn for candidate manifests.

## Identity Creation

Identity creation is delegated to `8004-solana`:

```ts
const identity = new SolanaSDK({ cluster: "devnet", signer });
const client = new AgentVaultClient({ connection, identity });
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
