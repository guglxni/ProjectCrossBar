/**
 * StrategyRunner — the "automated strategies running without you touching a
 * thing" loop for Project CrossBar's Flash Trade integration.
 *
 * WHAT IT DOES: a headless loop that watches CrossBar spot batch-auction
 * window clears and, for each clear, automatically manages an offsetting Flash
 * (perpetuals) hedge plus protective TP/SL triggers. One tick =
 *   1. band cross-check  — p* vs the LIVE Flash mark; skip the window if they
 *      diverge beyond `bandBps` (fail-safe). Reuses the bps-band idea from the
 *      Tier-0 keeper (clients/flash-ref.ts), reimplemented inline (no import).
 *   2. delta-hedge       — open an offsetting Flash position sized
 *      `sizeUi * hedgeRatio` (REAL previewOpenPosition; build is MOCKED).
 *   3. protective triggers — attach TP/SL via REAL previewTpSl (place MOCKED).
 *   4. report            — print the CrossBar fill, band check, hedge, triggers,
 *      and net delta for the window.
 * `run(n)` drives several synthetic CrossBar windows back-to-back, accumulating
 * a tiny P&L / exposure ledger, and prints a summary table at the end.
 *
 * MAGICBLOCK FEATURE: this is the "build-on-Flash" headline — automated
 * strategies that react to CrossBar's MagicBlock Ephemeral Rollup batch-auction
 * clears and manage Flash exposure with zero manual touch.
 *
 * SOURCE OF TRUTH: clients/flash/client.ts ({ FlashClient }) and
 * .agents/skills/flash-trade/ApiReference.md. Every Flash field/enum used here
 * is documented there — nothing invented (CrossBar honesty contract, CLAUDE.md).
 *
 * DEVNET / NO FUNDS:
 *   - The CrossBar leg is DEVNET and here SIMULATED — these window clears are
 *     synthetic. The real on-chain clear is tests/demo-devnet.ts.
 *   - The Flash legs use REAL read/preview endpoints (getPrice, previewOpenPosition,
 *     previewTpSl — public, no-auth, no wallet) but execution (open/place) is
 *     MOCKED. No transaction is built, signed, or sent; no funds move.
 *   - FLASH_LIVE=1 keeps the same behavior at the "real preview" boundary
 *     (previews hit the live API); it never enables real execution.
 *
 * N1 NOTE: this is ALL off-chain orchestration. Nothing here feeds CrossBar's
 * on-chain `run_batch`, which stays a pure deterministic function of the batch
 * set + reference price. The matcher never sees Flash data (AGENTS.md rule 1).
 *
 * Run:  npx tsx clients/flash/strategy.ts
 *       FLASH_LIVE=1 npx tsx clients/flash/strategy.ts   # real previews only
 */

import {
  FlashClient,
  type FlashSide,
  type OpenPositionResponse,
  type PreviewTpSlResponse,
} from "./client";

// CrossBar on-chain fixed-point scale (PRICE_SCALE). Shown for parity with the
// rest of the repo; the bps math itself is scale-independent.
const PRICE_SCALE = 1_000_000;

/** A single (simulated) CrossBar batch-auction window clear. */
export interface CrossBarClear {
  /** Spot side that CrossBar filled: BUY = users net bought the base asset. */
  side: "BUY" | "SELL";
  /** Filled size in UI base units (e.g. SOL). */
  sizeUi: number;
  /** Uniform clearing price p* (UI quote per base). */
  pStar: number;
}

/** StrategyRunner configuration. */
export interface StrategyConfig {
  /** Flash market symbol to hedge in, e.g. "SOL". */
  marketSymbol: string;
  /** Fraction of the CrossBar fill to offset on Flash, 0..1. */
  hedgeRatio: number;
  /** Trailing-stop half-width in basis points (drives the SL trigger). */
  trailBps: number;
  /** Oracle-band half-width in bps; windows beyond this are skipped (fail-safe). */
  bandBps: number;
}

/** Outcome of one window tick. */
export interface TickResult {
  window: number;
  clear: CrossBarClear;
  /** Flash mark used for the band check (UI). */
  flashMark: number;
  /** Signed divergence p* vs mark, in bps. */
  divergenceBps: number;
  /** Whether the window was skipped by the band fail-safe. */
  skipped: boolean;
  skipReason?: string;
  /** Hedge side opened on Flash (opposite of CrossBar's spot exposure). */
  hedgeSide?: FlashSide;
  /** Hedge size in base units (sizeUi * hedgeRatio). */
  hedgeSizeUi?: number;
  /** Notional of the hedge in USD at p*. */
  hedgeNotionalUsd?: number;
  /** TP / SL trigger prices placed (mocked). */
  tpPriceUi?: number;
  slPriceUi?: number;
  /** Net residual spot delta after hedging, in base units (signed, +long/-short). */
  netDeltaUi: number;
}

