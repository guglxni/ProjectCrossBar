import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function CtaSection() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-20 md:py-28">
      <div className="relative overflow-hidden rounded-3xl bg-foreground px-8 py-16 text-center text-background md:px-16 md:py-24">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-30 blur-3xl"
          style={{ background: "#7a3fb5" }}
        />
        <Badge className="border-0 bg-background/15 text-background backdrop-blur">
          Live on Solana devnet
        </Badge>
        <h2 className="mx-auto mt-6 max-w-3xl font-display text-4xl leading-[1.05] tracking-[-1px] md:text-6xl">
          Trade beyond the slot.
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-background/70 md:text-lg">
          Connect a devnet wallet and run a full window: delegate, submit,
          clear at one price, and settle atomically to L1.
        </p>
        <div className="mt-10 flex justify-center">
          <Button
            asChild
            size="lg"
            className="group rounded-full bg-background px-8 text-foreground hover:bg-background/90"
          >
            <Link to="/dashboard">
              Open the dashboard
              <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
