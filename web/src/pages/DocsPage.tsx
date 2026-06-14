import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  Code2,
  ExternalLink,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DocsCodeBlock,
  DocsDiagram,
  DocsList,
  DocsSection,
} from "@/components/docs/DocsSection";
import { DocsMobileNav, DocsSidebar } from "@/components/docs/DocsSidebar";
import {
  DEVNET_CONSTANTS,
  DIAGRAMS,
  DOCS_SECTIONS,
  ENV_VARS,
  HONESTY_ROWS,
  INSTRUCTIONS,
  PDA_SEEDS,
  QUICKSTART_STEPS,
  type DocsSectionId,
} from "@/lib/docs-content";
import { explorerAccountLink } from "@/lib/format";

function planeBadge(plane: string) {
  if (plane === "ER") {
    return (
      <Badge className="bg-[var(--accent)] text-white hover:bg-[var(--accent)]">
        ER
      </Badge>
    );
  }
  if (plane === "L1/ER") {
    return <Badge variant="outline">L1/ER</Badge>;
  }
  return <Badge variant="secondary">L1</Badge>;
}

function honestyBadge(color: (typeof HONESTY_ROWS)[number]["color"], label?: string) {
  switch (color) {
    case "accent":
      return (
        <Badge className="bg-[var(--accent)] text-white hover:bg-[var(--accent)]">
          Devnet live
        </Badge>
      );
    case "destructive":
      return <Badge variant="destructive">Not shipped</Badge>;
    case "warning":
      return (
        <Badge className="border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-50">
          Mock default
        </Badge>
      );
    case "muted":
      return <Badge variant="outline">Local only</Badge>;
    default:
      return <Badge variant="outline">{label ?? "Read-only"}</Badge>;
  }
}