/** Running ledger across windows. */
interface Ledger {
  windowsRun: number;
  windowsHedged: number;
  windowsSkipped: number;
  /** Net Flash perp exposure in base units (signed: +long / -short). */
  netHedgeUi: number;
  /** Net residual spot delta left unhedged, base units (signed). */
  netSpotDeltaUi: number;
  /** Sum of hedge notional opened, USD (gross). */
  grossHedgeNotionalUsd: number;
}

const FIXED = 2; // dp for money-ish prints

function fmt(n: number, dp = FIXED): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Signed divergence of `a` from reference `ref`, in basis points. */
function divergenceBps(a: number, ref: number): number {
  if (ref === 0) return Infinity;
  return ((a - ref) / ref) * 10_000;
}

/**
 * StrategyRunner: drives CrossBar window clears into automated Flash hedges +
 * protective triggers. Read/preview is real; execution is mocked (see header).
 */
export class StrategyRunner {
  private readonly flash: FlashClient;
  private readonly cfg: StrategyConfig;
  private readonly ledger: Ledger = {
    windowsRun: 0,
    windowsHedged: 0,
    windowsSkipped: 0,
    netHedgeUi: 0,
    netSpotDeltaUi: 0,
    grossHedgeNotionalUsd: 0,
  };

  /**
   * Base price the synthetic CrossBar windows wobble around. Anchored to the
   * live Flash mark at the start of `run()` so p* tracks reality and the band
   * check is meaningful (defaults to 150 until the mark is fetched).
   */
  private syntheticBase = 150;

  constructor(cfg: StrategyConfig, flash: FlashClient = new FlashClient()) {
    if (cfg.hedgeRatio < 0 || cfg.hedgeRatio > 1) {
      throw new Error(`hedgeRatio must be in 0..1, got ${cfg.hedgeRatio}`);
    }
    this.cfg = cfg;
    this.flash = flash;
  }

  /** Snapshot of the accumulated ledger (read-only copy). */
  getLedger(): Readonly<Ledger> {
    return { ...this.ledger };
  }

