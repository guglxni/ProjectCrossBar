#!/usr/bin/env bash
# Deploy current crossbar.so to devnet and run the set_delegated diag.
set -e
cd /Users/aaryanguglani/Downloads/ProjectCrossBar
export PATH="$HOME/.cargo/bin:$PATH"
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com ANCHOR_WALLET=$HOME/.config/solana/id.json
solana program deploy --program-id target/deploy/crossbar-keypair.json target/deploy/crossbar.so --url https://api.devnet.solana.com 2>&1 | grep -iE "Program Id|Signature"
npx tsx tests/diag.ts 2>&1 | grep -vE "Token|11111111|ComputeBudget|invoke|consumed|success" | head -8
