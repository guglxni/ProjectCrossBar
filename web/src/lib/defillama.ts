/**
 * DefiLlama coins API — FOSS fallback for 24h % change.
 *
 * Browser-direct (CORS *). Two requests: current prices + prices 24h ago.
 */

import type { CoinMeta } from "@/lib/coingecko";

const LLAMA = "https://coins.llama.fi";

const CACHE_TTL_MS = 300_000;
let cachedChanges: { at: number; data: Record<string, number> } | null = null;

function llamaKey(coin: CoinMeta): string {
  return `coingecko:${coin.id}`;
}

async function llamaFetch<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    signal,
    headers: { accept: "application/json" },
  });
  if (res.status === 429) throw new Error("DefiLlama 429");
  if (!res.ok) throw new Error(`DefiLlama ${res.status}`);
  return (await res.json()) as T;
}

/** 24h % change keyed by symbol — DefiLlama current + historical batch. */
export async function getLlamaTickerChanges(
  coins: CoinMeta[],
  signal?: AbortSignal,
): Promise<Record<string, number>> {
  if (cachedChanges && Date.now() - cachedChanges.at < CACHE_TTL_MS) {
    return cachedChanges.data;
  }

  const keys = coins.map(llamaKey).join(",");
  const ts24 = Math.floor(Date.now() / 1000) - 86_400;

  type Row = { price: number; symbol?: string };
  type Resp = { coins: Record<string, Row> };

  const [current, historical] = await Promise.all([
    llamaFetch<Resp>(`${LLAMA}/prices/current/${keys}`, signal),
    llamaFetch<Resp>(`${LLAMA}/prices/historical/${ts24}/${keys}`, signal),
  ]);

  const out: Record<string, number> = {};
  for (const coin of coins) {
    const key = llamaKey(coin);
    const now = current.coins[key]?.price;
    const then = historical.coins[key]?.price;
    if (now == null || then == null || then === 0) continue;
    out[coin.symbol] = ((now - then) / then) * 100;
  }

  if (Object.keys(out).length > 0) {
    cachedChanges = { at: Date.now(), data: out };
  }
  return out;
}
