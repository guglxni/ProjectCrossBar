import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LivePriceChart } from "@/components/charts/LivePriceChart";
import { useMarketTickerContext } from "@/context/MarketTickerContext";
import { useMarketChart } from "@/hooks/useCoinGecko";
import { formatPct, formatUsd, type PricePoint } from "@/lib/coingecko";
import { cn } from "@/lib/utils";

function formatCompactUsd(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(2)}K`;
  return `$${v.toFixed(0)}`;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="min-w-0">
      <p className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "truncate font-mono text-sm tabular-nums",
          tone === "up" && "text-[var(--success)]",
          tone === "down" && "text-destructive",
          !tone && "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * Live trading panel: the selected coin's live price (Flash Trade), 24h stats,
 * and an intraday area chart (Pyth Benchmarks history). The coin is chosen by clicking
 * the marquee above — switching it re-points the chart, exactly like flash.trade
 * switching SOL/USD → BTC/USD. Prices from Flash Trade; 24h change from Pyth
 * Benchmarks. Market context only; CrossBar clears on devnet.
 */
export function LiveMarketPanel() {
  const { selected, selectedEntry, source } = useMarketTickerContext();
  const { chart, loading, error } = useMarketChart(selected);

  // Live price prefers Flash (selectedEntry); chart's last is the fallback.
  const livePrice = selectedEntry?.price ?? chart?.last ?? 0;
  // 24h change prefers Pyth (selectedEntry.change24h); chart-derived fallback.
  const changePct =
    selectedEntry?.change24h ?? chart?.changePct24h ?? null;
  const up = changePct == null ? true : changePct >= 0;

  // Live tail: append the live Flash price as fresh points so the chart's right
  // edge advances in real time on top of the Pyth intraday history. Reset
  // whenever the selected coin changes.
  const [liveTail, setLiveTail] = useState<PricePoint[]>([]);

  useEffect(() => {
    setLiveTail([]);
  }, [selected.symbol]);

  useEffect(() => {
    if (!livePrice || livePrice <= 0) return;
    setLiveTail((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.price === livePrice) return prev; // unchanged tick
      const next = [...prev, { t: Date.now(), price: livePrice }];
      return next.length > 180 ? next.slice(-180) : next;
    });
  }, [livePrice]);

  const points = useMemo<PricePoint[]>(() => {
    const base = chart?.points ?? [];
    if (!liveTail.length) return base;
    const baseLastT = base.length ? base[base.length - 1].t : 0;
    // Only append ticks newer than the history's last point.
    const fresh = liveTail.filter((p) => p.t > baseLastT);
    return base.concat(fresh);
  }, [chart, liveTail]);

  return (
    <Card id="livemarket" className="overflow-hidden">
      <CardContent className="space-y-5 p-5">
        {/* headline */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-2xl leading-none tracking-tight">
                {selected.pair}
              </h2>
              <Badge variant="outline" className="shrink-0 gap-1">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    source === "flash" ? "animate-pulse bg-[var(--success)]" : "bg-muted-foreground",
                  )}
                />
                {source === "flash" ? "Flash · Pyth" : "Live"}
              </Badge>
            </div>
            <div className="mt-2 flex items-baseline gap-3">
              <span className="font-mono text-3xl font-semibold tabular-nums">
                {formatUsd(livePrice)}
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 font-mono text-sm tabular-nums",
                  changePct == null
                    ? "text-muted-foreground"
                    : up
                      ? "text-[var(--success)]"
                      : "text-destructive",
                )}
              >
                {changePct != null && (
                  <>
                    {up ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
                    {formatPct(changePct)}
                  </>
                )}
                {changePct == null && formatPct(null)}
                <span className="ml-1 text-muted-foreground">24h</span>
              </span>
            </div>
          </div>

          {/* 24h stats */}
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-4">
            <Stat label="24h High" value={chart ? formatUsd(chart.high) : "—"} />
            <Stat label="24h Low" value={chart ? formatUsd(chart.low) : "—"} />
            <Stat
              label="24h Change"
              value={chart ? formatPct(chart.changePct24h) : "—"}
              tone={chart ? (chart.changePct24h >= 0 ? "up" : "down") : undefined}
            />
            <Stat
              label="24h Volume"
              value={chart && chart.volume24h > 0 ? formatCompactUsd(chart.volume24h) : "—"}
            />
          </div>
        </div>

        {/* chart */}
        <div className="rounded-md border border-border bg-background/40 p-2">
          {error && !chart ? (
            <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
              Live chart temporarily unavailable.
            </div>
          ) : (
            <LivePriceChart
              key={selected.symbol}
              chartKey={selected.symbol}
              data={points}
              up={up}
            />
          )}
        </div>

        {/* link out to Flash */}
        <div className="flex items-center justify-end">
          <a
            href="https://www.flash.trade/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            view more on{" "}
            <span className="font-medium text-accent">FLASH.TRADE</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        <p className="text-xs text-muted-foreground">
          {loading && !chart ? "Loading live market data… " : ""}
          Live price via Flash Trade (Pyth); 24h change and intraday history via
          Pyth Benchmarks (CoinGecko fallback). Market context only — CrossBar
          matching and clearing run on devnet inside the ER.
        </p>
      </CardContent>
    </Card>
  );
}
