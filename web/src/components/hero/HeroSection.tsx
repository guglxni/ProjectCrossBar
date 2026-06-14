import { Card, CardContent } from "@/components/ui/card";
import {
  BATCH_STATUS_LABELS,
  PARITY_PASSED,
  PARITY_TOTAL,
  PROGRAM_ID,
} from "@/lib/constants";
import { explorerAccountLink } from "@/lib/format";
import type { MarketPollState } from "@/hooks/useMarketPolling";
import { HeroNav } from "./HeroNav";
import { HeroVideo } from "./HeroVideo";

interface HeroSectionProps {
  poll: Pick<MarketPollState, "market" | "batchResult" | "loading">;
}

function lastBatchLabel(
  batchResult: MarketPollState["batchResult"],
): string {
  if (!batchResult) return "No market";
  const status = Number(batchResult.status ?? -1);
  return BATCH_STATUS_LABELS[status] ?? `Status ${status}`;
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
  const scrollDashboard = () =>
    document.querySelector("#dashboard")?.scrollIntoView({ behavior: "smooth" });

  return (
    <section className="relative min-h-[90vh] overflow-hidden">
      <HeroVideo />
      <HeroNav />
      <div
        className="relative z-10 mx-auto flex max-w-5xl flex-col items-center px-6 text-center"
        style={{ paddingTop: "calc(8rem - 75px)", paddingBottom: "10rem" }}
      >
        <h1 className="animate-fade-rise font-display text-5xl leading-[0.95] tracking-[-2.46px] text-foreground sm:text-7xl md:text-8xl">
          Beyond the slot,{" "}
          <em className="text-muted-foreground not-italic">one price</em> for{" "}
          <em className="text-muted-foreground not-italic">every window</em>.
        </h1>
        <p className="animate-fade-rise-delay mt-8 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          A frequent batch auction DEX on Solana. Order matching and
          uniform-price clearing run inside a MagicBlock Ephemeral Rollup, then
          settle atomically to L1. No intra-batch time priority. Competition
          moves to price.
        </p>
        <button
          type="button"
          onClick={scrollDashboard}
          className="animate-fade-rise-delay-2 mt-12 rounded-full bg-primary px-14 py-5 text-base text-primary-foreground transition-transform hover:scale-[1.03]"
        >
          Trade on Devnet
        </button>

        <div className="mt-16 grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="glass-card border-black/5">
            <CardContent className="p-4 text-left">
              <p className="text-xs text-muted-foreground">Program deployed</p>
              <a
                href={explorerAccountLink(PROGRAM_ID.toBase58())}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 block font-mono text-xs hover:underline"
              >
                {PROGRAM_ID.toBase58().slice(0, 8)}...
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
              <p className="mt-1 text-xs text-muted-foreground">run_parity.sh</p>
            </CardContent>
          </Card>
          <Card className="glass-card border-black/5">
            <CardContent className="p-4 text-left">
              <p className="text-xs text-muted-foreground">Tick cadence</p>
              <p className="mt-1 text-2xl font-semibold">
                {poll.loading ? "..." : tickLabel(poll.market)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">batch tick</p>
            </CardContent>
          </Card>
          <Card className="glass-card border-black/5">
            <CardContent className="p-4 text-left">
              <p className="text-xs text-muted-foreground">Last batch status</p>
              <p className="mt-1 text-lg font-semibold">
                {poll.loading ? "..." : lastBatchLabel(poll.batchResult)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">live polled</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
