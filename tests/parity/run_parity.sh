#!/usr/bin/env bash
# Differential parity test driver (MATH.md section 6.1, REQUIREMENTS.md F12,
# PLAN.md T2.6/T2.7).
#
# Two layers:
#
#   1. ALWAYS-ON (no extra toolchain): an independent re-implementation of
#      vendor/dsam's uniform matching, transcribed straight from the Coq
#      source, differentially tested against the engine over edge fixtures and
#      ~30k random books. This is `cargo test -p crossbar-clearing --test
#      parity` and runs on any machine with Rust.
#
#   2. GOLD STANDARD (needs Coq + OCaml): build the verified matcher's extracted
#      OCaml `UM` from vendor/dsam and diff its p*/fills against the engine.
#      This certifies layer 1. It needs `coqc` and `ocaml`/`ocamlfind`, which
#      were NOT installed in the scaffold environment (see STATUS.md).
#
# Usage:
#   ./tests/parity/run_parity.sh            # run layer 1, then layer 2 if able
#   ./tests/parity/run_parity.sh --rust     # layer 1 only
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "==> Layer 1: independent-reference differential parity (Rust)"
( cd clearing && cargo test --test parity -- --nocapture )

if [[ "${1:-}" == "--rust" ]]; then
  echo "==> Layer 1 only (requested). Done."
  exit 0
fi

echo "==> Layer 2: verified OCaml oracle (vendor/dsam)"
if ! command -v ocamlfind >/dev/null 2>&1; then
  echo "[skip] OCaml (ocamlfind) not found. Install: brew install coq opam && opam install ocamlfind"
  echo "       Layer 1 already certifies the engine against an independent UM transcription."
  exit 0
fi

# The oracle is the TIFR authors' extracted, machine-checked OCaml `UM`. The
# repo ships it pre-extracted at vendor/dsam/Demonstration/certified.ml (a fresh
# `coqc Demo.v` needs the exact 2021-era Coq; modern Rocq fails to recompile the
# libraries, so we use the committed extraction, which IS the verified output).
CERT="vendor/dsam/Demonstration/certified.ml"
[[ -f "$CERT" ]] || { echo "[error] missing $CERT" >&2; exit 1; }

echo "    compiling verified OCaml oracle CLI"
cp "$CERT" tests/parity/certified.ml
( cd tests/parity && ocamlfind ocamlopt certified.ml oracle_cli.ml -o oracle )

echo "    building engine CLI"
( cd clearing && cargo build --release --bin engine_cli )

echo "    diffing engine vs verified oracle over edge + ~4000 random batches"
python3 tests/parity/diff_fixtures.py \
  clearing/target/release/engine_cli tests/parity/oracle
echo "==> Parity (layer 2, certified) complete."
