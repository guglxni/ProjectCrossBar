import { useEffect, useState } from "react";
import type { CoinMeta, MarketChart } from "@/lib/coingecko";
import { getMarketChart } from "@/lib/market-data";

interface ChartState {
  chart: MarketChart | null;
  live: boolean;
  loading: boolean;
  error: string | null;
}

/**
 * Intraday market chart: Pyth Benchmarks (Flash's Pyth oracle) with CoinGecko
 * fallback. Polled slowly; keeps last good data on transient errors.
 */
export function useMarketChart(
  coin: CoinMeta,
  intervalMs = 300_000,
): ChartState {
  const [state, setState] = useState<ChartState>({
    chart: null,
    live: false,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    setState({ chart: null, live: false, loading: true, error: null });

    async function load(isRefresh: boolean) {
      try {
        const chart = await getMarketChart(coin, controller.signal);
        if (cancelled) return;
        setState({ chart, live: true, loading: false, error: null });
      } catch (e) {
        if (cancelled) return;
        setState((s) => ({
          // Never show another symbol's chart after a coin switch.
          chart: isRefresh ? s.chart : null,
          live: isRefresh ? s.live : false,
          loading: false,
          error: isRefresh && s.chart ? null : String(e),
        }));
      }
    }

    load(false);
    const id = setInterval(() => load(true), intervalMs);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(id);
    };
  }, [coin.id, coin.symbol, intervalMs]);

  return state;
}