  /**
   * Process one simulated CrossBar window clear. Steps: band check -> hedge
   * preview (real) + mocked build -> TP/SL preview (real) + mocked place ->
   * per-window report. Returns the structured result for the summary table.
   */
  async tick(windowIndex: number, clear: CrossBarClear): Promise<TickResult> {
    const { marketSymbol, hedgeRatio, trailBps, bandBps } = this.cfg;
    this.ledger.windowsRun += 1;

    console.log(`\n--- Window ${windowIndex} -------------------------------------------------`);
    console.log(
      `CrossBar clear (SIMULATED, devnet): ${clear.side} ${fmt(clear.sizeUi, 4)} ${marketSymbol} ` +
        `@ p*=$${fmt(clear.pStar)}  (fixed-point @${PRICE_SCALE}: ${Math.round(clear.pStar * PRICE_SCALE)})`,
    );

    // 1) Band cross-check: p* vs the LIVE Flash mark (real getPrice).
    const flashMark = await this.getFlashMark(marketSymbol, clear.pStar);
    const bps = divergenceBps(clear.pStar, flashMark);
    const absBps = Math.abs(bps);
    console.log(
      `Band check : Flash mark=$${fmt(flashMark)}  p* vs mark = ${bps.toFixed(2)} bps ` +
        `(|${absBps.toFixed(2)}| vs band +/-${bandBps})`,
    );

    if (absBps > bandBps) {
      this.ledger.windowsSkipped += 1;
      // Unhedged: the full CrossBar fill remains as residual spot delta.
      const netDeltaUi = this.spotDeltaSign(clear.side) * clear.sizeUi;
      this.ledger.netSpotDeltaUi += netDeltaUi;
      const skipReason = `divergence ${absBps.toFixed(2)} bps > band ${bandBps} bps`;
      console.log(`Decision   : SKIP window (fail-safe) — ${skipReason}.`);
      console.log(`             No Flash hedge opened; residual spot delta carries.`);
      return {
        window: windowIndex,
        clear,
        flashMark,
        divergenceBps: bps,
        skipped: true,
        skipReason,
        netDeltaUi,
        // hedge fields omitted (none)
      };
    }
    console.log(`Decision   : band OK — proceed with delta-hedge.`);

    // 2) Delta-hedge: open an OFFSETTING Flash position.
    // CrossBar BUY -> users are long spot -> hedge SHORT the perp, and vice versa.
    const hedgeSide: FlashSide = clear.side === "BUY" ? "SHORT" : "LONG";
    const hedgeSizeUi = clear.sizeUi * hedgeRatio;
    const hedgeNotionalUsd = hedgeSizeUi * clear.pStar;

    // Real preview of the open (preview-only: no owner, no tx built).
    // We pay USDC collateral at 1x leverage for a clean 1:1 delta offset.
    let openPreview: OpenPositionResponse | null = null;
    try {
      openPreview = await this.flash.previewOpenPosition({
        inputTokenSymbol: "USDC",
        outputTokenSymbol: marketSymbol,
        inputAmountUi: hedgeNotionalUsd.toFixed(2),
        leverage: 1,
        tradeType: hedgeSide,
      });
    } catch (e) {
      console.log(`Hedge      : (real preview unavailable: ${(e as Error).message}) — using p* as entry estimate.`);
    }

    // API omits `err` (undefined) on success and sets it to a string on failure;
    // treat null|undefined as "no error" (honesty contract: documented shape).
    const openOk = openPreview != null && openPreview.err == null;
    const entryPriceUi = openOk && openPreview!.newEntryPrice
      ? Number(openPreview!.newEntryPrice)
      : clear.pStar;
    const entryFee = openOk ? openPreview!.entryFee : undefined;

    console.log(
      `Hedge      : OPEN ${hedgeSide} ${fmt(hedgeSizeUi, 4)} ${marketSymbol} ` +
        `(~$${fmt(hedgeNotionalUsd)} @1x)  entry≈$${fmt(entryPriceUi)}` +
        (entryFee !== undefined ? `  entryFee=$${entryFee}` : ` (entry from p*, preview missing)`),
    );
    console.log(
      `             preview=${openOk ? "REAL (Flash API)" : "fallback"}` +
        `, build=MOCKED (no tx built/signed/sent — devnet/no-funds).`,
    );

    // 3) Protective TP/SL via real previewTpSl (forward mode, inline order),
    // place MOCKED. Trail half-width = trailBps either side of entry; the SL is
    // on the loss side for the hedge, TP on the gain side.
    const trail = (trailBps / 10_000) * entryPriceUi;
    // For a SHORT hedge: profit if price falls (TP below), loss if it rises (SL above).
    // For a LONG hedge:  profit if price rises (TP above), loss if it falls (SL below).
    const tpPriceUi = hedgeSide === "SHORT" ? entryPriceUi - trail : entryPriceUi + trail;
    const slPriceUi = hedgeSide === "SHORT" ? entryPriceUi + trail : entryPriceUi - trail;

    const tpPreview = await this.previewTrigger(marketSymbol, hedgeSide, entryPriceUi, hedgeNotionalUsd, tpPriceUi);
    const slPreview = await this.previewTrigger(marketSymbol, hedgeSide, entryPriceUi, hedgeNotionalUsd, slPriceUi);

    console.log(
      `Triggers   : TP @$${fmt(tpPriceUi)}${this.pnlNote(tpPreview)}  |  ` +
        `SL @$${fmt(slPriceUi)}${this.pnlNote(slPreview)}  (trail ±${trailBps} bps)`,
    );
    console.log(`             previews=${tpPreview && slPreview ? "REAL (Flash API)" : "partial/fallback"}, place=MOCKED.`);

    // 4) Net delta accounting.
    const spotDelta = this.spotDeltaSign(clear.side) * clear.sizeUi; // +long / -short
    const hedgeDelta = (hedgeSide === "LONG" ? 1 : -1) * hedgeSizeUi;
    const netDeltaUi = spotDelta + hedgeDelta;

    this.ledger.windowsHedged += 1;
    this.ledger.netHedgeUi += hedgeDelta;
    this.ledger.netSpotDeltaUi += netDeltaUi;
    this.ledger.grossHedgeNotionalUsd += hedgeNotionalUsd;

    console.log(
      `Net delta  : spot ${spotDelta >= 0 ? "+" : ""}${fmt(spotDelta, 4)} + hedge ` +
        `${hedgeDelta >= 0 ? "+" : ""}${fmt(hedgeDelta, 4)} = ` +
        `${netDeltaUi >= 0 ? "+" : ""}${fmt(netDeltaUi, 4)} ${marketSymbol} ` +
        `(hedgeRatio=${hedgeRatio} -> ${(hedgeRatio * 100).toFixed(0)}% offset).`,
    );

    return {
      window: windowIndex,
      clear,
      flashMark,
      divergenceBps: bps,
      skipped: false,
      hedgeSide,
      hedgeSizeUi,
      hedgeNotionalUsd,
      tpPriceUi,
      slPriceUi,
      netDeltaUi,
    };
  }

