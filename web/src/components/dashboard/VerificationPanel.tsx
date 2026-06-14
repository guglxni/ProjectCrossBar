import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PARITY_PASSED,
  PARITY_TOTAL,
  RUN_BATCH_CU_MAX,
  RUN_BATCH_CU_MIN,
} from "@/lib/constants";

const DIAGRAMS = [
  { label: "Architecture", href: "/diagrams/architecture.png" },
  { label: "Settlement", href: "/diagrams/settlement.png" },
  { label: "Dual flow", href: "/diagrams/dual-flow.png" },
  { label: "Math curves", href: "/diagrams/math-curves.png" },
];

export function VerificationPanel() {
  return (
    <Card id="verification">
      <CardHeader>
        <CardTitle className="text-base">Verification and parity</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-border p-4">
            <p className="text-xs text-muted-foreground">Certified parity</p>
            <p className="text-2xl font-semibold text-[var(--success)]">
              {PARITY_PASSED}/{PARITY_TOTAL}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              ./tests/parity/run_parity.sh
            </p>
          </div>
          <div className="rounded-md border border-border p-4">
            <p className="text-xs text-muted-foreground">run_batch CU</p>
            <p className="font-mono text-lg">
              ~{(RUN_BATCH_CU_MIN / 1000).toFixed(0)}k–
              {(RUN_BATCH_CU_MAX / 1000).toFixed(0)}k
            </p>
            <p className="mt-1 text-xs text-muted-foreground">from STATUS.md</p>
          </div>
          <div className="rounded-md border border-border p-4">
            <p className="text-xs text-muted-foreground">Invariants</p>
            <div className="mt-2 flex flex-wrap gap-1">
              <Badge variant="outline">N1 determinism</Badge>
              <Badge variant="outline">Single-price</Badge>
              <Badge variant="outline">VRF at margin only</Badge>
            </div>
          </div>
        </div>

        <div className="rounded-md border border-border bg-[var(--success)]/5 p-4">
          <p className="font-medium text-foreground">
            Atomic settlement to Solana L1
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Every cleared window undelegates and settles back to Solana L1 in one
            atomic flow — clearing result, fills, and reconciled balances all land
            on chain. Rollup speed for matching, full L1 guarantees on close.
          </p>
        </div>

        <div>
          <p className="mb-2 text-xs text-muted-foreground">Diagrams</p>
          <div className="flex flex-wrap gap-2">
            {DIAGRAMS.map((d) => (
              <a
                key={d.label}
                href={d.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm underline-offset-2 hover:underline"
              >
                {d.label}
              </a>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
