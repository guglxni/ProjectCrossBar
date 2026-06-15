/**
 * Unified market context: Flash live price + Pyth Benchmarks history/stats,
 * with Hermes, DefiLlama, and CoinGecko fallbacks.
 */

import {
  type CoinMeta,
  type MarketChart,
  getCoinGeckoMarketChart,
  getTickerPrices,
} from "@/lib/coingecko";
import { getLlamaTickerChanges } from "@/lib/defillama";
import { getPythChart } from "@/lib/pyth-benchmarks";
import { getHermesTickerChanges } from "@/lib/pyth-hermes";

/** Shared refresh cadence for marquee prices, 24h stats, and intraday charts. */
export const MARKET_DATA_INTERVAL_MS = 300_000;

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

function mergeChanges(
  target: Record<string, number>,
  source: Record<string, number>,
): void {
  for (const [sym, pct] of Object.entries(source)) {
    if (target[sym] == null) target[sym] = pct;
  }
}

/**
 * 24h % change keyed by symbol.
 * Hermes (2 batched calls) → DefiLlama (2) → CoinGecko (1) → partial merge.
 */
export async function getTicker24hChanges(
  coins: CoinMeta[],
  signal?: AbortSignal,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const need = () => Object.keys(out).length < Math.ceil(coins.length / 2);

  if (need()) {
    try {
      mergeChanges(out, await getHermesTickerChanges(
        coins.map((c) => c.symbol),
        signal,
      ));
    } catch {
      /* next source */
    }
  }

  if (need()) {
    try {
      mergeChanges(out, await getLlamaTickerChanges(coins, signal));
    } catch {
      /* next source */
    }
  }

  if (need()) {
    try {
      const rows = await getTickerPrices(coins, signal);
      for (const r of rows) {
        if (r.change24h != null && out[r.symbol] == null) {
          out[r.symbol] = r.change24h;
        }
      }
    } catch {
      /* keep partial */
    }
  }

  return out;
}
