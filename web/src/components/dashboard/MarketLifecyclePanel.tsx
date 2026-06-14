import { BN } from "@coral-xyz/anchor";
import * as anchor from "@coral-xyz/anchor";
import { SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useMarketContext } from "@/context/MarketContext";
import { useCrossbarProgram } from "@/hooks/useCrossbarProgram";
import type { MarketPollState } from "@/hooks/useMarketPolling";
import { MARKET_STATUS_LABELS, VALIDATOR } from "@/lib/constants";
import { formatQty } from "@/lib/format";
import { ooPda, pda } from "@/lib/pdas";
import { sendAndToast } from "@/lib/tx";

interface Props {
  poll: Pick<MarketPollState, "market" | "refresh">;
}

function marketStatusKey(market: Record<string, unknown> | null): string {
  if (!market?.status || typeof market.status !== "object") return "unknown";
  return Object.keys(market.status as object)[0] ?? "unknown";
}

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "toNumber" in v) {
    return (v as { toNumber: () => number }).toNumber();
  }
  return Number(v ?? 0);
}

export function MarketLifecyclePanel({ poll }: Props) {
  const ctx = useMarketContext();
  const { baseProgram, erProgram, baseConnection, publicKey, connected } = useCrossbarProgram();
  const [depositAmt, setDepositAmt] = useState("1000000");
  const [depositBase, setDepositBase] = useState(true);

  const market = poll.market;
  const statusKey = marketStatusKey(market);
  const statusLabel = MARKET_STATUS_LABELS[statusKey] ?? statusKey;
  const isDelegated = statusKey === "delegated";
  const isErAccent = statusKey === "delegated" || statusKey === "settling";

  const windowElapsed = toNum(market?.windowTicksElapsed);
  const windowTarget = toNum(market?.windowTargetTicks);
  const windowPct =
    windowTarget > 0 ? Math.min(100, (windowElapsed / windowTarget) * 100) : 0;

  const cfmmBase = toNum(market?.cfmmBase);
  const cfmmQuote = toNum(market?.cfmmQuote);
  const cfmmEnabled = cfmmBase > 0 || cfmmQuote > 0;

  const requireWallet = () => {
    if (!connected || !publicKey || !ctx.marketPubkey) {
      throw new Error("Connect wallet and configure a market first.");
    }
  };

  const valMeta = [{ pubkey: VALIDATOR, isSigner: false, isWritable: false }];
  const cuMax = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({
    units: 1_400_000,
  });

  const handleDeposit = async () => {
    requireWallet();
    const marketPk = ctx.marketPubkey!;
    const mint = depositBase ? ctx.baseMint : ctx.quoteMint;
    const vault = depositBase ? ctx.baseVault : ctx.quoteVault;
    if (!mint || !vault) throw new Error("Mint or vault missing");
    const ata = getAssociatedTokenAddressSync(mint, publicKey!);
    await sendAndToast("Deposit", () =>
      baseProgram.methods
        .deposit(new BN(depositAmt), depositBase)
        .accountsPartial({
          market: marketPk,
          vault,
          userTokenAccount: ata,
          openOrders: ooPda(baseProgram.programId, marketPk, publicKey!),
          owner: publicKey!,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    );
    poll.refresh();
  };

  const handleDelegate = async () => {
    requireWallet();
    const marketPk = ctx.marketPubkey!;
    await sendAndToast("Set delegated", () =>
      baseProgram.methods
        .setDelegated()
        .accountsPartial({ market: marketPk, authority: publicKey! })
        .rpc(),
    );
    await sendAndToast("Delegate market", () =>
      baseProgram.methods
        .delegateMarket()
        .accountsPartial({
          payer: publicKey!,
          authority: publicKey!,
          baseMint: ctx.baseMint!,
          quoteMint: ctx.quoteMint!,
          market: marketPk,
          book: pda(baseProgram.programId, "book", marketPk),
          result: pda(baseProgram.programId, "result", marketPk),
          oracle: pda(baseProgram.programId, "oracle", marketPk),
        })
        .remainingAccounts(valMeta)
        .preInstructions([cuMax])
        .rpc(),
    );
    // Delegate the connected wallet's OpenOrders so submit_order works in the ER.
    await sendAndToast("Delegate open orders", () =>
      baseProgram.methods
        .delegateOpenOrders(publicKey!)
        .accountsPartial({
          payer: publicKey!,
          authority: publicKey!,
          market: marketPk,
          openOrders: ooPda(baseProgram.programId, marketPk, publicKey!),
        })
        .remainingAccounts(valMeta)
        .preInstructions([cuMax])
        .rpc(),
    );
    poll.refresh();
  };

  const handleUndelegate = async () => {
    requireWallet();
    const marketPk = ctx.marketPubkey!;
    await sendAndToast("Undelegate market", () =>
      erProgram.methods
        .undelegateMarket()
        .accountsPartial({
          payer: publicKey!,
          authority: publicKey!,
          market: marketPk,
          batchBook: pda(erProgram.programId, "book", marketPk),
          batchResult: pda(erProgram.programId, "result", marketPk),
          oraclePrice: pda(erProgram.programId, "oracle", marketPk),
        })
        .preInstructions([cuMax])
        .rpc(),
    );
    // Undelegate the connected wallet's OpenOrders (required before settle on L1).
    await sendAndToast("Undelegate open orders", () =>
      erProgram.methods
        .undelegateOpenOrders()
        .accountsPartial({
          payer: publicKey!,
          openOrders: ooPda(erProgram.programId, marketPk, publicKey!),
        })
        .preInstructions([cuMax])
        .rpc(),
    );
    poll.refresh();
  };

  const handleSettle = async () => {
    requireWallet();
    const marketPk = ctx.marketPubkey!;
    const PROG = baseProgram.programId;

    // Quick check: if market is still owned by the delegation program, poll until
    // CrossBar ownership returns (L1 commit after undelegate takes a few seconds).
    const preCheck = await baseConnection.getAccountInfo(marketPk);
    if (!preCheck?.owner.equals(PROG)) {
      const ownerId = toast.loading("Waiting for L1 ownership transfer…");
      let owned = false;
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const info = await baseConnection.getAccountInfo(marketPk);
        if (info?.owner.equals(PROG)) { owned = true; break; }
      }
      toast.dismiss(ownerId);
      if (!owned) {
        toast.error("Market still owned by delegation program after 60s. Try again.");
        return;
      }
    }

    await sendAndToast("Settle", () =>
      baseProgram.methods
        .settle()
        .accountsPartial({
          market: marketPk,
          batchResult: pda(baseProgram.programId, "result", marketPk),
          openOrders: ooPda(baseProgram.programId, marketPk, publicKey!),
        })
        .rpc(),
    );
    poll.refresh();
  };

  const handleFinalize = async () => {
    requireWallet();
    const marketPk = ctx.marketPubkey!;
    await sendAndToast("Finalize settlement", () =>
      baseProgram.methods
        .finalizeSettlement()
        .accountsPartial({ market: marketPk, authority: publicKey! })
        .rpc(),
    );
    poll.refresh();
  };

  return (
    <Card id="lifecycle">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Market lifecycle
          <Badge
            variant="outline"
            className={isErAccent ? "border-accent text-accent" : ""}
          >
            {market ? statusLabel : "Unconfigured"}
          </Badge>
          {isDelegated && (
            <Badge className="bg-accent text-accent-foreground">ER live</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {!market ? (
          <p className="text-muted-foreground">
            Configure a devnet market to poll lifecycle state.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Current window</p>
                <p className="font-mono text-xl">{toNum(market.currentWindow)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Tick interval</p>
                <p className="font-mono">{toNum(market.tickIntervalMs)}ms</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Band delta</p>
                <p className="font-mono">{toNum(market.bandDeltaBps)} bps</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">CFMM reserves</p>
                <p className="font-mono text-xs">
                  {cfmmEnabled
                    ? `${formatQty(cfmmBase)} / ${formatQty(cfmmQuote)}`
                    : "disabled"}
                </p>
              </div>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                <span>Window progress</span>
                <span>
                  {windowElapsed} / {windowTarget || "?"} ticks
                </span>
              </div>
              <Progress value={windowPct} />
            </div>
          </>
        )}

        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <div className="flex w-full flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label>Deposit amount (atomic)</Label>
              <Input
                value={depositAmt}
                onChange={(e) => setDepositAmt(e.target.value)}
                className="w-36 font-mono text-xs"
              />
            </div>
            <Button
              size="sm"
              variant={depositBase ? "default" : "outline"}
              onClick={() => setDepositBase(true)}
            >
              Base
            </Button>
            <Button
              size="sm"
              variant={!depositBase ? "default" : "outline"}
              onClick={() => setDepositBase(false)}
            >
              Quote
            </Button>
            <Button size="sm" onClick={() => void handleDeposit()} disabled={!connected}>
              Deposit (L1)
            </Button>
          </div>
          <Button size="sm" variant="outline" onClick={() => void handleDelegate()} disabled={!connected}>
            Delegate (L1)
          </Button>
          <Button size="sm" variant="outline" onClick={() => void handleUndelegate()} disabled={!connected}>
            Undelegate (ER)
          </Button>
          <Button size="sm" variant="outline" onClick={() => void handleSettle()} disabled={!connected}>
            Settle (L1)
          </Button>
          <Button size="sm" onClick={() => void handleFinalize()} disabled={!connected}>
            Finalize (L1)
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
