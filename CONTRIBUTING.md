# Contributing

Thank you for your interest in Project CrossBar.

## Development setup

```bash
# Matcher (fast, no Solana toolchain required)
cd clearing && cargo test

# Certified parity against the Coq-extracted oracle
./tests/parity/run_parity.sh

# On-chain program (requires Anchor 1.0.2 + platform-tools v1.53)
avm install 1.0.2 && avm use 1.0.2
cargo build-sbf --tools-version v1.53
```

See [`README.md`](README.md) for devnet demos and toolchain notes.

After editing diagrams in `docs/diagrams/*.drawio`, re-render PNGs:

```bash
./scripts/render-diagrams.sh
```

## Pull requests

1. Fork the repository and create a feature branch from `main`.
2. Keep changes focused — one logical change per PR.
3. Run `cd clearing && cargo test` before opening a PR.
4. If you touch the on-chain program, note the Anchor / platform-tools versions used in the PR description.
5. Do not commit secrets (`keys/`, `kora/fee-payer.json`, `.env` files).

## Code style

- Rust: follow existing patterns in `clearing/` and `programs/crossbar/`.
- TypeScript demos: run with `npx tsx` (Node 26 breaks mocha in this workspace).
- Preserve determinism invariant **N1** — the matcher must not read wall-clock time, slots, or arrival order inside `run_batch`.

## Questions

Open a [GitHub Discussion](https://github.com/guglxni/ProjectCrossBar/discussions) or issue for design questions. For security issues, see [`SECURITY.md`](SECURITY.md).
