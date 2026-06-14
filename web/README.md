# Project CrossBar Web App

**Live:** [https://projectcrossbar.vercel.app](https://projectcrossbar.vercel.app)

React + Vite + TypeScript + Tailwind CSS v4 + shadcn/ui single-page app: cinematic marketing hero and live devnet trading dashboard.

## Quickstart

```bash
# From repo root (IDL must exist)
anchor build   # or copy target/idl/crossbar.json into web/src/idl/

cd web
cp .env.example .env
npm install
npm run dev
```

Open http://localhost:5173/docs for protocol documentation.

## Routes

| Path | Page |
| --- | --- |
| `/` | Landing |
| `/docs` | Protocol documentation |
| `/dashboard` | Live devnet trading dashboard |
| `/parity` | Verification and invariants |
| `/integrations` | Stack integrations |

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_BASE_RPC` | devnet | Solana L1 RPC |
| `VITE_ER_RPC` | MagicBlock devnet ER | Ephemeral rollup RPC |
| `VITE_PROGRAM_ID` | deployed program | CrossBar program |
| `VITE_MARKET_PUBKEY` | empty | Existing market (or use config bar) |
| `VITE_KORA_RPC` | `https://crossbar-kora-devnet-b94b9586c6b7.herokuapp.com` | Kora gasless relayer (Heroku) |
| `VITE_KORA_FEE_PAYER` | fee payer pubkey | Required for gasless feePayer in txs |
| `VITE_FLASH_MOCK` | `0` (hosted) | `1` = offline sample Flash data in dashboard |

See **Live market context** below for marquee/chart data sources.

## Architecture

- **Dual RPC:** `useCrossbarProgram` mirrors `tests/er-demo.ts` (base + ER Anchor providers).
- **Polling:** `useMarketPolling` reads Market, BatchBook, BatchResult, OpenOrders, Oracle every 2s.
- **Integer math:** prices use `PRICE_SCALE = 1_000_000` until UI format boundary.
- **Kora:** hosted relayer at `https://crossbar-kora-devnet-b94b9586c6b7.herokuapp.com` for gasless submit.

## Live market context (marquee + chart)

Market context on `/dashboard` is **off-chain only** — it does not feed `run_batch` or the matcher (N1).

| Data | Source | Module |
| --- | --- | --- |
| Live spot price | Flash Trade `GET /prices` (Pyth Lazer) | `src/lib/flash-prices.ts` |
| 24h change % | Pyth Benchmarks hourly candles (`Crypto.{SYMBOL}/USD`) | `src/lib/pyth-benchmarks.ts` |
| Intraday chart + 24h high/low | Pyth Benchmarks TradingView shim | `src/lib/market-data.ts` |
| Fallback (change + chart) | CoinGecko via proxied API | `src/lib/coingecko.ts` |

Flash's REST API has **no** 24h change or history endpoint. Pyth Benchmarks uses the same oracle family as Flash (`pythTicker` strings like `Crypto.SOL/USD`). CoinGecko is only used when Pyth fails.

**Dev proxies** (Vite `vite.config.ts`):

- `/api/pyth/*` → `benchmarks.pyth.network`
- `/api/coingecko/*` → `api.coingecko.com/api/v3`

**Production** (Vercel edge handlers in `api/pyth/` and `api/coingecko/`): responses cached at the edge so the browser does not hit free-tier rate limits.

| Server env (Vercel only) | Purpose |
| --- | --- |
| `COINGECKO_API_KEY` | Optional CoinGecko demo key for fallback tier headroom |

Pyth docs note Benchmarks may require a Bearer token from **July 2026**; add `PYTH_API_KEY` to the edge proxy when that lands.

After changing proxy or env wiring, restart `npm run dev` and hard-refresh the dashboard (Cmd+Shift+R).

## UI kit

See [UI_KIT.md](./UI_KIT.md) for logo, typography, colors, and component patterns.

## Build

```bash
npm run build
npm run preview
```
