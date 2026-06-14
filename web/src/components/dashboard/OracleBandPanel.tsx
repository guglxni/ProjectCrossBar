import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { MarketPollState } from "@/hooks/useMarketPolling";
import { formatPrice } from "@/lib/format";

interface Props {
  poll: Pick<MarketPollState, "oracle" | "batchResult" | "market">;
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
  const maxAge = poll.market ? toNum(poll.market.oracleMaxAgeSlots) : 0;
  const lastSlot = oracle ? toNum(oracle.lastUpdateSlot) : 0;

  const half =
    bandBps > 0 && refPrice > 0
      ? Math.floor((refPrice * bandBps) / 10_000)
      : 0;
  const lo = refPrice > 0 ? refPrice - half : 0;
  const hi = refPrice > 0 ? refPrice + half : 0;

  const pStar = poll.batchResult
    ? toNum(poll.batchResult.clearingPrice)
    : 0;

  const chartPoints =
    refPrice > 0
      ? [
          { label: "lo", value: lo / 1_000_000 },
          { label: "ref", value: refPrice / 1_000_000 },
          { label: "hi", value: hi / 1_000_000 },
          { label: "p*", value: pStar > 0 ? pStar / 1_000_000 : refPrice / 1_000_000 },
        ]
      : [];

  const stale = maxAge > 0 && lastSlot === 0;

  return (
    <Card id="oracle">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Oracle reference band
          {stale && (
            <Badge variant="destructive">Stale / unset</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!oracle || refPrice === 0 ? (
          <p className="text-sm text-muted-foreground">
            Oracle price unset. Band disabled until a reference price is pushed.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">p_ref</p>
                <p className="font-mono text-lg">{formatPrice(refPrice)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Band</p>
                <p className="font-mono text-xs">
                  [{formatPrice(lo)}, {formatPrice(hi)}]
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Last update slot</p>
                <p className="font-mono">{lastSlot || "n/a"}</p>
              </div>
            </div>
            {chartPoints.length > 0 && (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartPoints}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
                    <Tooltip />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="#7a3fb5"
                      fill="#7a3fb520"
                      name="price"
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="#000"
                      dot
                      name="level"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        )}
        <p className="text-xs text-muted-foreground">
          Manual price override requires crank authority. Disabled in this read-only
          dashboard view unless your wallet matches oracle authority.
        </p>
      </CardContent>
    </Card>
  );
}
