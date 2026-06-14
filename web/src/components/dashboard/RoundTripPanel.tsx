import { useState } from "react";
import {
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  Loader2,
  Play,
  RotateCcw,
  XCircle,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_ROUND_TRIP,
  useErRoundTrip,
  type RoundTripStep,
} from "@/hooks/useErRoundTrip";
import { explorerTxLink, truncatePubkey } from "@/lib/format";

interface Props {
  onComplete?: () => void;
}

function StepRow({ step, index }: { step: RoundTripStep; index: number }) {
  const icon = {
    pending: <CircleDashed className="h-4 w-4 text-muted-foreground/50" />,
    running: <Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" />,
    done: <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />,
    error: <XCircle className="h-4 w-4 text-destructive" />,
    skipped: <CircleDashed className="h-4 w-4 text-muted-foreground/40" />,
  }[step.status];

  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={
              step.status === "pending"
                ? "text-sm text-muted-foreground"
                : "text-sm font-medium text-foreground"
            }
          >
            {index + 1}. {step.label}
          </span>
          <Badge
            variant="outline"
            className={
              step.plane === "ER"
                ? "shrink-0 border-[var(--accent)]/30 text-[var(--accent)]"
                : "shrink-0"
            }
          >
            {step.plane}
          </Badge>
        </div>
        {step.detail && (
          <p
            className={
              step.status === "error"
                ? "mt-1 break-words text-xs text-destructive"
                : "mt-1 break-words text-xs text-muted-foreground"
            }
          >
            {step.detail}
          </p>
        )}
        {step.sig && (
          <a
            href={explorerTxLink(step.sig)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            {truncatePubkey(step.sig, 6)}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </li>
  );
}

export function RoundTripPanel({ onComplete }: Props) {
  const { steps, running, error, done, run, reset, connected } =
    useErRoundTrip(onComplete);
  const [opts, setOpts] = useState(DEFAULT_ROUND_TRIP);

  const update = <K extends keyof typeof opts>(
    key: K,
    value: (typeof opts)[K],
  ) => setOpts((prev) => ({ ...prev, [key]: value }));

  const completed = steps.filter((s) => s.status === "done").length;
  const total = steps.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <Card id="roundtrip" className="glass-card border-[var(--accent)]/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-[var(--accent)]" />
          One-click ER round-trip
        </CardTitle>
        <CardDescription>
          Run the full lifecycle with your wallet, live on devnet: fund →
          delegate → submit a crossing buy &amp; sell → clear at one price inside
          the MagicBlock ER → undelegate → settle atomically to Solana L1.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <Label>Buy limit (human)</Label>
            <Input
              value={opts.buyPrice}
              onChange={(e) => update("buyPrice", e.target.value)}
              disabled={running}
              className="font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label>Sell limit (human)</Label>
            <Input
              value={opts.sellPrice}
              onChange={(e) => update("sellPrice", e.target.value)}
              disabled={running}
              className="font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label>Quantity (base atomic)</Label>
            <Input
              value={opts.qty}
              onChange={(e) => update("qty", e.target.value)}
              disabled={running}
              className="font-mono"
            />
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-border bg-background/40 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Switch
              id="rt-deposits"
              checked={opts.includeDeposits}
              onCheckedChange={(v) => update("includeDeposits", v)}
              disabled={running}
            />
            <Label htmlFor="rt-deposits" className="cursor-pointer">
              Fund balances first (deposit base + quote)
            </Label>
          </div>
          {opts.includeDeposits && (
            <div className="flex items-center gap-2">
              <Input
                value={opts.depositBase}
                onChange={(e) => update("depositBase", e.target.value)}
                disabled={running}
                className="w-28 font-mono text-xs"
                aria-label="Deposit base"
              />
              <Input
                value={opts.depositQuote}
                onChange={(e) => update("depositQuote", e.target.value)}
                disabled={running}
                className="w-28 font-mono text-xs"
                aria-label="Deposit quote"
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="lg"
            onClick={() => void run(opts)}
            disabled={running || !connected}
            className="group"
          >
            {running ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                Running… {completed}/{total}
              </>
            ) : (
              <>
                <Play className="mr-1 h-4 w-4" />
                Run full round-trip
              </>
            )}
          </Button>
          {steps.length > 0 && !running && (
            <Button variant="ghost" size="sm" onClick={reset}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              Reset
            </Button>
          )}
          {!connected && (
            <span className="text-xs text-muted-foreground">
              Connect a wallet to run.
            </span>
          )}
        </div>

        {steps.length > 0 && (
          <div className="space-y-3">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <ol className="divide-y divide-border/60 rounded-lg border border-border bg-background/40 px-4">
              {steps.map((s, i) => (
                <StepRow key={s.id} step={s} index={i} />
              ))}
            </ol>
          </div>
        )}

        {done && !error && (
          <div className="flex items-start gap-3 rounded-lg border border-[var(--success)]/30 bg-[var(--success)]/5 p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[var(--success)]" />
            <div>
              <p className="font-medium text-foreground">
                Round-trip complete.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Your orders cleared at a single uniform price inside the
                Ephemeral Rollup and settled atomically back to Solana L1. See
                the result and price history above.
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="min-w-0">
              <p className="font-medium text-foreground">Round-trip paused</p>
              <p className="mt-1 break-words text-sm text-muted-foreground">
                {error}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Completed steps already landed on chain — fix the issue and press
                Run to continue from a clean state.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
