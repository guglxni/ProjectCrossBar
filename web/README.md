# Project CrossBar Web App

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
| `VITE_KORA_RPC` | localhost:8080 | Optional gasless relayer |
| `VITE_FLASH_MOCK` | `1` | Mock hedge preview (Flash is mainnet read-only) |

## Architecture

- **Dual RPC:** `useCrossbarProgram` mirrors `tests/er-demo.ts` (base + ER Anchor providers).
- **Polling:** `useMarketPolling` reads Market, BatchBook, BatchResult, OpenOrders, Oracle every 2s.
- **Integer math:** prices use `PRICE_SCALE = 1_000_000` until UI format boundary.
- **Honesty labels:** devnet live, mainnet read-only (Flash), mock (hedge preview). Magic Actions settlement is not implemented (reverted on devnet ER).

## UI kit

See [UI_KIT.md](./UI_KIT.md) for logo, typography, colors, and component patterns.

## Build

```bash
npm run build
npm run preview
```
