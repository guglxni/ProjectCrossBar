import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

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
    title: "Scenario A: uniform p*",
    source: "tests/demo-devnet.ts",
    substrate: "local",
    proves: "Many orders clear at one uniform price p*.",
    command: "THROTTLE_MS=900 ./scripts/run-demo-local.sh",
    steps: [
      "Init market and deposit on local validator.",
      "Submit overlapping buy/sell ladder.",
      "run_batch returns single clearing_price for all fills.",
    ],
  },
  {
    id: "sandwich",
    title: "Scenario B: sandwich nets zero",
    source: "tests/demo-devnet.ts",
    substrate: "local",
    proves: "Bracketing attacker cannot extract at a different price inside the window.",
    command: "THROTTLE_MS=900 ./scripts/run-demo-local.sh",
    steps: [
      "Victim order inside window.",
      "Attacker brackets with same-window orders.",
      "All fills share p*; sandwich PnL nets to zero at uniform price.",
    ],
  },
  {
    id: "er-roundtrip",
    title: "Full ER round-trip",
    source: "tests/er-demo.ts",
    substrate: "devnet-er",
    proves: "delegate → submit → clear → undelegate → settle on live MagicBlock ER.",
    command: "npx tsx tests/er-demo.ts",
    steps: [
      "delegate_market on L1.",
      "submit_order + run_batch on ER.",
      "undelegate_open_orders + settle + finalize_settlement on L1.",
    ],
  },
  {
    id: "crank",
    title: "Crank lifecycle",
    source: "tests/crank-demo.ts",
    substrate: "devnet-er",
    proves: "ScheduleTask fires run_batch; keeper settles traders after clear.",
    command: "npx tsx tests/crank-demo.ts",
    steps: [
      "Register schedule_batch crank.",
      "Automatic run_batch each tick window.",
      "Keeper polls L1, undelegate → settle → finalize.",
    ],
  },
  {
    id: "cfmm",
    title: "CFMM backstop",
    source: "tests/cfmm-demo.ts",
    substrate: "local",
    proves: "Thin book clears via constant-product synthetic maker ladder.",
    command: "npx tsx tests/cfmm-demo.ts",
    steps: [
      "Enable cfmm reserves on market.",
      "Sparse human book fails without pool.",
      "Backstop supplies liquidity; single p* still holds.",
    ],
  },
  {
    id: "randclear",
    title: "Randomized window",
    source: "tests/randclear-demo.ts",
    substrate: "local",
    proves: "VRF-jittered window close; N1 determinism preserved.",
    command: "npx tsx tests/randclear-demo.ts",
    steps: [
      "request_window_vrf / consume_window_vrf.",
      "Window target ticks vary per VRF draw.",
      "Matcher output unchanged for same batch set.",
    ],
  },
  {
    id: "per",
    title: "PER permissions",
    source: "tests/private-demo.ts",
    substrate: "devnet-l1",
    proves: "make_private wiring for future TEE read path.",
    command: "npx tsx tests/private-demo.ts",
    steps: [
      "make_private on market account.",
      "make_open_orders_private per trader.",
      "Label only: confidential sizes not live in this UI.",
    ],
  },
];

function substrateBadge(s: Scenario["substrate"]) {
  switch (s) {
    case "devnet-er":
      return <Badge className="bg-accent text-white">Devnet ER live</Badge>;
    case "devnet-l1":
      return <Badge variant="outline">Devnet L1</Badge>;
    default:
      return <Badge variant="secondary">Local validator</Badge>;
  }
}

export function DemoScenariosPanel() {
  const [open, setOpen] = useState<Scenario | null>(null);

  return (
    <Card id="demos" className="glass-card">
      <CardHeader>
        <CardTitle>Scenario demos</CardTitle>
        <CardDescription>
          One-click reference flows. Scripts run from the repo CLI; this panel documents
          steps and honest substrate labels.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertDescription>
            Browser wallet cannot replay full scripted demos safely. Use the commands below
            from repo root with your devnet wallet. ER demos require{" "}
            <code className="text-xs">EPHEMERAL_PROVIDER_ENDPOINT=https://devnet.magicblock.app/</code>
            .
          </AlertDescription>
        </Alert>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SCENARIOS.map((scenario) => (
            <Button
              key={scenario.id}
              variant="outline"
              className="h-auto flex-col items-start gap-2 p-4 text-left"
              onClick={() => setOpen(scenario)}
            >
              <span className="font-medium">{scenario.title}</span>
              <span className="text-xs text-muted-foreground">{scenario.proves}</span>
              {substrateBadge(scenario.substrate)}
            </Button>
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
                  <span className="text-xs text-muted-foreground">{open.source}</span>
                </DialogDescription>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">{open.proves}</p>
              <ScrollArea className="max-h-40 rounded-md border p-3">
                <ol className="list-decimal space-y-2 pl-4 text-sm">
                  {open.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </ScrollArea>
              <div className="rounded-md bg-muted p-3 font-mono text-xs">{open.command}</div>
              <Button
                variant="secondary"
                onClick={() =>
                  window.open(
                    "https://github.com/guglxni/ProjectCrossBar/blob/main/README.md#quickstart",
                    "_blank",
                    "noopener",
                  )
                }
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
