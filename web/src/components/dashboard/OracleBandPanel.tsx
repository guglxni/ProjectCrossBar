import { OracleBandChart } from "@/components/charts/OracleBandChart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { MarketPollState } from "@/hooks/useMarketPolling";
import { PRICE_SCALE } from "@/lib/constants";
import { formatPrice } from "@/lib/format";

interface Props {
  poll: Pick<
    MarketPollState,
    "oracle" | "batchResult" | "market" | "priceHistory"
  >;
}

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "toNumber" in v) {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v ?? 0);
}

export function OracleBandPanel({ poll }: Props) {
  const oracle = poll.oracle;
  const refPrice = oracle ? toNum(oracle.price) : 0;
  const bandBps = poll.market ? toNum(poll.market.bandDeltaBps) : 0;
  const lastSlot = oracle ? toNum(oracle.lastUpdateSlot) : 0;

  const half =
    bandBps > 0 && refPrice > 0
      ? Math.floor((refPrice * bandBps) / 10_000)
      : 0;
  const lo = refPrice > 0 ? refPrice - half : 0;
  const hi = refPrice > 0 ? refPrice + half : 0;

  // Show each cleared window's p* against the current reference band so traders
  // can see that the clear always lands inside the allowed range.
  const chartData =
    refPrice > 0
      ? poll.priceHistory.map((p) => ({
          window: p.window,
          pStar: p.clearingPrice / PRICE_SCALE,
          low: lo / PRICE_SCALE,
          high: hi / PRICE_SCALE,
          ref: refPrice / PRICE_SCALE,
        }))
      : [];

  const active = refPrice > 0 && lastSlot > 0;

  return (
    <Card id="oracle">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Oracle reference band
          {active && (
            <Badge
              variant="outline"
              className="border-[var(--success)]/30 text-[var(--success)]"
            >
              <span className="mr-1 h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
              Live
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!oracle || refPrice === 0 ? (
          <p className="text-sm text-muted-foreground">
            Awaiting a reference price. The band activates as soon as an oracle
            price is published for this market.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Reference price</p>
                <p className="font-mono text-lg">{formatPrice(refPrice)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Accepted band</p>
                <p className="font-mono text-xs">
                  [{formatPrice(lo)}, {formatPrice(hi)}]
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Last update slot</p>
                <p className="font-mono">{lastSlot || "n/a"}</p>
              </div>
            </div>
            <OracleBandChart data={chartData} />
          </>
        )}
        <p className="text-xs text-muted-foreground">
          The band keeps every clear anchored to a trusted reference price. Each
          window's p* is verified to fall inside the accepted range before it
          settles.
        </p>
      </CardContent>
    </Card>
  );
}
