import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { TICKER_COINS, type CoinMeta, type TickerEntry } from "@/lib/coingecko";
import { useMarketTicker, type MarketTickerState } from "@/hooks/useMarketTicker";

interface MarketTickerContextValue extends MarketTickerState {
  /** Currently selected coin (drives the live chart + stats panel). */
  selected: CoinMeta;
  setSelected: (c: CoinMeta) => void;
  /** Live ticker row for the selected coin (price + 24h change). */
  selectedEntry: TickerEntry | undefined;
}

const Ctx = createContext<MarketTickerContextValue | null>(null);

/**
 * Runs the live ticker once and shares it (plus the selected coin) with both
 * the marquee and the live market panel, so clicking a coin in the marquee
 * switches the chart — and there is only one polling loop.
 */
export function MarketTickerProvider({ children }: { children: ReactNode }) {
  const ticker = useMarketTicker();
  const [selected, setSelected] = useState<CoinMeta>(TICKER_COINS[0]);

  const value = useMemo<MarketTickerContextValue>(() => {
    const selectedEntry = ticker.entries.find((e) => e.symbol === selected.symbol);
    return { ...ticker, selected, setSelected, selectedEntry };
  }, [ticker, selected]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMarketTickerContext(): MarketTickerContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMarketTickerContext must be used within MarketTickerProvider");
  return v;
}
