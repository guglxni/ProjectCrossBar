import { ChevronRight, Layers, Scale, ShieldCheck } from "lucide-react";

const STEPS = [
  {
    icon: Layers,
    title: "Delegate to the rollup",
    body: "Orders and balances delegate into the MagicBlock Ephemeral Rollup, where the batch forms off the L1 hot path.",
  },
  {
    icon: Scale,
    title: "Clear at one price",
    body: "The matcher computes a single uniform clearing price for the entire window inside the rollup, on a ~50ms tick.",
  },
  {
    icon: ShieldCheck,
    title: "Settle atomically to L1",
    body: "Results undelegate and settle back to Solana L1 in one atomic flow, with balances reconciled on chain.",
  },
];

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-20 md:py-28">
      <div className="max-w-2xl">
        <p className="text-sm font-medium uppercase tracking-widest text-accent">
          How it works
        </p>
        <h2 className="mt-3 font-display text-4xl tracking-[-1px] text-foreground md:text-5xl">
          Clearing in three moves
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          Execution leaves the slot. Matching happens in a rollup where every
          order in a window meets at the same price, then settles to Solana.
        </p>
      </div>

      <div className="mt-14 grid items-stretch gap-4 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
        {STEPS.map((step, i) => (
          <div key={step.title} className="contents">
            <div className="glass-card flex flex-col rounded-2xl p-7">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
                  <step.icon className="h-5 w-5" />
                </span>
                <span className="font-display text-3xl text-accent">
                  {i + 1}
                </span>
              </div>
              <h3 className="mt-5 text-lg font-semibold text-foreground">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {step.body}
              </p>
            </div>
            {i < STEPS.length - 1 && (
              <div className="hidden items-center justify-center lg:flex">
                <ChevronRight className="h-6 w-6 text-muted-foreground/50" />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
