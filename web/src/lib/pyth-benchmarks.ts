/**
 * Pyth Benchmarks (TradingView shim) — intraday history + 24h stats.
 *
 * Flash Trade prices come from Pyth Lazer; Benchmarks exposes the same oracle
 * family as hourly candles (`Crypto.{SYMBOL}/USD`). No API key required today
 * (Bearer token required from July 2026 per Pyth docs).
 *
 * CrossBar clears on devnet; this is market context only.
 */

import type { MarketChart, PricePoint } from "@/lib/coingecko";

const BASE = "/api/pyth/v1/shims/tradingview";

interface CacheEntry<T> {
  data: T;
  expiry: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

async function pythFetch<T>(
  path: string,
  signal?: AbortSignal,
  ttlMs = 120_000,
): Promise<T> {
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
    if (!res.ok) throw new Error(`Pyth Benchmarks ${res.status}`);
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

/** Pyth ticker string — matches Flash Trade `pythTicker` (e.g. Crypto.SOL/USD). */
export function pythTicker(symbol: string): string {
  return `Crypto.${symbol}/USD`;
}

interface TvHistoryResponse {
  s: string;
  t?: number[];
  c?: number[];
  h?: number[];
  l?: number[];
  v?: number[];
}

function chartFromHistory(data: TvHistoryResponse): MarketChart {
  if (data.s !== "ok" || !data.t?.length || !data.c?.length) {
    throw new Error("Pyth Benchmarks: empty history");
  }
  const points: PricePoint[] = data.t.map((t, i) => ({
    t: t * 1000,
    price: data.c![i],
  }));
  const closes = data.c;
  const open = closes[0];
  const last = closes[closes.length - 1];
  const highs = data.h ?? closes;
  const lows = data.l ?? closes;
  const high = Math.max(...highs);
  const low = Math.min(...lows);
  const change24h = last - open;
  const changePct24h = open !== 0 ? (change24h / open) * 100 : 0;
  const volume24h = (data.v ?? []).reduce((sum, v) => sum + v, 0);
  return { points, last, open, high, low, change24h, changePct24h, volume24h };
}

/** Intraday (24h) chart for one Flash symbol via Pyth Benchmarks. */
export async function getPythChart(
  symbol: string,
  signal?: AbortSignal,
): Promise<MarketChart> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 86_400;
  const qs = new URLSearchParams({
    symbol: pythTicker(symbol),
    resolution: "60",
    from: String(from),
    to: String(to),
  });
  const data = await pythFetch<TvHistoryResponse>(
    `/history?${qs}`,
    signal,
    300_000,
  );
  return chartFromHistory(data);
}

/** 24h % change for many symbols (parallel, deduped cache per symbol). */
export async function getPythTickerChanges(
  symbols: string[],
  signal?: AbortSignal,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const results = await Promise.allSettled(
    symbols.map(async (symbol) => {
      const chart = await getPythChart(symbol, signal);
      return { symbol, changePct24h: chart.changePct24h };
    }),
  );
  for (const r of results) {
    if (r.status === "fulfilled") {
      out[r.value.symbol] = r.value.changePct24h;
    }
  }
  return out;
}
