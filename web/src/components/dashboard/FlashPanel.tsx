import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FLASH_API_URL, FLASH_MOCK } from "@/lib/constants";
import { formatPrice } from "@/lib/format";
import { FlashClient } from "@/lib/flash-client";
import type { MarketPollState } from "@/hooks/useMarketPolling";

interface Props {
  poll: Pick<MarketPollState, "batchResult" | "oracle">;
}

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "toNumber" in v) {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v ?? 0);
}

export function FlashPanel({ poll }: Props) {
  const [solPrice, setSolPrice] = useState<number | null>(null);
  const [poolValue, setPoolValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const crossbarRef = poll.oracle ? toNum(poll.oracle.price) : 0;
  const crossbarPStar = poll.batchResult
    ? toNum(poll.batchResult.clearingPrice)
    : 0;

  useEffect(() => {
    if (FLASH_MOCK) {
      setSolPrice(142.5);
      setPoolValue("MOCK $12.4M TVL");
      return;
    }

    const client = new FlashClient({ baseUrl: FLASH_API_URL });
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const prices = await client.getPrices();
        const sol = prices.SOL?.priceUi ?? prices.WSOL?.priceUi ?? null;
        const pools = await client.getPoolData();
        const first = pools.pools[0];
        if (!cancelled) {
          setSolPrice(sol);
          setPoolValue(first?.lpStats?.totalPoolValueUsd ?? null);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card id="flash">
      <CardHeader>
        <CardTitle className="text-base">Flash Trade (read-only)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertTitle>Network split</AlertTitle>
          <AlertDescription>
            Flash API is <strong>mainnet read-only</strong>. CrossBar is{" "}
            <strong>devnet</strong>. Hedge preview is{" "}
            {FLASH_MOCK ? (
              <strong>MOCK</strong>
            ) : (
              <strong>LIVE mainnet prices</strong>
            )}{" "}
            unless VITE_FLASH_MOCK=0.
          </AlertDescription>
        </Alert>

        {FLASH_MOCK && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            MOCK mode: synthesized Flash responses for UI preview.
          </div>
        )}

        {loading && <p className="text-sm text-muted-foreground">Loading Flash data...</p>}
        {error && (
          <p className="text-sm text-destructive">Flash fetch failed: {error}</p>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">Flash SOL (mainnet)</p>
            <p className="font-mono text-lg">
              {solPrice != null ? `$${solPrice.toFixed(2)}` : "n/a"}
            </p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">CrossBar oracle ref (devnet)</p>
            <p className="font-mono text-lg">
              {crossbarRef > 0 ? formatPrice(crossbarRef) : "unset"}
            </p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">Last p* (devnet)</p>
            <p className="font-mono text-lg">
              {crossbarPStar > 0 ? formatPrice(crossbarPStar) : "n/a"}
            </p>
          </div>
        </div>

        {poolValue && (
          <div className="rounded-md border border-border p-3 text-sm">
            <p className="text-xs text-muted-foreground">Pool utilization snapshot</p>
            <p className="font-mono">{poolValue}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
