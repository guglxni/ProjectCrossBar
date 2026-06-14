import { ArrowDown, ArrowUp } from "lucide-react";
import { useMarketTickerContext } from "@/context/MarketTickerContext";
import { TICKER_COINS, formatPct, formatUsd, type TickerEntry } from "@/lib/coingecko";
import { cn } from "@/lib/utils";

function TickerItem({
  e,
  active,
  onClick,
}: {
  e: TickerEntry;
  active?: boolean;
  onClick: () => void;
}) {
  const up = e.change24h == null ? true : e.change24h >= 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-1 text-sm transition-colors hover:bg-accent/10",
        active && "bg-accent/10 ring-1 ring-accent/40",
      )}
    >
      <span className="font-medium text-foreground">{e.symbol}</span>
      <span className="font-mono tabular-nums text-muted-foreground">
        {formatUsd(e.price)}
      </span>
      {e.change24h != null ? (
        <span
          className={cn(
            "inline-flex items-center gap-0.5 font-mono text-xs tabular-nums",
            up ? "text-[var(--success)]" : "text-destructive",
          )}
        >
          {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          {formatPct(e.change24h)}
        </span>
      ) : (
        <span className="font-mono text-xs tabular-nums text-muted-foreground">—</span>
      )}
    </button>
  );
}

/**
 * Live crypto price marquee, in the spirit of the flash.trade top bar. The
 * currently selected coin is pinned at the start (highlighted, not scrolling);
 * the remaining coins scroll. Click any scrolling coin and it takes the pinned
 * slot and drives the live chart + stats panel. Prices are live from Flash
 * Trade; 24h change from Pyth Benchmarks. Hovering pauses the scroll.
 */
export function PriceTicker() {
  const { entries, live, source, selected, setSelected, selectedEntry } =
    useMarketTickerContext();
  const metaBySymbol = new Map(TICKER_COINS.map((c) => [c.symbol, c]));

  const pinned =
    selectedEntry ?? {
      id: selected.id,
      symbol: selected.symbol,
      pair: selected.pair,
      price: 0,
      change24h: null,
    };

  const rest = entries.filter((e) => e.symbol !== selected.symbol);
  const scrollItems = (keyPrefix: string) =>
    rest.map((e) => (
      <TickerItem
        key={`${keyPrefix}-${e.id}`}
        e={e}
        onClick={() => {
          const meta = metaBySymbol.get(e.symbol);
          if (meta) setSelected(meta);
        }}
      />
    ));

  return (
    <div className="relative flex items-center overflow-hidden border-y border-border bg-card/60 backdrop-blur">
      <div className="z-10 flex shrink-0 items-center gap-1.5 border-r border-border bg-background/80 px-3 py-2">
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            live ? "animate-pulse bg-[var(--success)]" : "bg-muted-foreground",
          )}
        />
        <span className="text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">
          {source === "flash" ? "Flash · live" : "Live"}
        </span>
      </div>

      {/* pinned selected coin — stays in place until another is chosen */}
      <div className="z-10 shrink-0 border-r border-border bg-background/60 px-2 py-1.5">
        <TickerItem e={pinned} active onClick={() => {}} />
      </div>

      {/* scrolling remainder */}
      <div className="group flex-1 overflow-hidden py-1.5">
        <div className="flex w-max animate-marquee items-center gap-1 group-hover:[animation-play-state:paused]">
          {scrollItems("a")}
          {/* duplicate track for a seamless loop */}
          {scrollItems("b")}
        </div>
      </div>
    </div>
  );
}
