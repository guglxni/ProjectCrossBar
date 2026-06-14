import { PriceHistoryChart } from "@/components/charts/PriceHistoryChart";
import { VolumeChart } from "@/components/charts/VolumeChart";
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

  const history = poll.priceHistory;

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
                  <span className="block text-muted-foreground">
                    VRF blast radius only
                  </span>
                </p>
              </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <p className="mb-2 text-xs text-muted-foreground">
                  Clearing price p* per window
                </p>
                <PriceHistoryChart data={history} />
              </div>
              <div>
                <p className="mb-2 text-xs text-muted-foreground">
                  Matched volume per window
                </p>
                <VolumeChart data={history} />
              </div>
            </div>

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
