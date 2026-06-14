/**
 * Pyth Benchmarks (TradingView shim) — intraday history + 24h stats.
 *
 * Flash Trade prices come from Pyth Lazer; Benchmarks exposes the same oracle
 * family as hourly candles (`Crypto.{SYMBOL}/USD`).
 *
 * Requests are serialized and cached aggressively. The upstream rate-limits burst
 * traffic (shared Vercel egress); on 429 we serve stale cache when available.
 *
 * CrossBar clears on devnet; this is market context only.
 */

import type { MarketChart, PricePoint } from "@/lib/coingecko";

const BASE = "/api/pyth/v1/shims/tradingview";
const CHART_TTL_MS = 300_000;
const STALE_MAX_MS = 1_800_000;
const SYMBOL_GAP_MS = 400;

interface CacheEntry<T> {
  data: T;
  expiry: number;
  fetchedAt: number;
}

const rawCache = new Map<string, CacheEntry<unknown>>();
const chartCache = new Map<string, CacheEntry<MarketChart>>();
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

function historyCacheKey(symbol: string): string {
  const bucket = Math.floor(Date.now() / CHART_TTL_MS);
  return `${symbol}:${bucket}`;
}

function staleChart(symbol: string): MarketChart | null {
  const prefix = `${symbol}:`;
  let best: CacheEntry<MarketChart> | null = null;
  for (const [key, entry] of chartCache) {
    if (!key.startsWith(prefix)) continue;
    if (Date.now() - entry.fetchedAt > STALE_MAX_MS) continue;
    if (!best || entry.fetchedAt > best.fetchedAt) best = entry;
  }
  return best?.data ?? null;
}

async function pythFetchRaw(
  cacheKey: string,
  path: string,
  signal?: AbortSignal,
): Promise<TvHistoryResponse> {
  const hit = rawCache.get(cacheKey) as CacheEntry<TvHistoryResponse> | undefined;
  if (hit && hit.expiry > Date.now()) return hit.data;

  const pending = inflight.get(cacheKey) as Promise<TvHistoryResponse> | undefined;
  if (pending) return pending;

  const task = (async () => {
    const url = `${BASE}${path}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const res = await fetch(url, {
        signal,
        headers: { accept: "application/json" },
      });

      if (res.status === 429) {
        if (hit) return hit.data;
        const stale = staleChart(cacheKey.split(":")[0]);
        if (stale) {
          const synthetic: TvHistoryResponse = {
            s: "ok",
            t: stale.points.map((p) => Math.floor(p.t / 1000)),
            c: stale.points.map((p) => p.price),
            h: stale.points.map((p) => p.price),
            l: stale.points.map((p) => p.price),
          };
          return synthetic;
        }
        if (attempt === 0) {
          await sleep(1500, signal);
          continue;
        }
        throw new Error("Pyth Benchmarks 429");
      }

      if (!res.ok) throw new Error(`Pyth Benchmarks ${res.status}`);
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        throw new Error("Pyth Benchmarks: non-JSON response");
      }
      const data = (await res.json()) as TvHistoryResponse;
      rawCache.set(cacheKey, {
        data,
        expiry: Date.now() + CHART_TTL_MS,
        fetchedAt: Date.now(),
      });
      return data;
    }
    throw new Error("Pyth Benchmarks 429");
  })();

  inflight.set(cacheKey, task);
  try {
    return await task;
  } finally {
    inflight.delete(cacheKey);
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
  const key = historyCacheKey(symbol);
  const hit = chartCache.get(key);
  if (hit && hit.expiry > Date.now()) return hit.data;

  const stale = staleChart(symbol);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const to = Math.floor(Date.now() / 1000);
  const from = to - 86_400;
  const qs = new URLSearchParams({
    symbol: pythTicker(symbol),
    resolution: "60",
    from: String(from),
    to: String(to),
  });

  try {
    const data = await pythFetchRaw(key, `/history?${qs}`, signal);
    const chart = chartFromHistory(data);
    chartCache.set(key, {
      data: chart,
      expiry: Date.now() + CHART_TTL_MS,
      fetchedAt: Date.now(),
    });
    return chart;
  } catch (e) {
    if (stale) return stale;
    throw e;
  }
}

/** 24h % change for many symbols — one at a time to avoid upstream 429 bursts. */
export async function getPythTickerChanges(
  symbols: string[],
  signal?: AbortSignal,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (let i = 0; i < symbols.length; i++) {
    if (signal?.aborted) break;
    const symbol = symbols[i];
    try {
      const chart = await getPythChart(symbol, signal);
      out[symbol] = chart.changePct24h;
    } catch {
      const stale = staleChart(symbol);
      if (stale) out[symbol] = stale.changePct24h;
    }
    if (i < symbols.length - 1) {
      try {
        await sleep(SYMBOL_GAP_MS, signal);
      } catch {
        break;
      }
    }
  }
  return out;
}
