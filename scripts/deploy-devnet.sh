#!/usr/bin/env bash
# Deploy Project CrossBar to Solana devnet and prepare the demo (PLAN.md M0/M4).
#
# Prereqs: a funded devnet wallet at ~/.config/solana/id.json, platform-tools v1.53
# v1.53 (for the SBF build), and `avm use 1.0.2` for the IDL.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROGRAM_ID="CG4brtfmRvvHLGEfLazSmrTWeUJsDvyKYfosx2Abbzbd"

echo "==> Configure devnet"
solana config set --url https://api.devnet.solana.com >/dev/null

echo "==> Ensure deployer is funded"
BAL=$(solana balance | awk '{print $1}')
echo "    deployer balance: ${BAL} SOL"
if (( $(echo "$BAL < 2" | bc -l) )); then
  echo "    requesting airdrop..."; solana airdrop 2 || true
fi

echo "==> Build SBF (platform-tools v1.53)"
cargo build-sbf --tools-version v1.53

echo "==> Build IDL + TS types (needs anchor 1.0.2)"
# avm use 1.0.2 first if not active; anchor build emits target/idl + target/types
anchor build || echo "    (anchor build for IDL: ensure 'avm use 1.0.2')"

echo "==> Deploy (deploy-fee optimized)"
# DEPLOY-FEE OPTIMIZATION: `solana program deploy` defaults the programdata
# account to 2x the .so size (upgrade headroom), which DOUBLES the rent. We size
# it tightly with `--max-len = .so size + a small headroom` so a fresh deploy
# pays ~half. Example at ~610 KB: default 2x ~= 8.49 SOL vs tight ~= 4.25 SOL
# (~4.25 SOL saved). Headroom (64 KB) still allows minor upgrades without
# `solana program extend`; bump it (or re-deploy) if a future build grows past it.
SO=target/deploy/crossbar.so
SO_LEN=$(wc -c < "$SO" | tr -d ' ')
MAX_LEN=$(( SO_LEN + 65536 ))   # .so + 64 KB upgrade headroom
echo "    .so = ${SO_LEN} bytes; programdata --max-len = ${MAX_LEN} bytes"
echo "    rent (tight):                      $(solana rent "$MAX_LEN" 2>/dev/null | awk '/Rent-exempt/{print $3, "SOL"}')"
echo "    rent (default 2x, for comparison): $(solana rent $(( SO_LEN * 2 )) 2>/dev/null | awk '/Rent-exempt/{print $3, "SOL"}')"

# Fresh deploy (program not yet on-chain) → size programdata tightly.
# If the program already exists this is an UPGRADE, which REUSES the existing
# programdata account (no new rent; --max-len is only honored on first deploy).
if solana program show "$PROGRAM_ID" >/dev/null 2>&1; then
  echo "    program exists → upgrading (reuses programdata, ~no new rent)"
  solana program deploy --program-id target/deploy/crossbar-keypair.json "$SO"
else
  echo "    fresh deploy → tight --max-len ${MAX_LEN}"
  solana program deploy --program-id target/deploy/crossbar-keypair.json --max-len "$MAX_LEN" "$SO"
fi

echo "==> Deployed program: ${PROGRAM_ID}"
echo "    next: 'npm install' then 'anchor test' (or npm run demo) for the scenarios."
echo "    Kora gasless relayer: see kora/README.md"
