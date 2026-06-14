# Project CrossBar

> A frequent batch auction (FBA) DEX whose order matching and uniform-price clearing run **inside a MagicBlock Ephemeral Rollup**, then settle atomically to Solana L1.

[![clearing tests](https://img.shields.io/badge/clearing%20tests-49%20passing-2ea043)](clearing/)
[![certified parity](https://img.shields.io/badge/certified%20parity-4006%2F4006-2ea043)](tests/parity/)
[![devnet](https://img.shields.io/badge/devnet-deployed%20%26%20live-7a3fb5)](#verification)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Continuous order books on Solana leak value to whoever lands first in a slot. Project CrossBar removes intra-batch time priority: every order that arrives inside the same window clears at **one uniform price**, the matching runs **sub-slot inside an Ephemeral Rollup** so the protocol controls sequencing instead of the block leader, and the net result settles back to L1 in **one atomic step**.

> **Name.** A *crossbar switch* is a matrix fabric that connects any input to any output in a single pass — exactly what a matching engine does crossing N buyers against N sellers. In market microstructure, *the cross* is the auction print itself: the single uniform price at which aggregated supply and demand meet (the opening/closing cross).

---

## Architecture

Two planes. Custody and settlement are canonical on Solana L1; matching and clearing execute in the ephemeral rollup and commit back.

![Two-plane architecture](docs/diagrams/architecture.png)

The novelty is the **execution layer**, not the auction idea. Three accelerator DEXs already do batch/intent auctions on base Solana L1 (Archer — Dual Flow Batch Auctions; URANI — intent batch auctions; Darklake — zkAMM). **None run the clear inside an Ephemeral Rollup.** CrossBar's edge: sub-slot batched matching + uniform clearing with protocol-controlled ordering, then L1 settlement after undelegation.

### Lifecycle

The full path is verified end-to-end on devnet — the auction clears *inside* the rollup, then undelegates to L1.

![Market lifecycle](docs/diagrams/lifecycle.png)

### Clearing pipeline

`run_batch` is a **pure, deterministic** function of the batch set and the reference price (invariant **N1**). No clock, slot, or arrival-order reads inside matching — determinism *is* the MEV guarantee.

![Clearing pipeline](docs/diagrams/clearing.png)

---

## Feature matrix

| Capability | What it does | Where |
| --- | --- | --- |
| **Uniform-price clearing** | Every matched order in a window trades at one `p*` | [`clearing/src/clear.rs`](clearing/src/clear.rs) |
| **Dual-flow (maker/taker)** | Maker priority at the margin, single price preserved | [`clearing/src/clear.rs`](clearing/src/clear.rs) |
| **Canonical call-auction rule** | `p*` by Nasdaq/Xetra cross: max volume → min imbalance → pressure → Pyth ref | [`clearing/tests/auction_price.rs`](clearing/tests/auction_price.rs) · arXiv 1407.4512 |
| **Randomized clearing time** | VRF-jittered window close defeats "bang the close" sniping; N1-clean | [`clearing/src/window.rs`](clearing/src/window.rs) · arXiv 2405.09764 |
| **CFMM backstop** | Constant-product pool folded in as a synthetic maker ladder so thin books still clear | [`clearing/src/cfmm.rs`](clearing/src/cfmm.rs) · arXiv 2210.04929 (EC'24) |
| **Oracle band gate** | Reject `p*` outside Pyth `[p_ref ± δ]`, skip on stale feed | [`clearing/src/band.rs`](clearing/src/band.rs) |
| **VRF tie-break** | Randomness touches *only* the indivisible marginal remainder | [`programs/crossbar/src/lib.rs`](programs/crossbar/src/lib.rs) |
| **Integer fixed-point** | No floating point anywhere; `PRICE_SCALE = 1e6` | whole codebase |
| **Gasless submit** | Kora paymaster sponsors order submission | [`kora/`](kora/) |
| **ER round-trip** | delegate → submit + clear in ER → commit/undelegate → settle | [`tests/er-demo.ts`](tests/er-demo.ts) |
| **Automatic crank + settle keeper** | `ScheduleTask` fires `run_batch` every tick; a minimal keeper then undelegates → settles each trader → finalizes on L1 — full lifecycle in one command | [`tests/crank-demo.ts`](tests/crank-demo.ts) |

Order-fairness (Wendy/Libra) was analyzed and **deliberately not implemented**: FBA set-determinism *subsumes* receive-order fairness (shuffle-invariance is strictly stronger) and a fair-ordering layer would *conflict* with N1. Proven as a theorem test ([`clearing/tests/order_fairness.rs`](clearing/tests/order_fairness.rs)). See [`MATH.md`](MATH.md) §8.2.

> **Settlement is a deliberate two-step.** The auction clears *inside* the ER; settlement
> is a separate **L1 step** driven by a minimal keeper (undelegate → settle each trader →
> finalize) — the same pattern every MagicBlock example uses (e.g. rock-paper-scissor's
> `undelegate_all` → `claim_pot`). It runs end-to-end in one command
> ([`tests/crank-demo.ts`](tests/crank-demo.ts)) and is validated on the devnet ER. (We
> tried to fold settlement into an atomic post-commit Magic Action and the live ER
> disproved it — see [`docs/integrations/MAGIC_ACTIONS.md`](docs/integrations/MAGIC_ACTIONS.md).
> Gasless keeper settlement is one Kora paymaster away — UX polish, not a lifecycle change.)

---

## Verification

The correctness definition is **parity with a machine-checked oracle**: the matcher's output must be byte-identical to the Coq-extracted, formally verified double-sided auction matcher (`vendor/dsam` `UM`, rule `mUM.v:131`).

| Property | Evidence | Req |
| --- | --- | --- |
| Certified parity vs extracted OCaml `UM` | **4006/4006 batches** agree on `p*`, volume, fills — `./tests/parity/run_parity.sh` | F12 |
| Single price + IR + conservation, ~30k random books | `clearing/tests/invariants.rs` | N4, F5 |
| Determinism under shuffle, ~30k books | `clearing/tests/invariants.rs` | **N1** |
| Auction rule = verified volume/fills over 20k books | `clearing/tests/auction_price.rs` | — |
| CFMM: parity preserved at zero reserves, k non-decreasing | `clearing/tests/cfmm.rs` | — |
| Deployed + working on devnet | `solana program show CG4brtfmRvvHLGEfLazSmrTWeUJsDvyKYfosx2Abbzbd --url devnet` | T0.4 |
| Scenario A (devnet): one price | `p*=100`, vol 200, 4 fills, `run_batch` 8212 CU | F5, N4 |
| Scenario B (devnet): sandwich nets zero | attacker buy+sell at victim `p*=101`, 8829 CU | MEV (MATH §7) |
| Full ER round-trip (devnet): clear *inside* ER | `tests/er-demo.ts` — `p*=100`, undelegate, settle | novelty |

**Program:** `CG4brtfmRvvHLGEfLazSmrTWeUJsDvyKYfosx2Abbzbd` (devnet, built with platform-tools v1.53).
**Deploy size:** `opt-level=z` + fat LTO + `strip` + `panic=abort` + `no-log-ix-name` →
~610 KB (the practical floor; `token_2022` is macro-required and can't be dropped),
`overflow-checks` kept on (C5). **Deploy fee:** the bigger lever is the programdata
allocation — `solana program deploy` defaults to 2× headroom (≈8.49 SOL rent); the deploy
script sizes it tightly with `--max-len` (≈4.25 SOL), **saving ~4.25 SOL (50%)** on a fresh
deploy. `run_batch` ≈ 18–21k CU, far under the 1.4M cap (per-tx gas is negligible).

---

## Quickstart

```bash
# 1. The core matcher — zero-dependency, runs anywhere
cd clearing && cargo test                 # 49 tests across 7 suites

# 2. Certified parity against the verified Coq-extracted oracle
./tests/parity/run_parity.sh              # must print 4006/4006

# 3. Build the on-chain program (platform-tools v1.53 required)
cargo build-sbf --tools-version v1.53
cargo check -p crossbar                   # type-checks against real APIs

# 4. Devnet demos (Node 26 breaks mocha → run standalone with tsx)
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET=~/.config/solana/id.json
THROTTLE_MS=900 npx tsx tests/demo-devnet.ts   # scenarios A + B + CU
npx tsx tests/er-demo.ts                        # full ER round-trip
npx tsx tests/crank-demo.ts                     # automatic crank
```

> **Toolchain note.** Build the program with platform-tools **v1.53**. v1.51 is too old for the `edition2024` dep tree; v1.54 builds but faults at runtime on Anchor account deserialize. `cargo clean` deletes the program keypair in `target/deploy/` — restore it from `keys/`.

---

## Repository map

```
README.md              overview, diagrams, verification
MATH.md                clearing price, dual-flow, verified-matcher oracle, research §8
TECHNICALDESIGN.md     modules, instructions, PDAs, crank, oracle band, errors
SECURITY.md            vulnerability reporting policy
CONTRIBUTING.md        development setup and PR guidelines

clearing/              pure matcher crate (own workspace, zero deps, no_std+alloc)
programs/crossbar/     Anchor program (#[ephemeral])
tests/                 devnet/ER demos (tsx) + parity/ OCaml oracle
scripts/               deploy-devnet.sh · deploy-testnet.sh
docs/diagrams/         drawio sources + rendered PNGs
docs/integrations/     Flash Trade + Private Payments integration designs
clients/flash/         typed Flash Trade REST client
kora/                  gasless paymaster config (secrets gitignored)
```

See [`TECHNICALDESIGN.md`](TECHNICALDESIGN.md) for the full on-chain instruction surface and account model.

---

## Research grounding

CrossBar layers several peer-reviewed results onto the base FBA, each implemented and tested rather than cited decoratively (citations and the exact mapping are in [`MATH.md`](MATH.md) §8–9):

- **Frequent batch auctions** — Budish, Cramton & Shim, *QJE* 2015 (the case against continuous time priority).
- **Call-auction price rule** — Nasdaq/Xetra opening-cross algorithm, arXiv 1407.4512.
- **Randomized clearing time** — Mastrolia & Xu, arXiv 2405.09764.
- **CFMM-augmented batch clearing** — Ramseyer, Goyal, Goel & Mazières, *EC'24*, arXiv 2210.04929.
- **Price improvement metric** — Bertucci, arXiv 2405.00537.
- **Order-fairness (analyzed, subsumed)** — Wendy (Kursawe, arXiv 2007.08303), Libra (Mavroudis & Melton, arXiv 1910.00321).

---

## Integrations

CrossBar runs inside a MagicBlock Ephemeral Rollup, which makes two adjacent protocols
natural to compose with. Both are source-grounded designs in
[`docs/integrations/`](docs/integrations/) with working code:

- **[Flash Trade V2](docs/integrations/FLASH_TRADE.md)** — a perp DEX that also runs on
  a MagicBlock ER. Typed REST client and WebSocket streaming in [`clients/flash/`](clients/flash/),
  plus a spot/perp hedge demo (`tests/hedge-demo.ts`). Live co-execution requires mainnet on
  both sides; devnet uses API reads with mocked execution.
- **[MagicBlock Private Payments / PER](docs/integrations/PRIVATE_PAYMENTS.md)** — upgrade
  CrossBar's ER to a *Private* ER so resting order sizes and escrow amounts live in a TEE.
  Batching hides *when/in-what-order* you trade; PER hides *how much*. Implemented via
  `make_private` / `make_open_orders_private` ([`programs/crossbar/src/permission.rs`](programs/crossbar/src/permission.rs)),
  demonstrated by [`tests/private-demo.ts`](tests/private-demo.ts).

Settlement follows the standard MagicBlock two-step pattern: clear inside the ER, then
`undelegate_open_orders` + `settle` on L1 (automated in [`tests/crank-demo.ts`](tests/crank-demo.ts)).

> **On N1.** Determinism (N1) is a core invariant — the matcher is a pure function of the
> batch set and reference price. PER confidentiality is orthogonal to it. See [`MATH.md`](MATH.md) §8.

## Security

Authorization gates, one-shot settlement, oracle authentication, and adversarial fuzzing
are documented in [`TECHNICALDESIGN.md`](TECHNICALDESIGN.md). To report vulnerabilities,
see [`SECURITY.md`](SECURITY.md).

## License

[MIT](LICENSE).
