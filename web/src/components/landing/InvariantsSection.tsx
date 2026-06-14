import { Badge } from "@/components/ui/badge";

const INVARIANTS = [
  {
    tag: "N1",
    title: "Deterministic clearing",
    body: "Matching is a pure function of the batch set and the reference price. No clock, slot, or arrival order ever touches the result, so outcomes are reproducible and free of ordering games.",
  },
  {
    tag: "Single price",
    title: "One price per batch",
    body: "Every matched order in a window trades at the same clearing price p*. A batch can never produce two prices, which is what makes the auction fair end to end.",
  },
  {
    tag: "Integer math",
    title: "Fixed-point, no floats",
    body: "All price and quantity math is integer fixed-point at a fixed scale. There is no floating point anywhere in the matcher, so rounding is exact and verifiable.",
  },
  {
    tag: "VRF at margin",
    title: "Randomness only at the edge",
    body: "Verifiable randomness is used solely to break a tie on the indivisible marginal remainder. It never touches the clearing price or any non-marginal fill.",
  },
];

export function InvariantsSection() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-20 md:py-28">
      <div className="max-w-2xl">
        <p className="text-sm font-medium uppercase tracking-widest text-accent">
          Guarantees
        </p>
        <h2 className="mt-3 font-display text-4xl tracking-[-1px] text-foreground md:text-5xl">
          Guarantees, not promises
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          The properties below are enforced in the program and proven by the
          test suite. They are the reason a CrossBar batch behaves the same way
          every time.
        </p>
      </div>

      <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2">
        {INVARIANTS.map((inv) => (
          <div key={inv.tag} className="bg-background p-8">
            <Badge
              variant="outline"
              className="border-accent/30 bg-accent/5 font-mono text-accent"
            >
              {inv.tag}
            </Badge>
            <h3 className="mt-4 text-xl font-semibold text-foreground">
              {inv.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {inv.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
