# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| `v0.1.x` (devnet) | Yes — program `CG4brtfmRvvHLGEfLazSmrTWeUJsDvyKYfosx2Abbzbd`, slot `469362329` |

Project CrossBar is in active development on Solana devnet. Do not use with real funds on mainnet until an explicit mainnet release is announced.

## Reporting a vulnerability

If you discover a security issue, please report it responsibly:

1. **Do not** open a public GitHub issue for exploitable vulnerabilities.
2. Email **guglxni** via the contact method on the [repository owner profile](https://github.com/guglxni), or open a [private security advisory](https://github.com/guglxni/ProjectCrossBar/security/advisories/new) on this repository.
3. Include a clear description, reproduction steps, and impact assessment.

We aim to acknowledge reports within **72 hours** and provide a remediation timeline when a fix is in progress.

## Scope

In scope:

- `programs/crossbar` (Anchor program on Solana)
- `clearing/` (off-chain matcher used for parity and tests)
- Devnet deployment and demo scripts under `tests/` and `scripts/`

Out of scope:

- Third-party protocols (MagicBlock, Flash Trade, Pyth) except where Project CrossBar integrates incorrectly with them
- Known devnet-only limitations documented in `TECHNICALDESIGN.md`

## Security practices

- Integer overflow checks are enabled in release builds (`overflow-checks = true`).
- Settlement is one-shot per `(trader, window)` via `last_settled_window`.
- Crank and delegation instructions are gated on `crank_authority` where applicable.
- Program builds are pinned to platform-tools **v1.53** (see `README.md`).
