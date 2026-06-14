#!/usr/bin/env bash
# Run the full clearing + settle lifecycle (tests/demo-devnet.ts: scenarios A/B +
# CU measurement + multi-trader settle) against a LOCAL validator — for free,
# reproducibly, exercising every post-audit guard (settle cursor, status guards,
# run_batch market-binding, vault.mint check, oracle clamp). No devnet SOL needed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SO="$ROOT/target/deploy/crossbar.so"
PROG=CG4brtfmRvvHLGEfLazSmrTWeUJsDvyKYfosx2Abbzbd
WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"
LEDGER="$(mktemp -d)/ledger"

[ -f "$SO" ] || { echo "missing $SO — run: cargo build-sbf --tools-version v1.53"; exit 1; }

echo "Starting local validator (crossbar program loaded)…"
solana-test-validator --reset --quiet --ledger "$LEDGER" \
  --bpf-program "$PROG" "$SO" &
VPID=$!
trap 'kill $VPID 2>/dev/null || true' EXIT

for i in $(seq 1 40); do
  solana cluster-version -u http://127.0.0.1:8899 >/dev/null 2>&1 && break
  sleep 1
done
PUBKEY="$(solana address -k "$WALLET")"
solana airdrop 100 "$PUBKEY" -u http://127.0.0.1:8899 >/dev/null 2>&1 || true
echo "Funded $PUBKEY; running demo-devnet against the local validator…"

ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET="$WALLET" THROTTLE_MS=0 \
  npx tsx "$ROOT/tests/demo-devnet.ts"
