#!/usr/bin/env bash
# Deploy Project CrossBar to Solana TESTNET.
#
# NOTE: The MagicBlock Ephemeral Rollup runs on DEVNET (devnet.magicblock.app),
# not testnet, so a testnet deployment is a static L1 copy of the program with
# no ER/auction execution. The canonical target is devnet (REQUIREMENTS.md 5).
#
# FUNDING: a ~655 KB program needs ~4.6 SOL rent. The testnet CLI faucet is
# heavily rate-limited and was unavailable at build time. Fund the deployer
# wallet first via the web faucet (https://faucet.solana.com, select Testnet)
# or `solana airdrop 1 --url testnet` (retry until it lands), then run this.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROGRAM_ID="CG4brtfmRvvHLGEfLazSmrTWeUJsDvyKYfosx2Abbzbd"
WALLET="$(solana-keygen pubkey ~/.config/solana/id.json)"

echo "==> Target testnet, deployer ${WALLET}"
solana config set --url https://api.testnet.solana.com >/dev/null

BAL=$(solana balance | awk '{print $1}')
echo "    testnet balance: ${BAL} SOL (need ~4.6)"
if (( $(echo "$BAL < 4.6" | bc -l) )); then
  echo "    insufficient balance; fund ${WALLET} on testnet first (see header). Aborting."
  exit 1
fi

echo "==> Ensure SBF binary is built"
[[ -f target/deploy/crossbar.so ]] || cargo build-sbf --tools-version v1.53

echo "==> Deploy / upgrade on testnet"
solana program deploy \
  --program-id target/deploy/crossbar-keypair.json \
  target/deploy/crossbar.so

echo "==> Verify"
solana program show "${PROGRAM_ID}" --url https://api.testnet.solana.com
