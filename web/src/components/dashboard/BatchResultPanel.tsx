import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MarketPollState } from "@/hooks/useMarketPolling";
import { BATCH_STATUS_LABELS } from "@/lib/constants";
import { formatPrice, formatQty } from "@/lib/format";

interface Props {
  poll: Pick<MarketPollState, "batchResult" | "priceHistory">;
}

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "toNumber" in v) {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v ?? 0);
}

export function BatchResultPanel({ poll }: Props) {
  const result = poll.batchResult;
  const status = result ? toNum(result.status) : -1;
  const statusLabel = BATCH_STATUS_LABELS[status] ?? "Unknown";

  const chartData = poll.priceHistory.map((p) => ({
    window: p.window,
    pStar: p.clearingPrice / 1_000_000,
    volume: p.matchedVolume,
  }));

  const fills = result
    ? ((result.fills as Array<Record<string, unknown>>) ?? []).slice(
        0,
        toNum(result.nFills),
      )
    : [];

  return (
    <Card id="result">
      <CardHeader>
        <CardTitle className="text-base">Last clear result</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {!result ? (
          <p className="text-sm text-muted-foreground">No batch result yet.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <p className="font-medium">{statusLabel}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">p*</p>
                <p className="font-mono text-lg">
                  {formatPrice(toNum(result.clearingPrice))}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Volume</p>
                <p className="font-mono">{formatQty(toNum(result.matchedVolume))}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Fills</p>
                <p className="font-mono">{toNum(result.nFills)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Marginal remainder</p>
                <p className="font-mono text-xs">
                  {formatQty(toNum(result.marginalRemainder))}
                  <span className="block text-muted-foreground">VRF blast radius only</span>
                </p>
              </div>
            </div>

            {chartData.length > 0 && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="h-48">
                  <p className="mb-2 text-xs text-muted-foreground">p* history</p>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis dataKey="window" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="pStar"
                        stroke="#000"
                        dot={false}
                        name="p*"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="h-48">
                  <p className="mb-2 text-xs text-muted-foreground">Volume per window</p>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                      <XAxis dataKey="window" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Bar dataKey="volume" fill="#6f6f6f" name="volume" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order ID</TableHead>
                  <TableHead>Filled qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fills.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-muted-foreground">
                      No fills recorded.
                    </TableCell>
                  </TableRow>
                ) : (
                  fills.map((f) => (
                    <TableRow key={String(f.orderId)}>
                      <TableCell className="font-mono">{toNum(f.orderId)}</TableCell>
                      <TableCell className="font-mono">
                        {formatQty(toNum(f.filled))}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
