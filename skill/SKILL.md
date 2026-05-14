---
name: agent-vault-sdk
description: Use when building with the Agent Vault TypeScript SDK, wiring 8004 agents to Agent Vault wallets, creating simple wallet flows, preparing transactions for external signing, or debugging Agent Vault SDK devnet integration.
---

# Agent Vault SDK

Use the scoped beginner surface first:

```ts
const vault = AgentVaultClient.devnet({ connection, identity, signer });
const { agentAsset } = await vault.registerAgent(metadata, { collectionPointer, uploadJson });
const agent = vault.agent(agentAsset);
```

Parameter rule:

```text
agentAsset = 8004 Core Asset pubkey
wallet     = numeric Agent Vault wallet index, usually 0, 1, 2...
```

Prefer these calls for normal app code:

```ts
await agent.wallets.setup({ labels: ["treasury", "defi"] });
await agent.wallets.listAll();
await agent.wallets.fund({ wallet: 0, sol: "0.001" });
await agent.wallets.send({ from: 0, to: recipient, sol: "0.0005" });
await agent.wallets.send({ from: 0, to: tokenAccount, mint, tokens: "100" });
await agent.wallets.token({ action: "createAta", wallet: 0, mint });
await agent.wallets.token({ action: "wrapSol", wallet: 0, sol: "0.001" });
```

## Defaults

- `holder` is inferred from `client.signer.publicKey`.
- `payer` is inferred from `client.signer.publicKey`.
- `agentAsset` is the 8004 Core Asset pubkey; `wallet` is the numeric wallet index (`0`, `1`, etc.), not the wallet PDA address.
- Use `agent.wallets.listAll()` to enumerate all wallet indexes for one agent; use `list({ startIndex, limit })` for paginated UI.
- `registerAgent(metadata, { uploadJson })` builds 8004 metadata JSON and registers the returned URI; `uploadJson` may return a full URI or a bare IPFS CID.
- Use `sol` and `tokens` in app-facing code. Raw `lamports`, `baseUnits`, or deprecated `amount` are advanced-only.
- Token transfers infer mint decimals when `decimals` is omitted.
- Token-2022 transfers can infer `expectedFee` from the mint.
- `execute` defaults `walletMetaIndex = 0`, `targetAccounts = []`, empty target data, and one post-check.
- Use `{ send: false, sign: false, feePayer }` when returning a transaction for external signing.

## Safety Rules

- Do not send mainnet transactions; SDK mainnet writes are intentionally blocked until a canonical mainnet manifest exists.
- Do not pass `allowUnverifiedDeployment` except for local/devnet deployments you control.
- Use `vault.wallets.verifyDeployment()` before debugging write failures.
- For raw instruction construction, use `vault.wallets.instructions`; keep normal app code on the scoped high-level methods.

## Verification

Run before shipping SDK changes:

```bash
NO_DNA=1 npm run check
NO_DNA=1 npm run e2e:devnet
NO_DNA=1 npm run pack:dry-run
```
