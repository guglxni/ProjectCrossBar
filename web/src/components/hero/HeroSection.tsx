import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  BATCH_STATUS_LABELS,
  PARITY_PASSED,
  PARITY_TOTAL,
  PROGRAM_ID,
} from "@/lib/constants";
import { explorerAccountLink } from "@/lib/format";
import type { MarketPollState } from "@/hooks/useMarketPolling";
import { HeroVideo } from "./HeroVideo";

interface HeroSectionProps {
  poll: Pick<MarketPollState, "market" | "batchResult" | "loading">;
}

function lastBatchLabel(batchResult: MarketPollState["batchResult"]): string {
  if (!batchResult) return "Ready";
  const status = Number(batchResult.status ?? -1);
  return BATCH_STATUS_LABELS[status] ?? "Ready";
}

function tickLabel(market: MarketPollState["market"]): string {
  if (!market) return "50ms";
  const ms = market.tickIntervalMs;
  if (typeof ms === "number") return `${ms}ms`;
  if (ms && typeof ms === "object" && "toNumber" in ms) {
    return `${(ms as { toNumber: () => number }).toNumber()}ms`;
  }
  return "50ms";
}

export function HeroSection({ poll }: HeroSectionProps) {
  return (
    <section className="relative overflow-hidden">
      <HeroVideo />
      <div
        className="relative z-10 mx-auto flex max-w-5xl flex-col items-center px-6 text-center"
        style={{ paddingTop: "calc(6rem - 24px)", paddingBottom: "8rem" }}
      >
        <span className="animate-fade-rise inline-flex items-center gap-2 rounded-full border border-border bg-background/60 px-4 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
          Live on Solana devnet · MagicBlock Ephemeral Rollup
        </span>
        <h1 className="animate-fade-rise mt-6 font-display text-5xl leading-[0.95] tracking-[-2.46px] text-foreground sm:text-7xl md:text-8xl">
          Beyond the slot,{" "}
          <em className="text-muted-foreground not-italic">one price</em> for{" "}
          <em className="text-muted-foreground not-italic">every window</em>.
        </h1>
        <p className="animate-fade-rise-delay mt-8 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          A frequent batch auction DEX on Solana, composed with{" "}
          <a
            href="https://flash.trade/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Flash Trade
          </a>{" "}
          perps on the same MagicBlock Ephemeral Rollup. Uniform-price clearing
          in the ER, atomic settlement to L1. No intra-batch time priority.
        </p>
        <div className="animate-fade-rise-delay-2 mt-12 flex flex-wrap items-center justify-center gap-3">
          <Button
            asChild
            size="lg"
            className="group rounded-full px-10 py-6 text-base"
          >
            <Link to="/dashboard">
              Trade on devnet
              <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="rounded-full bg-background/60 px-10 py-6 text-base backdrop-blur"
          >
            <Link to="/parity">See the proof</Link>
          </Button>
        </div>

        <div className="mt-16 grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="glass-card border-black/5">
            <CardContent className="p-4 text-left">
              <p className="text-xs text-muted-foreground">Program deployed</p>
              <a
                href={explorerAccountLink(PROGRAM_ID.toBase58())}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 block font-mono text-sm font-medium hover:underline"
              >
                {PROGRAM_ID.toBase58().slice(0, 8)}…
              </a>
              <p className="mt-1 text-xs text-muted-foreground">Solana devnet</p>
            </CardContent>
          </Card>
          <Card className="glass-card border-black/5">
            <CardContent className="p-4 text-left">
              <p className="text-xs text-muted-foreground">Certified parity</p>
              <p className="mt-1 text-2xl font-semibold text-[var(--success)]">
                {PARITY_PASSED}/{PARITY_TOTAL}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                differential tests
              </p>
            </CardContent>
          </Card>
          <Card className="glass-card border-black/5">
            <CardContent className="p-4 text-left">
              <p className="text-xs text-muted-foreground">Tick cadence</p>
              <p className="mt-1 text-2xl font-semibold">
                {poll.loading && !poll.market ? "50ms" : tickLabel(poll.market)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">batch tick</p>
            </CardContent>
          </Card>
          <Card className="glass-card border-black/5">
            <CardContent className="p-4 text-left">
              <p className="text-xs text-muted-foreground">Last batch</p>
              <p className="mt-1 text-lg font-semibold">
                {lastBatchLabel(poll.batchResult)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">live polled</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
