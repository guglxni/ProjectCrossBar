import { Link } from "react-router-dom";
import { ArrowRight, Cpu, Fuel, LineChart, Network, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const INTEGRATIONS = [
  {
    icon: Zap,
    name: "Flash Trade V2",
    tag: "Spot + perp",
    featured: true,
    body: "Flash runs perpetual futures on the same MagicBlock Ephemeral Rollup as CrossBar (~30–50 ms confirms, Pyth Lazer oracle). CrossBar clears spot at one uniform p*; Flash hedges the delta. Tiers 0–2 are live: REST client, dashboard market context, and tests/hedge-demo.ts. MagicBlock hackathons add a Flash Boost (50% prize bonus when Flash is integrated).",
    points: [
      "Same ER substrate, delegation lifecycle, and oracle family as CrossBar",
      "Live dashboard: Flash GET /prices marquee + Pyth 24h context",
      "clients/flash/ typed API + spot/perp hedge demo (devnet mock leg)",
    ],
    href: "https://flash.trade/",
    linkLabel: "flash.trade",
    secondaryHref: "/docs#flash-trade",
    secondaryLabel: "Integration doc",
    secondaryInternal: true,
  },
  {
    icon: Cpu,
    name: "MagicBlock Ephemeral Rollup",
    tag: "Execution layer",
    body: "Order matching and uniform-price clearing run inside a MagicBlock Ephemeral Rollup on a ~50ms tick, then undelegate and settle atomically back to Solana L1. The rollup is the speed; L1 is the guarantee.",
    points: [
      "Delegate the market PDAs before the first tick",
      "run_batch executes on the ER, off the L1 hot path",
      "Atomic undelegate → settle → finalize on L1",
    ],
    href: "https://docs.magicblock.gg/",
    linkLabel: "MagicBlock docs",
  },
  {
    icon: Fuel,
    name: "Kora gasless relayer",
    tag: "Onboarding",
    body: "Kora sponsors transaction fees so traders can submit orders without holding SOL for gas. The relayer signs as fee payer while the trader keeps full custody of their order.",
    points: [
      "Relayer acts as feePayer on submitted orders",
      "Trader signs intent; Kora covers the lamports",
      "Frictionless first-trade experience on devnet",
    ],
    href: "https://github.com/solana-foundation/kora",
    linkLabel: "Kora project",
  },
  {
    icon: LineChart,
    name: "Pyth oracle stack",
    tag: "Market data",
    body: "CrossBar gates p* with Pyth Lazer on-chain. The dashboard reads Flash Trade marks (same oracle family) plus Pyth Hermes 24h change and Pyth Benchmarks charts. DefiLlama and CoinGecko are fallbacks.",
    points: [
      "On-chain band gate: reject p* outside [p_ref ± δ]",
      "Flash /prices for live spot context (never feeds run_batch)",
      "Hermes + Benchmarks browser-direct (no Vercel egress limits)",
    ],
    href: "https://docs.pyth.network/",
    linkLabel: "Pyth docs",
  },
  {
    icon: Network,
    name: "Verified reference matcher",
    tag: "Correctness",
    body: "The clearing engine is continuously held to a verified reference implementation through a differential test suite, so the matcher's output is provably the correct uniform-price clear.",
    points: [
      "4006/4006 differential parity cases",
      "Integer fixed-point, bit-for-bit reproducible",
      "Single p* enforced across every fill",
    ],
    href: "/parity",
    linkLabel: "See the proof",
    internal: true,
  },
];

export function IntegrationsPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-16 md:py-24">
      <div className="mx-auto max-w-3xl text-center">
        <Badge variant="outline" className="mb-5">
          <Zap className="mr-1 h-3.5 w-3.5 text-[var(--accent)]" />
          Flash Trade + MagicBlock ER
        </Badge>
        <h1 className="font-display text-4xl tracking-[-1px] text-foreground md:text-6xl">
          Spot batch auction, perp hedge, one rollup.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
          CrossBar composes with{" "}
          <a
            href="https://flash.trade/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Flash Trade
          </a>{" "}
          on the same MagicBlock stack: fair spot clearing, live perp marks, gasless
          onboarding, and a matcher proved against a verified oracle.
        </p>
      </div>

      <div className="mt-14 grid gap-5 md:grid-cols-2">
        {INTEGRATIONS.map((it) => (
          <Card
            key={it.name}
            className={
              "featured" in it && it.featured
                ? "border-[var(--accent)]/40 bg-[var(--accent)]/5 md:col-span-2"
                : "flex flex-col"
            }
          >
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary">
                    <it.icon className="h-5 w-5 text-[var(--accent)]" />
                  </span>
                  <CardTitle className="text-base">{it.name}</CardTitle>
                </div>
                <Badge
                  variant={"featured" in it && it.featured ? "default" : "secondary"}
                  className="shrink-0"
                >
                  {it.tag}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {it.body}
              </p>
              <ul className="mt-4 space-y-2">
                {it.points.map((p) => (
                  <li
                    key={p}
                    className="flex items-start gap-2 text-sm text-foreground"
                  >
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-5 flex flex-wrap gap-4 pt-1">
                {it.internal ? (
                  <Button
                    asChild
                    variant="link"
                    className="h-auto p-0 text-[var(--accent)]"
                  >
                    <Link to={it.href}>
                      {it.linkLabel}
                      <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                ) : (
                  <a
                    href={it.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center text-sm font-medium text-[var(--accent)] hover:underline"
                  >
                    {it.linkLabel}
                    <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </a>
                )}
                {"secondaryHref" in it && it.secondaryHref && (
                  it.secondaryInternal ? (
                    <Button
                      asChild
                      variant="link"
                      className="h-auto p-0 text-muted-foreground"
                    >
                      <Link to={it.secondaryHref}>{it.secondaryLabel}</Link>
                    </Button>
                  ) : (
                    <a
                      href={it.secondaryHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center text-sm text-muted-foreground hover:underline"
                    >
                      {it.secondaryLabel}
                    </a>
                  )
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-16">
        <CardContent className="flex flex-col items-start gap-6 p-8 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-medium text-foreground">
              Flash panel + full devnet lifecycle
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Connect a wallet, read Flash live marks, and run a window end to end.
            </p>
          </div>
          <Button asChild className="group shrink-0 rounded-full">
            <Link to="/dashboard#flash">
              Open dashboard
              <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