  /**
   * Drive `nWindows` synthetic CrossBar windows back-to-back, then print a
   * summary table. Returns all per-window results.
   */
  async run(nWindows: number): Promise<TickResult[]> {
    console.log("=== StrategyRunner: automated CrossBar->Flash hedging loop ===");
    console.log(
      `Config     : market=${this.cfg.marketSymbol} hedgeRatio=${this.cfg.hedgeRatio} ` +
        `trailBps=${this.cfg.trailBps} bandBps=${this.cfg.bandBps}`,
    );
    console.log(`Flash API  : ${this.flash.baseUrl}  (reads/previews REAL; execution MOCKED)`);

    // Anchor the synthetic CrossBar p* stream to the live Flash mark so the band
    // check is meaningful — otherwise a fixed base would always trip the band.
    try {
      const p = await this.flash.getPrice(this.cfg.marketSymbol);
      if (p && typeof p.priceUi === "number" && p.priceUi > 0) {
        this.syntheticBase = p.priceUi;
        console.log(`Synthetic p* base anchored to live ${this.cfg.marketSymbol} mark: $${fmt(this.syntheticBase)}`);
      } else {
        console.log(`Synthetic p* base: $${fmt(this.syntheticBase)} (live mark unusable; using default)`);
      }
    } catch {
      console.log(`Synthetic p* base: $${fmt(this.syntheticBase)} (live mark unreachable; using default)`);
    }

    const results: TickResult[] = [];
    for (let i = 1; i <= nWindows; i++) {
      const clear = this.syntheticClear(i);
      // eslint-disable-next-line no-await-in-loop -- windows are intentionally sequential.
      const r = await this.tick(i, clear);
      results.push(r);
    }

    this.printSummary(results);
    return results;
  }

  // -- internals -------------------------------------------------------------

  /** +1 if the spot fill leaves users net long the base, -1 if net short. */
  private spotDeltaSign(side: CrossBarClear["side"]): number {
    return side === "BUY" ? 1 : -1;
  }

  /** Real Flash mark for `symbol`; falls back to `fallback` if the API is unreachable. */
  private async getFlashMark(symbol: string, fallback: number): Promise<number> {
    try {
      const p = await this.flash.getPrice(symbol);
      if (p && typeof p.priceUi === "number" && p.priceUi > 0) return p.priceUi;
    } catch {
      // fall through to fallback (devnet/offline friendliness)
    }
    console.log(
      `             (live Flash mark for ${symbol} unavailable — using p* as mark so the demo proceeds)`,
    );
    return fallback;
  }

  /** Real forward-mode TP/SL preview for a hypothetical hedge; null on failure. */
  private async previewTrigger(
    marketSymbol: string,
    side: FlashSide,
    entryPriceUi: number,
    sizeUsdUi: number,
    triggerPriceUi: number,
  ): Promise<PreviewTpSlResponse | null> {
    try {
      const r = await this.flash.previewTpSl({
        mode: "forward",
        marketSymbol,
        entryPriceUi: entryPriceUi.toFixed(4),
        sizeUsdUi: sizeUsdUi.toFixed(2),
        collateralUsdUi: sizeUsdUi.toFixed(2), // 1x => collateral == size
        side,
        triggerPriceUi: triggerPriceUi.toFixed(4),
      });
      // null|undefined err == success (API omits the field on success).
      return r.err == null ? r : null;
    } catch {
      return null;
    }
  }

  /** Append a projected-PnL note if a real forward preview returned one. */
  private pnlNote(p: PreviewTpSlResponse | null): string {
    if (p && p.pnlUsdUi !== undefined) return ` (proj PnL $${p.pnlUsdUi})`;
    return "";
  }

