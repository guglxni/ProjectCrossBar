/**
 * Lightweight browser fetch for Flash Trade's public price feed.
 *
 * Flash's `GET /prices` returns live Pyth Lazer oracle prices for ~60 symbols,
 * keyed by token symbol, and sends `Access-Control-Allow-Origin: *` — so it can
 * be called directly from the browser (verified). This is the SAME feed that
 * powers the flash.trade ticker. It is the primary price source for CrossBar's
 * live market panel; CoinGecko is only used for what Flash's REST API does not
 * expose (24h change % and intraday history). History comes from Pyth Benchmarks
 * (same oracle family); CoinGecko is the fallback.
 *
 * The heavyweight typed client in flash-client.ts is for Node/tests; this is a
 * dependency-free function with no `process` references, safe for the bundle.
 */

import { FLASH_API_URL } from "@/lib/constants";

interface FlashPriceRow {
  priceUi: number;
  marketSession: string;
}

type FlashPricesResponse = Record<string, FlashPriceRow>;

/** Map of symbol -> live USD price from Flash Trade. */
export async function getFlashPrices(
  signal?: AbortSignal,
): Promise<Record<string, number>> {
  const base = FLASH_API_URL.replace(/\/+$/, "");
  const res = await fetch(`${base}/prices`, {
    signal,
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Flash /prices ${res.status}`);
  const data = (await res.json()) as FlashPricesResponse;
  const out: Record<string, number> = {};
  for (const [symbol, row] of Object.entries(data)) {
    if (row && typeof row.priceUi === "number") out[symbol] = row.priceUi;
  }
  return out;
}