export function DocsPage() {
  const [active, setActive] = useState<DocsSectionId>("overview");

  const scrollTo = useCallback((id: DocsSectionId) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActive(id);
    }
  }, []);

  useEffect(() => {
    const ids = DOCS_SECTIONS.map((s) => s.id);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target.id) {
          setActive(visible[0].target.id as DocsSectionId);
        }
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: [0, 0.25, 0.5] },
    );

    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  return (
    <div className="mx-auto max-w-7xl px-6 py-16 md:py-24">
      <div className="mx-auto max-w-3xl text-center">
        <Badge variant="outline" className="mb-5">
          <BookOpen className="mr-1 h-3.5 w-3.5 text-[var(--accent)]" />
          Documentation
        </Badge>
        <h1 className="font-display text-4xl tracking-[-1px] text-foreground md:text-6xl">
          Everything behind the cross.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground md:text-lg">
          Protocol overview, architecture, on-chain instruction map, devnet
          constants, and honesty labels for what is live, read-only, or mock.
        </p>
      </div>

      <div className="mt-12">
        <DocsMobileNav active={active} onSelect={scrollTo} />
      </div>

      <div className="mt-10 grid gap-12 lg:grid-cols-[220px_1fr] lg:gap-16">
        <aside className="sticky top-24 hidden h-fit lg:block">
          <DocsSidebar active={active} onSelect={scrollTo} />
        </aside>

        <div className="min-w-0 space-y-14">
          <DocsSection id="overview" title="Overview">
            <p className="text-foreground">
              Project CrossBar is a frequent batch auction (FBA) DEX on Solana.
              Order matching and uniform-price clearing run inside a MagicBlock
              Ephemeral Rollup, then settle to L1 after undelegation.
            </p>
            <p>
              Continuous order books leak value to whoever lands first in a slot.
              CrossBar removes intra-batch time priority: every order that arrives
              inside the same window clears at{" "}
              <span className="font-medium text-foreground">one uniform price</span>{" "}
              (p*). Competition moves to price, not ordering.
            </p>
            <DocsList
              items={[
                "Sub-slot batched matching with protocol-controlled sequencing in the ER",
                "Canonical call-auction price rule (max volume, min imbalance, pressure, oracle ref)",
                "Integer fixed-point math only (PRICE_SCALE = 1,000,000)",
                "Certified parity against a verified reference matcher (4006/4006 batches)",
                "Two-step settlement: clear in ER, undelegate, then settle on L1",
              ]}
            />
            <div className="flex flex-wrap gap-3 pt-2">
              <Button asChild variant="outline" size="sm" className="rounded-full">
                <Link to="/dashboard">Open dashboard</Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="rounded-full">
                <Link to="/parity">Verification</Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="rounded-full">
                <Link to="/integrations">Integrations</Link>
              </Button>
            </div>
          </DocsSection>

          <DocsSection id="architecture" title="Architecture">
            <p>
              Two planes. Custody and settlement are canonical on Solana L1.
              Matching and clearing execute in the ephemeral rollup and commit back.
            </p>
            <DocsDiagram
              src={DIAGRAMS[0].src}
              alt={DIAGRAMS[0].label}
              caption={DIAGRAMS[0].caption}
            />
            <p>
              The novelty is the execution layer. CrossBar runs the clear inside
              an Ephemeral Rollup so the protocol controls ordering instead of the
              block leader, then reconciles token balances on L1.
            </p>
          </DocsSection>

          <DocsSection id="lifecycle" title="ER lifecycle">
            <p className="text-foreground">
              The full path is verified end to end on devnet: delegate, submit
              orders, clear at p* inside the ER, undelegate, settle each trader,
              finalize on L1.
            </p>
            <DocsDiagram
              src={DIAGRAMS[1].src}
              alt={DIAGRAMS[1].label}
              caption={DIAGRAMS[1].caption}
            />
            <DocsDiagram
              src={DIAGRAMS[2].src}
              alt={DIAGRAMS[2].label}
              caption={DIAGRAMS[2].caption}
            />
            <Alert>
              <AlertDescription className="text-sm">
                Settlement is a deliberate two-step. The auction clears inside the
                ER; SPL movement is a separate L1 step (undelegate_open_orders →
                settle → finalize_settlement). Magic Actions atomic
                settle-on-undelegate was reverted and is not shipped on devnet ER.
              </AlertDescription>
            </Alert>
            <DocsList
              items={[
                "delegate_market moves Market, BatchBook, and vaults to the ER",
                "submit_order and cancel_order run only while delegated",
                "run_batch is crank-only, every tick_interval_ms (~50ms)",
                "undelegate_market returns canonical state; settle moves SPL on L1",
                "crank-demo.ts automates ScheduleTask + settle keeper",
              ]}
            />
          </DocsSection>

          <DocsSection id="clearing" title="Clearing">
            <p>
              run_batch is a pure, deterministic function of the batch set and the
              reference price (invariant N1). No clock, slot, or arrival-order reads
              inside matching.
            </p>
            <DocsDiagram
              src={DIAGRAMS[3].src}
              alt={DIAGRAMS[3].label}
              caption={DIAGRAMS[3].caption}
            />
            <DocsDiagram
              src={DIAGRAMS[4].src}
              alt={DIAGRAMS[4].label}
              caption={DIAGRAMS[4].caption}
            />
            <DocsDiagram
              src={DIAGRAMS[5].src}
              alt={DIAGRAMS[5].label}
              caption={DIAGRAMS[5].caption}
            />
            <Card className="glass-card">
              <CardContent className="grid gap-4 p-6 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">Uniform price</p>
                  <p className="mt-1 font-display text-2xl text-foreground">
                    One p* per window
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">VRF scope</p>
                  <p className="mt-1 font-display text-2xl text-foreground">
                    Margin only
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Oracle gate</p>
                  <p className="mt-1 text-sm text-foreground">
                    Reject p* outside [p_ref ± band_delta_bps]
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">CFMM backstop</p>
                  <p className="mt-1 text-sm text-foreground">
                    Synthetic maker ladder when human book is thin
                  </p>
                </div>
              </CardContent>
            </Card>
          </DocsSection>

          <DocsSection id="accounts" title="Accounts">
            <p>
              Bounded slab accounts for the hot path. BatchBook and BatchResult use
              zero_copy with fixed capacity (MAX_ORDERS_PER_BATCH = 64).
            </p>
            <DocsDiagram
              src={DIAGRAMS[6].src}
              alt={DIAGRAMS[6].label}
              caption={DIAGRAMS[6].caption}
            />
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead className="font-mono text-xs">PDA seeds</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {PDA_SEEDS.map((row) => (
                    <TableRow key={row.account}>
                      <TableCell className="font-medium text-foreground">
                        {row.account}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {row.seeds}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </DocsSection>

          <DocsSection id="instructions" title="Instructions">
            <p>
              Canonical instruction map from the deployed program. The dashboard
              wires user-facing paths; crank and admin paths are labeled honestly.
            </p>
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Instruction</TableHead>
                    <TableHead>Plane</TableHead>
                    <TableHead>Surface</TableHead>
                    <TableHead className="min-w-[240px]">Summary</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {INSTRUCTIONS.map((ix) => (
                    <TableRow key={ix.name}>
                      <TableCell className="font-mono text-xs text-foreground">
                        {ix.name}
                      </TableCell>
                      <TableCell>{planeBadge(ix.plane)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {ix.surface}
                      </TableCell>
                      <TableCell className="text-xs leading-relaxed">
                        {ix.summary}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </DocsSection>

          <DocsSection id="oracle" title="Oracle band">
            <p>
              Each clear reads a reference price p_ref and enforces a band around
              it. If the feed is stale beyond oracle_max_age_slots, the batch is
              skipped. If computed p* falls outside the band, the batch is rejected
              (RejectedOutOfBand).
            </p>
            <DocsCodeBlock>{`half = p_ref * band_delta_bps / 10_000
acceptable p* in [p_ref - half, p_ref + half]`}</DocsCodeBlock>
            <p>
              Production uses Pyth Lazer on the 50ms channel. The dashboard oracle
              panel supports an authority-gated update_reference_price override for
              devnet demos.
            </p>
          </DocsSection>

          <DocsSection id="devnet" title="Devnet">
            <p className="text-foreground">
              The program is deployed and live on Solana devnet with MagicBlock ER
              at devnet.magicblock.app.
            </p>
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Constant</TableHead>
                    <TableHead className="font-mono text-xs">Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {DEVNET_CONSTANTS.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="font-medium text-foreground">
                        {row.key}
                      </TableCell>
                      <TableCell className="max-w-md break-all font-mono text-xs text-muted-foreground">
                        {row.key === "Program ID" ? (
                          <a
                            href={explorerAccountLink(row.value)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[var(--accent)] hover:underline"
                          >
                            {row.value}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          row.value
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </DocsSection>

          <DocsSection id="honesty" title="Honesty labels">
            <p>
              The website and dashboard label substrate honestly. Nothing is
              presented as mainnet live unless it is.
            </p>
            <div className="space-y-3">
              {HONESTY_ROWS.map((row) => (
                <Card key={row.feature}>
                  <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-medium text-foreground">{row.feature}</p>
                      <p className="mt-1 text-sm leading-relaxed">{row.detail}</p>
                    </div>
                    {honestyBadge(row.color, row.label)}
                  </CardContent>
                </Card>
              ))}
            </div>
          </DocsSection>

          <DocsSection id="quickstart" title="Quickstart">
            <p>Run the web dashboard locally or use the CLI demos from repo root.</p>
            <div className="space-y-6">
              {QUICKSTART_STEPS.map((step) => (
                <div key={step.title}>
                  <p className="font-medium text-foreground">{step.title}</p>
                  <DocsCodeBlock>{step.code}</DocsCodeBlock>
                  <p className="mt-2 text-xs">{step.note}</p>
                </div>
              ))}
            </div>
            <p className="pt-4 font-medium text-foreground">Environment variables</p>
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-mono text-xs">Variable</TableHead>
                    <TableHead className="font-mono text-xs">Default</TableHead>
                    <TableHead>Purpose</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ENV_VARS.map((v) => (
                    <TableRow key={v.name}>
                      <TableCell className="font-mono text-xs text-foreground">
                        {v.name}
                      </TableCell>
                      <TableCell className="max-w-[200px] break-all font-mono text-xs text-muted-foreground">
                        {v.default}
                      </TableCell>
                      <TableCell className="text-xs">{v.purpose}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </DocsSection>

          <Card className="overflow-hidden border-border">
            <CardContent className="flex flex-col items-start gap-6 p-8 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-secondary">
                  <Code2 className="h-6 w-6 text-[var(--accent)]" />
                </span>
                <div>
                  <p className="font-medium text-foreground">Source on GitHub</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Full repo with tests, parity suite, and integration designs.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button asChild className="group shrink-0 rounded-full">
                  <Link to="/dashboard">
                    Open dashboard
                    <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="rounded-full">
                  <a
                    href="https://github.com/guglxni/ProjectCrossBar"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View source
                    <ExternalLink className="ml-1 h-3.5 w-3.5" />
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
