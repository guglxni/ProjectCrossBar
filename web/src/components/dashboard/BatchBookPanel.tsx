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
import { FLOW_MAKER, SIDE_BUY } from "@/lib/constants";
import { formatPrice, formatQty, truncatePubkey } from "@/lib/format";

interface Props {
  poll: Pick<MarketPollState, "batchBook" | "market">;
}

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "toNumber" in v) {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v ?? 0);
}

export function BatchBookPanel({ poll }: Props) {
  const book = poll.batchBook;
  const formingWindow = toNum(poll.market?.currentWindow);
  const nOrders = toNum(book?.nOrders);
  const bookWindow = toNum(book?.window);
  const orders = (book?.orders as Array<Record<string, unknown>> | undefined) ?? [];

  const liveOrders = orders
    .slice(0, nOrders)
    .filter((o) => toNum(o.remaining) > 0);

  return (
    <Card id="book">
      <CardHeader>
        <CardTitle className="text-base">
          Live batch book
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            window {bookWindow} · {nOrders} orders
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!book ? (
          <p className="text-sm text-muted-foreground">No batch book data yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Side</TableHead>
                <TableHead>Flow</TableHead>
                <TableHead>Limit</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Window</TableHead>
                <TableHead>Owner</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {liveOrders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    No open orders in the forming window.
                  </TableCell>
                </TableRow>
              ) : (
                liveOrders.map((o) => {
                  const window = toNum(o.window);
                  const forming = window === formingWindow;
                  return (
                    <TableRow
                      key={String(o.orderId)}
                      className={forming ? "bg-muted/40" : ""}
                    >
                      <TableCell>
                        {toNum(o.side) === SIDE_BUY ? "Buy" : "Sell"}
                      </TableCell>
                      <TableCell>
                        {toNum(o.flow) === FLOW_MAKER ? "Maker" : "Taker"}
                      </TableCell>
                      <TableCell className="font-mono">
                        {formatPrice(toNum(o.priceLimit))}
                      </TableCell>
                      <TableCell className="font-mono">
                        {formatQty(toNum(o.remaining))}
                      </TableCell>
                      <TableCell className="font-mono">{window}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {truncatePubkey(String(o.owner))}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
