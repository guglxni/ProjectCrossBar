# Differential parity test

![Certified parity harness](docs/diagrams/oracle-parity.png)

The matcher's correctness is defined by parity with the verified oracle
(`MATH.md` §6). This directory holds the harness.

## Layer 1 (runs today, no extra toolchain)

`clearing/tests/parity.rs` contains an INDEPENDENT re-implementation of
`vendor/dsam`'s uniform matching (UM), transcribed directly from the Coq source
(`vendor/dsam/mUM.v`, `mFair_Bid.v`, `mFair_Ask.v`), with no shared code with
the engine. It is differentially tested against the engine over hand-written
edge fixtures and ~30k pseudo-random books.

```bash
./tests/parity/run_parity.sh --rust
# or:
cd clearing && cargo test --test parity
```

Asserted per `MATH.md` 6.1: `p*` equal, total matched volume equal, and
per-order fills equal for every non-marginal order. At the marginal price the
split may legitimately differ (engine rations pro-rata; dsam UM fills
sequentially), so only the level total is checked there.

Status: PASSING (engine matches the independent UM reference).

## Layer 2 (gold standard, needs Coq + OCaml)

The certified comparison builds the extracted OCaml `UM` from `vendor/dsam` and
diffs it against the engine. It was not run in the scaffold environment because
`coqc`/`ocaml` were absent in some environments. `run_parity.sh` builds it when the
toolchain is present.

What still needs authoring once `vendor/dsam/Demonstration/certified.ml` exists
(it cannot be written faithfully before then, per the honesty contract):

- `oracle_cli.ml`: adapt the extracted `UM : list Bid -> list Ask -> list
  fill_type` (see `vendor/dsam/Demo.v`, the `UM` definition and the
  `Extraction "Demonstration/certified.ml" ttqa ttqb UM MM FAIR.` line) to read
  a fixture JSON of bids/asks and print `p*` and per-order fills. `p*` is
  `uniform_price` = `bp (bid_of (last (UM_aux B A 0 0) m0))` (`mUM.v:131`).
- `diff_fixtures.py`: run the engine and the `oracle` binary on each
  `fixtures/*.json` and diff per the 6.1 rule above.
- `fixtures/`: the shared fixture set (the same edge + random books layer 1
  uses, exported to JSON).

The key rule reconciliation is already done from the Coq source: dsam's
`uniform_price` is the marginal buyer's bid price, which the engine selects via
`ClearingRule::UpperBound` (now the default). Layer 2 certifies this.
