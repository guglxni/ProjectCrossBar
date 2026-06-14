import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const FAQ = [
  {
    q: "What is a frequent batch auction?",
    a: "Instead of matching orders one by one in arrival order, CrossBar collects every order that arrives in a short window and clears them together at a single price. Repeating this many times per second gives continuous trading without continuous time priority.",
  },
  {
    q: "How does running inside an Ephemeral Rollup help?",
    a: "The MagicBlock Ephemeral Rollup gives the matcher a fast, dedicated execution lane on a ~50ms tick, off the Solana L1 hot path. You get rollup speed for matching and full Solana settlement guarantees when the window closes.",
  },
  {
    q: "Why is this MEV-resistant?",
    a: "There is no advantage to being first inside a window, because every order in that window clears at the same uniform price. Sandwiching and front-running rely on ordering, and CrossBar removes ordering from the outcome.",
  },
  {
    q: "What actually settles on Solana L1?",
    a: "After a window clears in the rollup, balances undelegate and settle back to Solana L1 in one atomic flow. The clearing result, fills, and reconciled balances all land on chain.",
  },
  {
    q: "How fast is a batch?",
    a: "Windows tick on the order of 50ms inside the rollup, and a clear runs in roughly 18k to 21k compute units. Trading feels continuous while remaining a fair batch auction.",
  },
  {
    q: "How do you know the matcher is correct?",
    a: "The matcher is checked against a verified reference implementation with a differential test suite that passes 4006 of 4006 cases. Correctness is demonstrated, not assumed.",
  },
];

export function FaqSection() {
  return (
    <section className="border-t border-border bg-secondary/40">
      <div className="mx-auto max-w-3xl px-6 py-20 md:py-28">
        <h2 className="text-center font-display text-4xl tracking-[-1px] text-foreground md:text-5xl">
          Frequently asked
        </h2>
        <Accordion type="single" collapsible className="mt-10 w-full">
          {FAQ.map((item, i) => (
            <AccordionItem key={item.q} value={`item-${i}`}>
              <AccordionTrigger className="text-left text-base font-medium">
                {item.q}
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                {item.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
