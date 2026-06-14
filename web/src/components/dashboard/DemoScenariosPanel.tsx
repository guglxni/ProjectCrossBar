import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { MarketPollState } from "@/hooks/useMarketPolling";

interface Props {
  poll?: Pick<MarketPollState, "market" | "batchResult">;
}

type Scenario = {
  id: string;
  title: string;
  source: string;
  substrate: "devnet-er" | "local" | "devnet-l1";
  proves: string;
  command: string;
  steps: string[];
};

const SCENARIOS: Scenario[] = [
  {
    id: "uniform-p",
    title: "Uniform clearing price",
    source: "tests/demo-devnet.ts",
    substrate: "devnet-er",
    proves: "Many overlapping orders clear at one uniform price p*.",
    command: "THROTTLE_MS=900 ./scripts/run-demo-local.sh",
    steps: [
      "Initialize the market and deposit balances.",
      "Submit an overlapping buy/sell ladder.",
      "run_batch returns a single clearing_price for every fill.",
    ],
  },
  {
    id: "sandwich",
    title: "Sandwich nets zero",
    source: "tests/demo-devnet.ts",
    substrate: "devnet-er",
    proves: "A bracketing attacker cannot extract value inside a window.",
    command: "THROTTLE_MS=900 ./scripts/run-demo-local.sh",
    steps: [
      "Place a victim order inside the window.",
      "Attacker brackets it with same-window orders.",
      "All fills share p*, so the sandwich PnL nets to zero.",
    ],
  },
  {
    id: "er-roundtrip",
    title: "Full ER round-trip",
    source: "tests/er-demo.ts",
    substrate: "devnet-er",
    proves: "delegate → submit → clear → undelegate → settle on the live ER.",
    command: "npx tsx tests/er-demo.ts",
    steps: [
      "delegate_market on Solana L1.",
      "submit_order + run_batch on the MagicBlock ER.",
      "undelegate_open_orders + settle + finalize on L1.",
    ],
  },
  {
    id: "crank",
    title: "Automated crank lifecycle",
    source: "tests/crank-demo.ts",
    substrate: "devnet-er",
    proves: "ScheduleTask fires run_batch; a keeper settles traders after each clear.",
    command: "npx tsx tests/crank-demo.ts",
    steps: [
      "Register the schedule_batch crank.",
      "run_batch fires automatically each tick window.",
      "Keeper undelegates, settles, and finalizes on L1.",
    ],
  },
  {
    id: "cfmm",
    title: "CFMM liquidity backstop",
    source: "tests/cfmm-demo.ts",
    substrate: "devnet-er",
    proves: "A thin book still clears via a constant-product maker ladder.",
    command: "npx tsx tests/cfmm-demo.ts",
    steps: [
      "Enable CFMM reserves on the market.",
      "A sparse human book is supplemented by the pool.",
      "The backstop supplies liquidity; a single p* still holds.",
    ],
  },
  {
    id: "randclear",
    title: "Randomized window close",
    source: "tests/randclear-demo.ts",
    substrate: "devnet-er",
    proves: "A VRF-jittered window close keeps N1 determinism intact.",
    command: "npx tsx tests/randclear-demo.ts",
    steps: [
      "request_window_vrf / consume_window_vrf.",
      "The window target ticks vary per VRF draw.",
      "Matcher output is unchanged for the same batch set.",
    ],
  },
];

function substrateBadge(s: Scenario["substrate"]) {
  switch (s) {
    case "devnet-er":
      return (
        <Badge className="shrink-0 bg-[var(--accent)] text-white">
          Devnet ER
        </Badge>
      );
    case "devnet-l1":
      return (
        <Badge variant="outline" className="shrink-0">
          Devnet L1
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="shrink-0">
          Devnet
        </Badge>
      );
  }
}

export function DemoScenariosPanel({ poll }: Props) {
  const [open, setOpen] = useState<Scenario | null>(null);
  void poll;

  return (
    <Card id="demos" className="glass-card">
      <CardHeader>
        <CardTitle>Scenario walkthroughs</CardTitle>
        <CardDescription>
          Reproducible flows that demonstrate each guarantee end to end on
          devnet. Open any card for the steps and the exact command.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SCENARIOS.map((scenario) => (
            <button
              key={scenario.id}
              type="button"
              onClick={() => setOpen(scenario)}
              className="group flex h-full min-w-0 flex-col gap-2 rounded-lg border border-border bg-background/40 p-4 text-left transition-colors hover:border-[var(--accent)]/50 hover:bg-secondary/60"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 break-words font-medium leading-tight">
                  {scenario.title}
                </span>
                {substrateBadge(scenario.substrate)}
              </div>
              <span className="break-words text-xs leading-relaxed text-muted-foreground">
                {scenario.proves}
              </span>
              <span className="mt-auto inline-flex items-center text-xs font-medium text-[var(--accent)]">
                View steps
                <ArrowRight className="ml-1 h-3 w-3 transition-transform group-hover:translate-x-0.5" />
              </span>
            </button>
          ))}
        </div>
      </CardContent>

      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-w-lg">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>{open.title}</DialogTitle>
                <DialogDescription className="flex flex-wrap items-center gap-2 pt-1">
                  {substrateBadge(open.substrate)}
                  <span className="font-mono text-xs text-muted-foreground">
                    {open.source}
                  </span>
                </DialogDescription>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">{open.proves}</p>
              <ScrollArea className="max-h-40 rounded-md border p-3">
                <ol className="list-decimal space-y-2 pl-4 text-sm">
                  {open.steps.map((step) => (
                    <li key={step} className="break-words">
                      {step}
                    </li>
                  ))}
                </ol>
              </ScrollArea>
              <div className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
                {open.command}
              </div>
              <Button
                variant="secondary"
                onClick={() => {
                  window.location.assign("/docs#quickstart");
                }}
              >
                Open quickstart docs
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
