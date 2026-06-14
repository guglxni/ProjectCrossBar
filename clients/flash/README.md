# `clients/flash` — Flash Trade REST client

A typed, dependency-light TypeScript client (`FlashClient`) for the
[Flash Trade](https://docs.flash.trade/) perpetual-futures REST API. It exists so
Project CrossBar can compose with Flash on the **shared MagicBlock Ephemeral
Rollup** (see `docs/integrations/FLASH_TRADE.md`): a CrossBar spot fill can be
delta-hedged with a Flash perp, both priced off the same Pyth Lazer reference.

## Source of truth

Public Flash Trade API documentation and the [`flash-trade/examples-v2`](https://github.com/flash-trade/examples-v2) reference client. Every endpoint, field name, and enum in `client.ts` is copied from verified public sources.

![Flash integration surfaces](../diagrams/flash-features.png)

## What it is

- Pure TypeScript, no npm dependencies. Uses the Node global `fetch` (Node 18+).
- One small typed method per endpoint — the `packages/flash-v2` "typed client,
  edit to add endpoints" pattern from `flash-trade/examples-v2`. Add an endpoint
  by mirroring an existing method.
- Configurable `baseUrl`: explicit option > `FLASH_API_URL` env > default
  `https://flashapi.trade`.

## Endpoints implemented

| Method | Endpoint | Auth | Notes |
| --- | --- | --- | --- |
| `getPrices()` | `GET /prices` | none (public) | Pyth Lazer oracle prices by symbol |
| `getPoolData()` | `GET /pool-data` | none (public) | Pool TVL / utilization / custody ratios |
| `getMarkets()` | `GET /raw/markets` | none (public) | Raw Anchor market accounts |
| `getPositions(owner)` | `GET /positions/owner/{owner}` | none (public) | Enriched positions + PnL |
| `previewOpenPosition(params)` | `POST /transaction-builder/open-position` (owner omitted) | none | Preview only; `transactionBase64: null` |
| `buildOpenPosition(params)` | `POST /transaction-builder/open-position` (owner set) | none | Returns preview **plus** unsigned `transactionBase64` |

### Verified vs. requires SDK / signing

- **Verified & public (no auth):** all of the above. The Flash REST API is
  public with no auth headers (`SKILL.md` Critical Rules).
- **Requires a wallet to be useful:** `buildOpenPosition` returns an *unsigned*
  v0 `VersionedTransaction`. Signing and submitting it (and confirming) is the
  caller's job — see `TransactionFlow.md`. This client deliberately does **not**
  sign or submit; it only builds/previews.
- **Not covered here (require the TypeScript SDK, not REST):** LP add/remove,
  FLP / FLASH staking, limit-order edit/cancel. See
  `.agents/skills/flash-trade/SdkReference.md`.

## Network reality (important)

Flash V2 is **mainnet only, real funds**. Pyth Lazer prices on devnet are
stale/zero (`SKILL.md`). The read-only endpoints (`/prices`, `/pool-data`) are
safe to call against mainnet from anywhere — they are public and read-only.
CrossBar itself runs on **devnet** today, so any *live* combined session waits on
a CrossBar mainnet/ER deployment; until then the hedge flow is demonstrated in
MOCK mode (see `tests/hedge-demo.ts`).

## Run instructions

CrossBar runs standalone TS scripts with `npx tsx` (not mocha — Node 26 breaks
mocha). The client is a library; the runnable demos that use it are:

```bash
# Tier 0 keeper — real, read-only mainnet data (or graceful failure offline):
npx tsx clients/flash-ref.ts

# Tier 2 hedge demo — MOCK by default; FLASH_LIVE=1 for a real PREVIEW (never submits):
npx tsx tests/hedge-demo.ts
FLASH_LIVE=1 npx tsx tests/hedge-demo.ts
```

Environment variables:

| Var | Used by | Meaning |
| --- | --- | --- |
| `FLASH_API_URL` | client | Base URL override (default `https://flashapi.trade`) |
| `CROSSBAR_REF` | `flash-ref.ts` | CrossBar reference price (UI float) to cross-check |
| `BAND_BPS` | `flash-ref.ts` | Band half-width in bps (default 50) |
| `FLASH_LIVE` | `hedge-demo.ts` | `1` → call the real API for a PREVIEW only |
