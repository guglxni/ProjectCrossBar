import { useEffect, useRef, useState } from "react";
import { TICKER_COINS, getTickerPrices, type TickerEntry } from "@/lib/coingecko";
import { getFlashPrices } from "@/lib/flash-prices";
import { getTicker24hChanges, MARKET_DATA_INTERVAL_MS } from "@/lib/market-data";

/**
 * Live market ticker with Flash Trade as the PRIMARY price source.
 *
 * - Price: Flash Trade `/prices` (live Pyth Lazer feed).
 * - 24h change %: Pyth Hermes → DefiLlama → CoinGecko (browser-direct).
 *
 * Prices and 24h stats refresh on the same 5-minute cadence as the chart.
 *
 * There are NO seeded/placeholder prices: a coin's price is `null` until a real
 * source returns it. Verified live data only — nothing fabricated ever renders.
 */

export interface MarketTickerState {
  entries: TickerEntry[];
  live: boolean;
  source: "flash" | "coingecko" | "loading";
  updatedAt: number | null;
}

export function useMarketTicker(): MarketTickerState {
  const [flash, setFlash] = useState<Record<string, number> | null>(null);
  const [change24h, setChange24h] = useState<Record<string, number> | null>(null);
  const [cgPrices, setCgPrices] = useState<Record<string, number> | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const flashOk = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    async function load() {
      try {
        const prices = await getFlashPrices(controller.signal);
        if (!cancelled) {
          setFlash(prices);
          flashOk.current = true;
          setUpdatedAt(Date.now());
        }
      } catch {
        /* keep last good */
      }
    }
    load();
    const id = setInterval(load, MARKET_DATA_INTERVAL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      try {
        const change = await getTicker24hChanges(TICKER_COINS, controller.signal);
        if (!cancelled && Object.keys(change).length > 0) {
          setChange24h(change);
        }
      } catch {
        /* keep last good */
      }

      if (!flashOk.current) {
        try {
          const rows = await getTickerPrices(TICKER_COINS, controller.signal);
          if (!cancelled) {
            const prices: Record<string, number> = {};
            for (const r of rows) {
              if (r.price != null) prices[r.symbol] = r.price;
            }
            setCgPrices(prices);
          }
        } catch {
          /* keep last good */
        }
      }
    }

    load();
    const id = setInterval(load, MARKET_DATA_INTERVAL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(id);
    };
  }, []);

  const haveFlash = flash !== null;
  const source: MarketTickerState["source"] = haveFlash
    ? "flash"
    : cgPrices
      ? "coingecko"
      : "loading";

  const entries: TickerEntry[] = TICKER_COINS.map((c) => {
    // No seed: price is null until Flash (or the CoinGecko fallback) returns it.
    const price = flash?.[c.symbol] ?? cgPrices?.[c.symbol] ?? null;
    const pct = change24h?.[c.symbol] ?? null;
    return { id: c.id, symbol: c.symbol, pair: c.pair, price, change24h: pct };
  });

  return {
    entries,
    live: haveFlash || change24h !== null,
    source,
    updatedAt,
  };
}
