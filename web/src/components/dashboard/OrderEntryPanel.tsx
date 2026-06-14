import { BN } from "@coral-xyz/anchor";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMarketContext } from "@/context/MarketContext";
import { useCrossbarProgram } from "@/hooks/useCrossbarProgram";
import { useKoraRelay } from "@/hooks/useKoraRelay";
import type { MarketPollState } from "@/hooks/useMarketPolling";
import {
  FLOW_MAKER,
  FLOW_TAKER,
  SIDE_BUY,
  SIDE_SELL,
} from "@/lib/constants";
import { formatQty } from "@/lib/format";
import { humanToPrice, ooPda, pda } from "@/lib/pdas";
import { sendAndToast } from "@/lib/tx";

interface Props {
  poll: Pick<MarketPollState, "openOrders" | "refresh">;
}

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "toNumber" in v) {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v ?? 0);
}

export function OrderEntryPanel({ poll }: Props) {
  const ctx = useMarketContext();
  const { erProgram, publicKey, connected } = useCrossbarProgram();
  const kora = useKoraRelay();
  const [side, setSide] = useState(String(SIDE_BUY));
  const [flow, setFlow] = useState(String(FLOW_TAKER));
  const [price, setPrice] = useState("100");
  const [qty, setQty] = useState("100");
  const [cancelId, setCancelId] = useState("");

  const oo = poll.openOrders;

  const submitOrder = async (gasless: boolean) => {
    if (!connected || !publicKey || !ctx.marketPubkey) {
      throw new Error("Connect wallet and configure market.");
    }
    const marketPk = ctx.marketPubkey;
    const priceBn = humanToPrice(Number(price));
    const qtyBn = new BN(qty);

    const builder = erProgram.methods
      .submitOrder(Number(side), priceBn, qtyBn, Number(flow))
      .accountsPartial({
        market: marketPk,
        batchBook: pda(erProgram.programId, "book", marketPk),
        openOrders: ooPda(erProgram.programId, marketPk, publicKey),
        owner: publicKey,
      });

    if (gasless && kora.available) {
      const wallet = erProgram.provider.wallet;
      if (!wallet) throw new Error("Wallet not connected");
      const tx = await builder.transaction();
      const { blockhash } =
        await erProgram.provider.connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      // Use Kora's fee payer pubkey so the relayer can co-sign as fee payer.
      // Falls back to the user's key if VITE_KORA_FEE_PAYER is not set and
      // Kora doesn't expose getFeePayerPubkey (Kora still sponsors the fee).
      tx.feePayer = kora.feePayer ?? publicKey;
      const signed = await wallet.signTransaction(tx);
      const serialized = Buffer.from(signed.serialize()).toString("base64");
      await sendAndToast("Gasless submit", () =>
        kora.signAndSendTransaction(serialized),
      );
    } else {
      await sendAndToast("Submit order", () => builder.rpc());
    }
    poll.refresh();
  };

  const cancelOrder = async () => {
    if (!connected || !publicKey || !ctx.marketPubkey) {
      throw new Error("Connect wallet and configure market.");
    }
    const marketPk = ctx.marketPubkey;
    await sendAndToast("Cancel order", () =>
      erProgram.methods
        .cancelOrder(new BN(cancelId))
        .accountsPartial({
          market: marketPk,
          batchBook: pda(erProgram.programId, "book", marketPk),
          openOrders: ooPda(erProgram.programId, marketPk, publicKey),
          owner: publicKey,
        })
        .rpc(),
    );
    poll.refresh();
  };

  return (
    <Card id="orders">
      <CardHeader>
        <CardTitle className="text-base">Order entry (ER)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {oo && (
          <div className="grid grid-cols-2 gap-2 rounded-md border border-border p-3 text-xs md:grid-cols-4">
            <div>
              <p className="text-muted-foreground">Base claimable</p>
              <p className="font-mono">{formatQty(toNum(oo.baseClaimable))}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Quote claimable</p>
              <p className="font-mono">{formatQty(toNum(oo.quoteClaimable))}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Base reserved</p>
              <p className="font-mono">{formatQty(toNum(oo.baseReserved))}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Quote reserved</p>
              <p className="font-mono">{formatQty(toNum(oo.quoteReserved))}</p>
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Side</Label>
            <Select value={side} onValueChange={setSide}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={String(SIDE_BUY)}>Buy</SelectItem>
                <SelectItem value={String(SIDE_SELL)}>Sell</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Flow</Label>
            <Select value={flow} onValueChange={setFlow}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={String(FLOW_MAKER)}>Maker</SelectItem>
                <SelectItem value={String(FLOW_TAKER)}>Taker</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Price limit (human)</Label>
            <Input value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Quantity (base atomic)</Label>
            <Input value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void submitOrder(false)} disabled={!connected}>
            Submit order
          </Button>
          <Button
            variant="outline"
            onClick={() => void submitOrder(true)}
            disabled={!connected || !kora.available}
          >
            Gasless submit {kora.available ? "" : "(Kora offline)"}
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
          <div className="space-y-1">
            <Label>Cancel order ID</Label>
            <Input
              value={cancelId}
              onChange={(e) => setCancelId(e.target.value)}
              className="w-32 font-mono"
            />
          </div>
          <Button variant="destructive" onClick={() => void cancelOrder()} disabled={!connected}>
            Cancel order
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
