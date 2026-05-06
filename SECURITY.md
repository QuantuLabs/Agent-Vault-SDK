# Security Policy

## Status

Agent Vault SDK is a work in progress devnet candidate SDK. It is intended for
testing the current Agent Vault devnet deployment and should not be used with
valuable assets until a mainnet release and production security review are
published.

## Reporting Vulnerabilities

Please report suspected vulnerabilities privately to Quantu Labs before opening
a public issue. Include:

- affected package version or commit;
- cluster and RPC endpoint, if relevant;
- reproduction steps;
- expected impact;
- suggested fix, if known.

Do not include private keys, seed phrases, wallet backups, or production secrets
in any report.

## Dependency Notes

The SDK follows the current Solana JavaScript package ecosystem. Dependency
advisories are reviewed before release; compatible security pins may be applied
through `overrides` when they do not break the public API or transaction
builders.

## Release Expectations

Signed writes are expected to fail closed unless deployment verification passes
against a published release manifest. Mainnet writes remain blocked until a
canonical mainnet manifest and upgrade policy are published.
