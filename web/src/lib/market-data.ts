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

/** 24h % change keyed by symbol: Pyth first, CoinGecko fallback. */
export async function getTicker24hChanges(
  coins: CoinMeta[],
  signal?: AbortSignal,
): Promise<Record<string, number>> {
  try {
    const pyth = await getPythTickerChanges(
      coins.map((c) => c.symbol),
      signal,
    );
    if (Object.keys(pyth).length >= Math.ceil(coins.length / 2)) return pyth;
  } catch {
    /* fall through */
  }

  const rows = await getTickerPrices(coins, signal);
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.change24h != null) out[r.symbol] = r.change24h;
  }
  return out;
}
