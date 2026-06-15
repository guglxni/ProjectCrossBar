import { Link } from "react-router-dom";
import { ArrowRight, LineChart, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const TIERS = [
  {
    title: "Live market context",
    body: "Dashboard marquee and charts read Flash Trade GET /prices (Pyth Lazer marks) alongside Pyth Hermes 24h stats.",
    status: "Live",
  },
  {
    title: "Typed REST client",
    body: "clients/flash/ wraps flashapi.trade: prices, pool depth, unsigned tx previews. Verified against mainnet Flash API.",
    status: "Live",
  },
  {
    title: "Spot / perp hedge demo",
    body: "tests/hedge-demo.ts: clear spot on CrossBar, preview a Flash perp hedge in the same ER session (mocked leg on devnet).",
    status: "Live",
  },
  {
    title: "Co-located execution",
    body: "Roadmap: agent or trader clears at p* on CrossBar and opens the delta hedge on Flash without leaving the rollup.",
    status: "Roadmap",
  },
];

export function FlashTradeSection() {
  return (
    <section id="flash" className="border-y border-border bg-secondary/30">
      <div className="mx-auto max-w-7xl px-6 py-20 md:py-28">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <Badge className="mb-4 border-0 bg-[var(--accent)] text-white hover:bg-[var(--accent)]">
              <Zap className="mr-1 h-3.5 w-3.5" />
              Flash Trade integration
            </Badge>
            <h2 className="font-display text-4xl tracking-[-1px] text-foreground md:text-5xl">
              Spot batch auction + perp venue on one rollup.
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              CrossBar clears spot at one uniform price inside a MagicBlock
              Ephemeral Rollup.{" "}
              <a
                href="https://flash.trade/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Flash Trade V2
              </a>{" "}
              runs perpetual futures on the same execution substrate (~30–50 ms
              confirms, Pyth Lazer oracle). Clear fairly on CrossBar, hedge the
              delta on Flash in the same ER session.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              MagicBlock hackathons include a{" "}
              <span className="font-medium text-foreground">Flash Boost</span>:
              integrate Flash Trade and eligible prize payouts increase by 50%.{" "}
              <a
                href="https://hackathon.magicblock.app/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline-offset-4 hover:underline"
              >
                hackathon.magicblock.app
              </a>
              . CrossBar is built for that composition, not as a standalone spot
              toy.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild className="rounded-full">
                <a
                  href="https://flash.trade/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Flash Trade
                  <ArrowRight className="ml-1 h-4 w-4" />
                </a>
              </Button>
              <Button asChild variant="outline" className="rounded-full">
                <Link to="/docs#flash-trade">Read the integration</Link>
              </Button>
              <Button asChild variant="outline" className="rounded-full">
                <Link to="/dashboard#flash">Dashboard panel</Link>
              </Button>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-background">
            <img
              src="/diagrams/flash-integration.png"
              alt="CrossBar spot clearing and Flash Trade perps on the same MagicBlock Ephemeral Rollup"
              className="w-full object-contain"
            />
          </div>
        </div>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TIERS.map((t) => (
            <Card key={t.title} className="glass-card border-black/5">
              <CardContent className="p-6">
                <div className="flex items-center justify-between gap-2">
                  <LineChart className="h-5 w-5 text-[var(--accent)]" />
                  <Badge variant={t.status === "Live" ? "default" : "outline"}>
                    {t.status}
                  </Badge>
                </div>
                <h3 className="mt-4 font-semibold text-foreground">{t.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t.body}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
