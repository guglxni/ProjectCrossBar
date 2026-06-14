/**
 * CoinGecko fallback client (24h change + intraday chart).
 *
 * Primary history/stats come from Pyth Benchmarks (`pyth-benchmarks.ts`), which
 * matches Flash Trade's Pyth oracle. CoinGecko is used only when Pyth fails.
 *
 * Calls go through `/api/coingecko/*` (Vite dev proxy + Vercel edge handler).
 * Set `COINGECKO_API_KEY` on Vercel for higher free-tier limits (optional).
 *
 * CrossBar clears on devnet; nothing here touches the matcher.
 */

const BASE = "/api/coingecko";

interface CacheEntry<T> {
  data: T;
  expiry: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(id);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

async function cgFetch<T>(path: string, signal?: AbortSignal, ttlMs = 90_000): Promise<T> {
  const key = path;
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && hit.expiry > Date.now()) return hit.data;

  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const task = (async () => {
    const res = await fetch(`${BASE}${path}`, {
      signal,
      headers: { accept: "application/json" },
    });
    if (res.status === 429 && hit) return hit.data;
    if (res.status === 429) {
      await sleep(1500, signal);
      const retry = await fetch(`${BASE}${path}`, {
        signal,
        headers: { accept: "application/json" },
      });
      if (retry.status === 429 && hit) return hit.data;
      if (!retry.ok) throw new Error(`CoinGecko ${retry.status}`);
      const ct2 = retry.headers.get("content-type") ?? "";
      if (!ct2.includes("application/json")) {
        throw new Error("CoinGecko: non-JSON response");
      }
      const data = (await retry.json()) as T;
      cache.set(key, { data, expiry: Date.now() + ttlMs });
      return data;
    }
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) {
      throw new Error("CoinGecko: non-JSON response");
    }
    const data = (await res.json()) as T;
    cache.set(key, { data, expiry: Date.now() + ttlMs });
    return data;
  })();

  inflight.set(key, task);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}

/**
 * A coin we surface in the ticker / chart.
 * `id` is the CoinGecko id (for 24h change + intraday history).
 * `symbol` is the Flash Trade symbol (for the live primary price).
 */
export interface CoinMeta {
  id: string;
  symbol: string;
  pair: string;
}

/**
 * The marquee coin set — matches the flash.trade ticker vibe. Every symbol is
 * in Flash `/prices` and Pyth Benchmarks (`Crypto.{SYMBOL}/USD`). `id` is the
 * CoinGecko slug used only as a fallback data source.
 */
export const TICKER_COINS: CoinMeta[] = [
  { id: "solana", symbol: "SOL", pair: "SOL/USD" },
  { id: "ethereum", symbol: "ETH", pair: "ETH/USD" },
  { id: "bitcoin", symbol: "BTC", pair: "BTC/USD" },
  { id: "binancecoin", symbol: "BNB", pair: "BNB/USD" },
  { id: "hyperliquid", symbol: "HYPE", pair: "HYPE/USD" },
  { id: "jupiter-exchange-solana", symbol: "JUP", pair: "JUP/USD" },
  { id: "bonk", symbol: "BONK", pair: "BONK/USD" },
  { id: "jito-governance-token", symbol: "JTO", pair: "JTO/USD" },
  { id: "pyth-network", symbol: "PYTH", pair: "PYTH/USD" },
  { id: "dogwifcoin", symbol: "WIF", pair: "WIF/USD" },
];

/** One ticker row: live price + optional 24h change %. */
export interface TickerEntry {
  id: string;
  symbol: string;
  pair: string;
  price: number;
  change24h: number | null;
}

interface SimplePriceResponse {
  [id: string]: { usd: number; usd_24h_change?: number };
}

/** GET /simple/price for the ticker coins. */
export async function getTickerPrices(
  coins: CoinMeta[] = TICKER_COINS,
  signal?: AbortSignal,
): Promise<TickerEntry[]> {
  const ids = coins.map((c) => c.id).join(",");
  const path = `/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
  const data = await cgFetch<SimplePriceResponse>(path, signal, 300_000);
  return coins
    .map((c) => {
      const row = data[c.id];
      if (!row) return null;
      return {
        id: c.id,
        symbol: c.symbol,
        pair: c.pair,
        price: row.usd,
        change24h:
          typeof row.usd_24h_change === "number" ? row.usd_24h_change : null,
      } satisfies TickerEntry;
    })
    .filter((x): x is TickerEntry => x !== null);
}

/** One point on the intraday price chart. */
export interface PricePoint {
  t: number;
  price: number;
}

/** Derived 24h stats for the stat bar. */
export interface MarketChart {
  points: PricePoint[];
  last: number;
  open: number;
  high: number;
  low: number;
  change24h: number;
  changePct24h: number;
  volume24h: number;
}

/** Format a USD price across the full crypto range (BTC $64k → BONK $0.000018). */
export function formatUsd(value: number): string {
  if (value >= 1000) {
    return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }
  if (value >= 1) {
    return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (value >= 0.01) {
    return `$${value.toFixed(4)}`;
  }
  // tiny meme-coin prices: show significant digits
  return `$${value.toPrecision(3)}`;
}

/** Signed percentage, two decimals. Null renders as an em dash. */
export function formatPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

interface MarketChartResponse {
  prices: [number, number][];
  total_volumes?: [number, number][];
}

/** GET /coins/{id}/market_chart — CoinGecko fallback chart + stats. */
export async function getCoinGeckoMarketChart(
  id: string,
  days = 1,
  signal?: AbortSignal,
): Promise<MarketChart> {
  const path = `/coins/${id}/market_chart?vs_currency=usd&days=${days}`;
  const data = await cgFetch<MarketChartResponse>(path, signal, 300_000);
  const points: PricePoint[] = (data.prices ?? []).map(([t, price]) => ({ t, price }));
  if (points.length === 0) {
    throw new Error("CoinGecko: empty market chart");
  }
  const prices = points.map((p) => p.price);
  const open = prices[0];
  const last = prices[prices.length - 1];
  const high = Math.max(...prices);
  const low = Math.min(...prices);
  const change24h = last - open;
  const changePct24h = open !== 0 ? (change24h / open) * 100 : 0;
  const vols = data.total_volumes ?? [];
  const volume24h = vols.length > 0 ? vols[vols.length - 1][1] : 0;
  return { points, last, open, high, low, change24h, changePct24h, volume24h };
}
