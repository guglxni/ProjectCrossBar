import { useEffect, useRef, useState } from "react";
import { TICKER_COINS, getTickerPrices, type TickerEntry } from "@/lib/coingecko";
import { getFlashPrices } from "@/lib/flash-prices";
import { getTicker24hChanges } from "@/lib/market-data";

/**
 * Live market ticker with Flash Trade as the PRIMARY price source.
 *
 * - Price: Flash Trade `/prices` (live Pyth Lazer feed).
 * - 24h change %: Pyth Benchmarks (same oracle family as Flash), CoinGecko fallback.
 *
 * Both are polled independently and merged. Last good values are kept across
 * transient errors so the marquee never empties.
 */

const SEED_PRICE: Record<string, number> = {
  SOL: 142.5,
  ETH: 3120,
  BTC: 64200,
  BNB: 604,
  HYPE: 41,
  JUP: 0.78,
  BONK: 0.0000182,
  JTO: 2.45,
  PYTH: 0.42,
  WIF: 1.6,
};

export interface MarketTickerState {
  entries: TickerEntry[];
  live: boolean;
  source: "flash" | "coingecko" | "seed";
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
    const id = setInterval(load, 10_000);
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
            for (const r of rows) prices[r.symbol] = r.price;
            setCgPrices(prices);
          }
        } catch {
          /* keep last good */
        }
      }
    }
    load();
    const id = setInterval(load, 120_000);
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
      : "seed";

  const entries: TickerEntry[] = TICKER_COINS.map((c) => {
    const price =
      flash?.[c.symbol] ?? cgPrices?.[c.symbol] ?? SEED_PRICE[c.symbol] ?? 0;
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
