import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LivePriceChart } from "@/components/charts/LivePriceChart";
import { useMarketTickerContext } from "@/context/MarketTickerContext";
import { useMarketChart } from "@/hooks/useCoinGecko";
import { formatPct, formatUsd, type PricePoint } from "@/lib/coingecko";
import { cn } from "@/lib/utils";

// Live ticks are bucketed onto this 5-minute grid — the same boundaries Pyth
// Benchmarks candles fall on — so the chart only advances on :00/:05/:10/… ,
// never at an arbitrary refresh time.
const BUCKET_MS = 300_000;

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
 * Market context panel: Flash Trade price, Pyth Benchmarks 24h stats, and
 * intraday chart. Marquee selection switches the pair. All market data refreshes
 * every 5 minutes (same cadence as the hourly chart buckets). CrossBar clears on devnet.
 */
export function LiveMarketPanel() {
  const { selected, selectedEntry, source, updatedAt } = useMarketTickerContext();
  const { chart, loading, error } = useMarketChart(selected);

  // The established price from real history — the trust anchor for live ticks.
  const refPrice = chart?.last ?? null;
  const flashPrice = selectedEntry?.price ?? null;

  // A Flash tick is trusted as real ONLY when the Flash feed is actually live
  // AND the value sits within a sane band of the established history price. This
  // rejects any bad oracle print (and, by construction, anything not from Flash),
  // so nothing fabricated ever reaches the chart or headline.
  const isVerifiedLive = (p: number | null): p is number =>
    source === "flash" &&
    p != null &&
    p > 0 &&
    (refPrice == null || refPrice <= 0 || Math.abs(p - refPrice) / refPrice <= 0.2);

  // Verified data only: a real Flash price, else the chart's last real value,
  // else null (renders as a dash). No seed/placeholder can ever appear here.
  const livePrice = isVerifiedLive(flashPrice) ? flashPrice : refPrice ?? null;
  const changePct =
    selectedEntry?.change24h ?? chart?.changePct24h ?? null;
  const up = changePct == null ? true : changePct >= 0;

  // Live tail: one VERIFIED Flash tick per 5-minute bucket. Each tick snaps to
  // its bucket start (floor to BUCKET_MS), so a refresh at 10:48 records against
  // the 10:45 bucket — the chart's right edge holds 10:45 and only advances when
  // the 10:50 bucket opens, matching how Pyth's candles are spaced. Never plots
  // a fabricated value. Reset whenever the selected coin changes.
  const [liveTail, setLiveTail] = useState<PricePoint[]>([]);
  const tailCoin = useRef(selected.id);
  if (tailCoin.current !== selected.id) {
    tailCoin.current = selected.id;
    if (liveTail.length) setLiveTail([]);
  }
  useEffect(() => {
    if (!isVerifiedLive(flashPrice)) return;
    const bucket = Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS;
    setLiveTail((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.t === bucket) {
        // Same 5-min bucket: refresh its value in place, never add a new point.
        if (last.price === flashPrice) return prev;
        const copy = prev.slice();
        copy[copy.length - 1] = { t: bucket, price: flashPrice };
        return copy;
      }
      const next = [...prev, { t: bucket, price: flashPrice }];
      return next.length > 48 ? next.slice(-48) : next; // ~4h of 5-min ticks
    });
    // isVerifiedLive closes over source + refPrice; both are in the dep list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashPrice, source, refPrice]);

  // History + verified live ticks newer than the last history point.
  const points = useMemo<PricePoint[]>(() => {
    const base = chart?.points ?? [];
    if (!liveTail.length) return base;
    const baseLastT = base.length ? base[base.length - 1].t : 0;
    const fresh = liveTail.filter((p) => p.t > baseLastT);
    return base.concat(fresh);
  }, [chart, liveTail]);

  const updatedLabel =
    updatedAt != null
      ? new Date(updatedAt).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

  return (
    <Card id="livemarket" className="overflow-hidden">
      <CardContent className="space-y-5 p-5">
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
                    source === "flash" ? "bg-[var(--success)]" : "bg-muted-foreground",
                  )}
                />
                {source === "flash" ? "Flash · Pyth · 5m" : "5m refresh"}
              </Badge>
            </div>
            <div className="mt-2 flex items-baseline gap-3">
              <span className="font-mono text-3xl font-semibold tabular-nums">
                {livePrice == null ? "—" : formatUsd(livePrice)}
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
          {loading && !chart ? "Loading market data… " : ""}
          Prices (Flash Trade), 24h change (Pyth Hermes), and chart (Pyth Benchmarks)
          refresh every 5 minutes
          {updatedLabel ? ` · last update ${updatedLabel}` : ""}. Market context only —
          CrossBar matching and clearing run on devnet inside the ER.
        </p>
      </CardContent>
    </Card>
  );
}
