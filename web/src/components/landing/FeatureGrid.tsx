import {
  BadgeCheck,
  Cpu,
  Lock,
  Repeat,
  Scale,
  ShieldHalf,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const FEATURES = [
  {
    icon: ShieldHalf,
    title: "MEV-resistant by design",
    body: "No intra-batch time priority. Reordering, sandwiching, and front-running lose their edge because every order in a window clears together.",
  },
  {
    icon: Scale,
    title: "One uniform price",
    body: "Every matched order in a batch trades at the same clearing price p*. Fair price discovery is the default, not a feature flag.",
  },
  {
    icon: Cpu,
    title: "Ephemeral Rollup execution",
    body: "Matching runs inside a MagicBlock Ephemeral Rollup on a ~50ms tick, off the L1 hot path, with full Solana settlement guarantees.",
  },
  {
    icon: Repeat,
    title: "Atomic L1 settlement",
    body: "Cleared windows undelegate and settle back to Solana L1 atomically. State on the rollup and state on chain stay reconciled.",
  },
  {
    icon: BadgeCheck,
    title: "Certified parity",
    body: "The matcher passes 4006 of 4006 differential tests against a verified reference, so correctness is proven, not asserted.",
  },
  {
    icon: Lock,
    title: "Deterministic matching",
    body: "The same batch and reference price always produce the same result. Determinism is the guarantee that removes ordering games.",
  },
];

export function FeatureGrid() {
  return (
    <section className="border-y border-border bg-secondary/40">
      <div className="mx-auto max-w-7xl px-6 py-20 md:py-28">
        <div className="max-w-2xl">
          <p className="text-sm font-medium uppercase tracking-widest text-accent">
            Why CrossBar
          </p>
          <h2 className="mt-3 font-display text-4xl tracking-[-1px] text-foreground md:text-5xl">
            Built for fair price discovery
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            A batch auction that moves competition from speed to price, executed
            where it can be fast and settled where it counts.
          </p>
        </div>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Card key={f.title} className="glass-card border-black/5">
              <CardContent className="p-7">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-foreground text-background">
                  <f.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-5 text-lg font-semibold text-foreground">
                  {f.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {f.body}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