  /**
   * Synthetic CrossBar window generator: alternating sides with a small,
   * deterministic price wobble around a base, plus one deliberately divergent
   * window to exercise the band fail-safe. No clock/random — reproducible.
   */
  private syntheticClear(i: number): CrossBarClear {
    const base = this.syntheticBase; // anchored to live mark in run()
    const side: CrossBarClear["side"] = i % 2 === 1 ? "BUY" : "SELL";
    // Most windows wobble a few bps around the mark (inside the band). Window 3
    // intentionally diverges ~3% to trip the band fail-safe and show the skip.
    const wobbleFrac = i === 3 ? 0.03 : (i % 2 === 0 ? -1 : 1) * (i * 0.0008);
    const pStar = +(base * (1 + wobbleFrac)).toFixed(4);
    const sizeUi = +(2 + i * 0.5).toFixed(4);
    return { side, sizeUi, pStar };
  }

  /** Print the end-of-run summary table + ledger. */
  private printSummary(results: TickResult[]): void {
    console.log("\n=== Summary (automated, no manual touch) ===");
    const header = ["Win", "Side", "Size", "p*", "Mark", "Div bps", "Action", "Hedge", "Net Δ"];
    const rows = results.map((r) => [
      String(r.window),
      r.clear.side,
      fmt(r.clear.sizeUi, 3),
      fmt(r.clear.pStar),
      fmt(r.flashMark),
      r.divergenceBps.toFixed(1),
      r.skipped ? "SKIP" : "HEDGE",
      r.skipped ? "—" : `${r.hedgeSide} ${fmt(r.hedgeSizeUi ?? 0, 3)}`,
      `${r.netDeltaUi >= 0 ? "+" : ""}${fmt(r.netDeltaUi, 3)}`,
    ]);

    const widths = header.map((h, c) => Math.max(h.length, ...rows.map((row) => row[c].length)));
    const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
    console.log(line(header));
    console.log(widths.map((w) => "-".repeat(w)).join("  "));
    for (const row of rows) console.log(line(row));

    const l = this.ledger;
    console.log("\nLedger:");
    console.log(`  windows run      : ${l.windowsRun}`);
    console.log(`  hedged / skipped : ${l.windowsHedged} / ${l.windowsSkipped}`);
    console.log(`  gross hedge USD  : $${fmt(l.grossHedgeNotionalUsd)} (notional opened, MOCKED)`);
    console.log(
      `  net Flash hedge  : ${l.netHedgeUi >= 0 ? "+" : ""}${fmt(l.netHedgeUi, 4)} ${this.cfg.marketSymbol} ` +
        `(${l.netHedgeUi >= 0 ? "net long" : "net short"} perp)`,
    );
    console.log(
      `  net spot residual: ${l.netSpotDeltaUi >= 0 ? "+" : ""}${fmt(l.netSpotDeltaUi, 4)} ${this.cfg.marketSymbol} ` +
        `(unhedged delta carried, incl. skipped windows)`,
    );

    console.log("\n--- Real vs mock footer ---");
    console.log("CrossBar clears : SIMULATED (devnet). The REAL on-chain clear is tests/demo-devnet.ts.");
    console.log("Flash mark/price: REAL  (getPrice — public, no-auth, no wallet).");
    console.log("Flash hedge open: preview REAL (previewOpenPosition), BUILD/EXECUTION MOCKED.");
    console.log("Flash TP/SL     : preview REAL (previewTpSl forward mode), PLACE MOCKED.");
    console.log("Funds           : none move. No tx is built, signed, or submitted.");
    console.log("N1              : off-chain only — nothing here feeds run_batch; the matcher stays pure.");
  }
}

/** Demo entry point: run 5 synthetic windows and print loop + summary. */
async function main(): Promise<void> {
  const live = process.env.FLASH_LIVE === "1";
  console.log(
    `(FLASH_LIVE=${live ? "1 — real previews only" : "unset — real previews if reachable, p* fallback otherwise"}; ` +
      `execution always MOCKED on devnet/no-funds.)\n`,
  );

  const runner = new StrategyRunner({
    marketSymbol: process.env.FLASH_ASSET?.toUpperCase() || "SOL",
    hedgeRatio: 0.8,
    trailBps: 150,
    bandBps: 100,
  });

  await runner.run(5);
}

// Run only when invoked directly (npx tsx clients/flash/strategy.ts).
const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  /strategy\.ts$/.test(process.argv[1] ?? "");

if (invokedDirectly) {
  main().catch((e) => {
    console.error("Unexpected error:", (e as Error).message);
    process.exit(1);
  });
}
