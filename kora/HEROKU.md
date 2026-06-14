# Kora relayer on Heroku

Host the CrossBar gasless paymaster so the Vercel-hosted dashboard can call
`VITE_KORA_RPC` over HTTPS. Kora exposes CORS (`access-control-allow-origin: *`),
so browser `fetch` from the static frontend works.

## App (live)

| Field | Value |
| --- | --- |
| App name | `crossbar-kora-devnet` |
| URL | `https://crossbar-kora-devnet-b94b9586c6b7.herokuapp.com` |
| Status | **Running** (fee payer `3dJTjgEYn48DGKuv6hc5SBjF5XaSaQWbb22mWNbDSSHE`) |
| Health | `POST …/rpc` with `{"jsonrpc":"2.0","id":1,"method":"getConfig"}` |

## One-time setup

```bash
# From repo root
heroku stack:set container -a crossbar-kora-devnet

# Fee payer secret (base58 or path — use base58 on Heroku)
# Export from your keypair: solana-keygen pubkey kora/fee-payer.json
heroku config:set \
  SIGNER_1_PRIVATE_KEY='<base58-secret-from-fee-payer.json>' \
  RPC_URL=https://api.devnet.solana.com \
  -a crossbar-kora-devnet

# Fund fee payer on devnet (same pubkey as local kora/fee-payer.json)
solana airdrop 2 3dJTjgEYn48DGKuv6hc5SBjF5XaSaQWbb22mWNbDSSHE --url devnet
```

## Deploy

```bash
cd kora
heroku container:push web -a crossbar-kora-devnet
heroku container:release web -a crossbar-kora-devnet
heroku logs --tail -a crossbar-kora-devnet
```

## Wire the frontend (Vercel env)

Production dashboard: [https://projectcrossbar.vercel.app](https://projectcrossbar.vercel.app)

Set on the `projectcrossbar` Vercel project (root directory `web`):

```
VITE_KORA_RPC=https://crossbar-kora-devnet-b94b9586c6b7.herokuapp.com
VITE_KORA_FEE_PAYER=3dJTjgEYn48DGKuv6hc5SBjF5XaSaQWbb22mWNbDSSHE
```

Local `.env` can use the same URL to test against the hosted relayer.

## Notes

- `signers.toml` reads `SIGNER_1_PRIVATE_KEY` from the environment (not a file path on Heroku).
- Sponsors **devnet** tx fees only; fund the fee payer with devnet SOL.
- Optional: set `KORA_API_KEY` on Heroku and pass `x-api-key` from the client if you lock down the relayer.
