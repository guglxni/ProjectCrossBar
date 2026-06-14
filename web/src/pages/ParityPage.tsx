import { Link } from "react-router-dom";
import {
  ArrowRight,
  BadgeCheck,
  Binary,
  Cpu,
  Dice5,
  Scale,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PARITY_PASSED,
  PARITY_TOTAL,
  RUN_BATCH_CU_MAX,
  RUN_BATCH_CU_MIN,
} from "@/lib/constants";

const STATS = [
  {
    label: "Certified parity",
    value: `${PARITY_PASSED}/${PARITY_TOTAL}`,
    hint: "differential cases vs. verified reference matcher",
    accent: true,
  },
  {
    label: "run_batch compute",
    value: `~${(RUN_BATCH_CU_MIN / 1000).toFixed(0)}k–${(RUN_BATCH_CU_MAX / 1000).toFixed(0)}k CU`,
    hint: "per clear, well inside the Solana budget",
  },
  {
    label: "Batch tick",
    value: "~50ms",
    hint: "windows clear continuously inside the rollup",
  },
];

const INVARIANTS = [
  {
    icon: ShieldCheck,
    title: "Deterministic matching (N1)",
    body: "run_batch is a pure function of the batch set and the reference price. No clock, slot, or arrival order ever enters the clear — so the outcome cannot be gamed by ordering.",
  },
  {
    icon: Scale,
    title: "One uniform price",
    body: "Every matched order in a window trades at the same p*. There is no fast lane and no priced advantage to landing first.",
  },
  {
    icon: Binary,
    title: "Exact integer math",
    body: "All clearing math is integer fixed-point at PRICE_SCALE. No floating point in the program or the test harness, so results are bit-for-bit reproducible.",
  },
  {
    icon: Dice5,
    title: "VRF only at the margin",
    body: "Randomness touches only the single indivisible marginal remainder when a tie must be broken — never p*, never a non-marginal fill.",
  },
];

export function ParityPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-16 md:py-24">
      <div className="mx-auto max-w-3xl text-center">
        <Badge variant="outline" className="mb-5">
          <BadgeCheck className="mr-1 h-3.5 w-3.5 text-[var(--success)]" />
          Verified correctness
        </Badge>
        <h1 className="font-display text-4xl tracking-[-1px] text-foreground md:text-6xl">
          Correctness you can check.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
          CrossBar's matcher is held to a verified reference implementation with
          a differential test suite. Every clear is deterministic, single-price,
          and integer-exact by construction.
        </p>
      </div>

      <div className="mt-14 grid gap-4 sm:grid-cols-3">
        {STATS.map((s) => (
          <Card key={s.label} className="glass-card">
            <CardContent className="p-6">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p
                className={`mt-2 font-display text-3xl tracking-tight ${
                  s.accent ? "text-[var(--success)]" : "text-foreground"
                }`}
              >
                {s.value}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {s.hint}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-16">
        <h2 className="text-center font-display text-3xl tracking-[-0.5px] text-foreground md:text-4xl">
          The guarantees behind every window
        </h2>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {INVARIANTS.map((inv) => (
            <Card key={inv.title}>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary">
                    <inv.icon className="h-5 w-5 text-[var(--accent)]" />
                  </span>
                  <CardTitle className="text-base">{inv.title}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {inv.body}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Card className="mt-16 overflow-hidden border-border">
        <CardContent className="flex flex-col items-start gap-6 p-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-secondary">
              <Cpu className="h-6 w-6 text-[var(--accent)]" />
            </span>
            <div>
              <p className="font-medium text-foreground">
                See it run on devnet
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Open the live dashboard and watch windows clear at one price in
                real time.
              </p>
            </div>
          </div>
          <Button asChild className="group shrink-0 rounded-full">
            <Link to="/dashboard">
              Open dashboard
              <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
