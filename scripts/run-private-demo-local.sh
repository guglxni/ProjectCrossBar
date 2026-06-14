#!/usr/bin/env bash
# Run the PER demo (tests/private-demo.ts) against a LOCAL validator that clones
# the REAL MagicBlock permission program from devnet — so make_private executes
# for real, for free, reproducibly. No SOL spent on devnet, no redeploy needed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SO="$ROOT/target/deploy/crossbar.so"
PROG=CG4brtfmRvvHLGEfLazSmrTWeUJsDvyKYfosx2Abbzbd
PERM=ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1
URL="${CLONE_URL:-https://api.devnet.solana.com}"
WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"
LEDGER="$(mktemp -d)/ledger"

[ -f "$SO" ] || { echo "missing $SO — run: cargo build-sbf --tools-version v1.53"; exit 1; }

echo "Starting local validator (cloning $PERM from $URL)…"
solana-test-validator --reset --quiet --ledger "$LEDGER" \
  --clone-upgradeable-program "$PERM" --url "$URL" \
  --bpf-program "$PROG" "$SO" &
VPID=$!
trap 'kill $VPID 2>/dev/null || true' EXIT

for i in $(seq 1 40); do
  solana cluster-version -u http://127.0.0.1:8899 >/dev/null 2>&1 && break
  sleep 1
done
PUBKEY="$(solana address -k "$WALLET")"
solana airdrop 100 "$PUBKEY" -u http://127.0.0.1:8899 >/dev/null 2>&1 || true
echo "Funded $PUBKEY; running demo…"

ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET="$WALLET" \
  npx tsx "$ROOT/tests/private-demo.ts"
