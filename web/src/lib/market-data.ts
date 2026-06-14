/**
 * Unified market context: Flash live price + Pyth Benchmarks history/stats,
 * with CoinGecko as a fallback when Pyth or the proxy is unavailable.
 */

import {
  type CoinMeta,
  type MarketChart,
  getCoinGeckoMarketChart,
  getTickerPrices,
} from "@/lib/coingecko";
import { getPythChart, getPythTickerChanges } from "@/lib/pyth-benchmarks";

/** Intraday chart: Pyth Benchmarks first, CoinGecko fallback. */
export async function getMarketChart(
  coin: CoinMeta,
  signal?: AbortSignal,
): Promise<MarketChart> {
  try {
    return await getPythChart(coin.symbol, signal);
  } catch {
    return getCoinGeckoMarketChart(coin.id, 1, signal);
  }
}

/**
 * 24h % change keyed by symbol.
 * Prefer one CoinGecko batch (single request); fall back to sequential Pyth.
 */
export async function getTicker24hChanges(
  coins: CoinMeta[],
  signal?: AbortSignal,
): Promise<Record<string, number>> {
  try {
    const rows = await getTickerPrices(coins, signal);
    const out: Record<string, number> = {};
    for (const r of rows) {
      if (r.change24h != null) out[r.symbol] = r.change24h;
    }
    if (Object.keys(out).length >= Math.ceil(coins.length / 2)) return out;
  } catch {
    /* fall through */
  }

  return getPythTickerChanges(
    coins.map((c) => c.symbol),
    signal,
  );
}
