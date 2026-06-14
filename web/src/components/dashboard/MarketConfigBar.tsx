import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMarketContext } from "@/context/MarketContext";

export function MarketConfigBar() {
  const { marketPubkey, baseMint, quoteMint, setConfig } = useMarketContext();
  const [market, setMarket] = useState(marketPubkey?.toBase58() ?? "");
  const [base, setBase] = useState(baseMint?.toBase58() ?? "");
  const [quote, setQuote] = useState(quoteMint?.toBase58() ?? "");

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="mb-3 text-sm font-medium">Market configuration</p>
      <p className="mb-4 text-xs text-muted-foreground">
        Set a devnet market pubkey and mints. Values persist in localStorage.
        Leave market empty to derive from mints.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="market-pk">Market pubkey</Label>
          <Input
            id="market-pk"
            value={market}
            onChange={(e) => setMarket(e.target.value)}
            placeholder="Optional if mints set"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="base-mint">Base mint</Label>
          <Input
            id="base-mint"
            value={base}
            onChange={(e) => setBase(e.target.value)}
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="quote-mint">Quote mint</Label>
          <Input
            id="quote-mint"
            value={quote}
            onChange={(e) => setQuote(e.target.value)}
            className="font-mono text-xs"
          />
        </div>
      </div>
      <Button
        className="mt-3"
        size="sm"
        onClick={() => setConfig(market, base, quote)}
      >
        Save configuration
      </Button>
    </div>
  );
}
