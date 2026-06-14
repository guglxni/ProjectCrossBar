/**
 * Flash Trade — Copy Trading
 * --------------------------------------------------------------------------
 * Project CrossBar × Flash integration. Powers the "copy trading" build-on-Flash
 * feature MagicBlock highlights ("Copy trading so anyone can follow the best
 * onchain traders").
 *
 * Mirrors the `examples-v2` copy-trade pattern: read a LEADER wallet's enriched
 * positions, SNAPSHOT-DIFF them against the FOLLOWER's (simulated) book, size
 * each mirror PROPORTIONALLY to the follower's capital, and emit the resulting
 * open / increase / close mirror trades.
 *
 * SOURCE OF TRUTH:
 *   - clients/flash/client.ts  — FlashClient {getPositions, previewOpenPosition,
 *       buildOpenPosition, buildClosePosition}; FlashPosition shape.
 *   - clients/flash/stream.ts  — FlashStream(owner).onPositions(cb).connect().
 *   - .agents/skills/flash-trade/ApiReference.md "Enriched Positions" — the
 *       PositionTableDataUiDto field set (sideUi "Long"/"Short", *Ui strings).
 *   - .agents/skills/flash-trade/ProtocolConcepts.md — "One position per market
 *       per side per wallet" (a mirror on an existing market+side MERGES into
 *       the existing position → an INCREASE, not a new position); minimum
 *       collateral ">$10 after fees" (use $11-12+).
 *   Only documented fields are read. Nothing here is invented (CrossBar honesty
 *   contract, CLAUDE.md).
 *
 * DEVNET / NO FUNDS:
 *   - LEADER positions are read from the REAL public Flash API (read-only,
 *     no auth, mainnet feed — the only place real positions live).
 *   - All MIRROR trades are MOCKED: they are *built* via the preview/builder
 *     path (no `owner`, so `transactionBase64` is null) and NEVER signed or
 *     submitted. Output is clearly labelled SIMULATED / MOCK.
 *   - FLASH_LIVE=1 upgrades the mirror builds to REAL previews against the live
 *     API (still preview-only — owner omitted, nothing signed). Default (unset)
 *     uses a fully local offline estimate so the demo runs with no network.
 *
 * MagicBlock feature: "Build on Flash — copy trading". Also shows the
 * CrossBar→Flash composition (a CrossBar batch clear mirrored onto Flash).
 *
 * Runnable:  npx tsx clients/flash/copytrade.ts
 *   LEADER          leader wallet pubkey to follow (default below)
 *   FOLLOWER_USD    follower capital in USD (default 250)
 *   FLASH_LIVE=1    build mirror previews against the REAL API (preview-only)
 *   FLASH_FOLLOW=1  also run a short live FlashStream follow() demo (~12s)
 *   FLASH_API_URL   override base URL (default https://flashapi.trade)
 */

import {
  FlashClient,
  type FlashPosition,
  type OpenPositionResponse,
  type ClosePositionResponse,
  type FlashTradeType,
} from "./client.js";
import { FlashStream } from "./stream.js";

// ---------------------------------------------------------------------------
// Constants — from ProtocolConcepts.md "Collateral & Leverage".
// ---------------------------------------------------------------------------

/** Minimum collateral after fees is ">$10"; ProtocolConcepts recommends $11-12+. */
const MIN_COLLATERAL_USD = 11;

/** Default leader: the wallet documented throughout ApiReference.md examples. */
const DEFAULT_LEADER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

// ---------------------------------------------------------------------------
// Domain types.
// ---------------------------------------------------------------------------

/** "Long" / "Short" as Flash reports them in enriched positions (sideUi). */
type SideUi = "Long" | "Short";

/** A normalized, numeric view of one leg (leader or follower) keyed by market+side. */
interface Leg {
  /** "<MARKET>:<Long|Short>" — the merge key (one position per market+side). */
  legKey: string;
  marketSymbol: string;
  sideUi: SideUi;
  /** Position size in USD (notional). */
  sizeUsd: number;
  /** Collateral backing the position in USD. */
  collateralUsd: number;
  /** Leverage = sizeUsd / collateralUsd. */
  leverage: number;
  /** Underlying position account key, when known (leader only). */
  key?: string;
}

/** Kind of mirror action the diff produces. */
type MirrorKind = "open" | "increase" | "close";

/** One mirror action against the follower's Flash book. */
interface MirrorAction {
  kind: MirrorKind;
  marketSymbol: string;
  sideUi: SideUi;
  /** Target follower notional after this action (USD). */
  targetSizeUsd: number;
  /** Notional delta this action applies (USD; +open/increase, -close). */
  deltaSizeUsd: number;
  /** Follower collateral implied for this leg (USD). */
  collateralUsd: number;
  /** Leverage mirrored from the leader leg. */
  leverage: number;
  /** Human reason / provenance string for the report. */
  reason: string;
  /**
   * The BUILT (mocked) Flash response. `transactionBase64` is always null here
   * (preview-only / owner omitted) — nothing is ever signed or submitted.
   */
  built: BuiltMirror;
}

/** A built-but-unsigned mirror, or a clearly-labelled offline estimate. */
interface BuiltMirror {
  /** "open"/"close" builder used. */
  builder: "open-position" | "close-position";
  /** Whether this came from the REAL API (FLASH_LIVE) or a local estimate. */
  source: "flash-api-preview" | "offline-estimate";
  /** Always null: preview-only mode (owner omitted). Mirrors are NEVER signed. */
  transactionBase64: null;
  /** Raw builder response when source === "flash-api-preview". */
  response?: OpenPositionResponse | ClosePositionResponse;
  /** Short summary line for the report. */
  summary: string;
}

// ---------------------------------------------------------------------------
// Parsing helpers — enriched positions carry numbers as *Ui strings.
// ---------------------------------------------------------------------------

/** Parse a Flash "*Ui" decimal string to a number; NaN/empty → fallback. */
function num(s: string | undefined, fallback = 0): number {
  if (s === undefined || s === "") return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

/** Normalize a sideUi string to the two canonical values. */
function normSide(s: string | undefined): SideUi {
  return (s ?? "").toLowerCase().startsWith("s") ? "Short" : "Long";
}

/** sideUi ("Long"/"Short") → tradeType ("LONG"/"SHORT") for the open builder. */
function tradeType(side: SideUi): FlashTradeType {
  return side === "Short" ? "SHORT" : "LONG";
}

/**
 * Collateral token for a leg. ProtocolConcepts.md: shorts use USDC; longs use
 * the target token (USDC is auto-swapped). We pay with USDC either way so the
 * follower sizes in USD; Flash swaps on long opens.
 */
const INPUT_TOKEN = "USDC";

function legKeyOf(marketSymbol: string, sideUi: SideUi): string {
  return `${marketSymbol}:${sideUi}`;
}

/** Build a numeric Leg from a documented enriched FlashPosition. */
function legFromPosition(p: FlashPosition): Leg | null {
  if (!p.marketSymbol) return null; // enrichment may omit fields; skip if no market
  const sideUi = normSide(p.sideUi);
  const sizeUsd = num(p.sizeUsdUi);
  const collateralUsd = num(p.collateralUsdUi);
  if (sizeUsd <= 0) return null;
  const leverage = collateralUsd > 0 ? sizeUsd / collateralUsd : num(p.leverageUi, 1);
  return {
    legKey: legKeyOf(p.marketSymbol, sideUi),
    marketSymbol: p.marketSymbol,
    sideUi,
    sizeUsd,
    collateralUsd,
    leverage: leverage > 0 ? leverage : 1,
    key: p.key,
  };
}

/** Total collateral the leader has deployed across all legs (USD). */
function totalCollateral(legs: Leg[]): number {
  return legs.reduce((acc, l) => acc + l.collateralUsd, 0);
}

// ---------------------------------------------------------------------------
// CopyTrader — the snapshot-diff + proportional-sizing + mirror engine.
// ---------------------------------------------------------------------------

export interface CopyTraderOptions {
  /** Follower capital in USD that backs the mirrored book. */
  followerCapitalUsd: number;
  /** When true, build mirror previews against the REAL API (still preview-only). */
  live?: boolean;
  /** Injectable client (defaults to a fresh FlashClient). */
  client?: FlashClient;
}

/**
 * CopyTrader mirrors a LEADER wallet's Flash positions onto a FOLLOWER's
 * (simulated) book, sized proportionally to the follower's capital.
 *
 * Determinism: sizing is a pure function of the leader snapshot and the
 * follower capital — no clocks, no arrival order (consistent with CrossBar's
 * N1 determinism ethos). `follow()` simply re-runs the pure diff on each
 * live snapshot.
 */
export class CopyTrader {
  readonly leader: string;
  readonly followerCapitalUsd: number;
  readonly live: boolean;
  private readonly client: FlashClient;

  /** Follower's simulated current book, keyed by legKey. Starts empty (flat). */
  private followerBook = new Map<string, Leg>();

  constructor(leader: string, opts: CopyTraderOptions) {
    if (!leader) throw new Error("CopyTrader requires a leader pubkey");
    this.leader = leader;
    this.followerCapitalUsd = opts.followerCapitalUsd;
    this.live = opts.live ?? false;
    this.client = opts.client ?? new FlashClient();
  }

  /** Read-only snapshot of the follower's current simulated book. */
  getFollowerBook(): Leg[] {
    return [...this.followerBook.values()];
  }

  /** Seed the follower's simulated book (e.g. for "already following" demos). */
  seedFollowerBook(legs: Leg[]): void {
    this.followerBook = new Map(legs.map((l) => [l.legKey, l]));
  }

  /** Fetch the leader's REAL enriched positions from the public API. */
  async readLeaderPositions(): Promise<FlashPosition[]> {
    return this.client.getPositions(this.leader);
  }

  /**
   * Proportional sizing: follower notional = leader notional × (followerCapital
   * / leaderCapital). Leverage is mirrored from the leader leg, so the implied
   * follower collateral is targetSize / leverage. Legs whose collateral would
   * fall below MIN_COLLATERAL_USD are scaled UP to the minimum (so the trade is
   * actually placeable) — flagged in the reason string.
   */
  sizeLeg(leaderLeg: Leg, leaderCapital: number): { sizeUsd: number; collateralUsd: number; floored: boolean } {
    const ratio = leaderCapital > 0 ? this.followerCapitalUsd / leaderCapital : 0;
    let collateralUsd = leaderLeg.collateralUsd * ratio;
    let floored = false;
    if (collateralUsd < MIN_COLLATERAL_USD) {
      collateralUsd = MIN_COLLATERAL_USD;
      floored = true;
    }
    const sizeUsd = collateralUsd * leaderLeg.leverage;
    return { sizeUsd, collateralUsd, floored };
  }

  /**
   * SNAPSHOT-DIFF the leader's positions against the follower's current book and
   * produce the set of mirror actions (open / increase / close). Pure given the
   * snapshot + capital. Does NOT mutate the follower book (call `apply()` for
   * that, or use `mirrorOnce`/`follow` which apply for you).
   */
  async diff(leaderPositions: FlashPosition[]): Promise<MirrorAction[]> {
    const leaderLegs = leaderPositions
      .map(legFromPosition)
      .filter((l): l is Leg => l !== null);
    const leaderCapital = totalCollateral(leaderLegs);
    const leaderByKey = new Map(leaderLegs.map((l) => [l.legKey, l]));

    const actions: MirrorAction[] = [];

    // Opens / increases: every leader leg the follower must match.
    for (const ll of leaderLegs) {
      const target = this.sizeLeg(ll, leaderCapital);
      const existing = this.followerBook.get(ll.legKey);
      const currentSize = existing?.sizeUsd ?? 0;
      const delta = target.sizeUsd - currentSize;
      // Ignore negligible drift (< $0.01) to avoid churn.
      if (Math.abs(delta) < 0.01) continue;

      const kind: MirrorKind = existing ? "increase" : "open";
      // ProtocolConcepts: a second open on an existing market+side MERGES into
      // the existing position — so an "increase" is itself an open-position call.
      const built = await this.buildOpen(ll, target.sizeUsd, target.collateralUsd, ll.leverage);
      actions.push({
        kind,
        marketSymbol: ll.marketSymbol,
        sideUi: ll.sideUi,
        targetSizeUsd: target.sizeUsd,
        deltaSizeUsd: delta,
        collateralUsd: target.collateralUsd,
        leverage: ll.leverage,
        reason:
          `leader ${ll.sideUi} ${ll.marketSymbol} $${ll.sizeUsd.toFixed(2)} ` +
          `→ ×${(this.followerCapitalUsd / (leaderCapital || 1)).toFixed(4)}` +
          (target.floored ? " [floored to min collateral]" : "") +
          (kind === "increase" ? " [merges into existing follower position]" : ""),
        built,
      });
    }

    // Closes: follower legs the leader no longer holds.
    for (const fl of this.followerBook.values()) {
      if (leaderByKey.has(fl.legKey)) continue;
      const built = await this.buildClose(fl);
      actions.push({
        kind: "close",
        marketSymbol: fl.marketSymbol,
        sideUi: fl.sideUi,
        targetSizeUsd: 0,
        deltaSizeUsd: -fl.sizeUsd,
        collateralUsd: 0,
        leverage: fl.leverage,
        reason: `leader exited ${fl.sideUi} ${fl.marketSymbol} → close follower mirror`,
        built,
      });
    }

    return actions;
  }

  /** Apply a set of mirror actions to the follower's simulated book. */
  apply(actions: MirrorAction[]): void {
    for (const a of actions) {
      const key = legKeyOf(a.marketSymbol, a.sideUi);
      if (a.kind === "close") {
        this.followerBook.delete(key);
      } else {
        this.followerBook.set(key, {
          legKey: key,
          marketSymbol: a.marketSymbol,
          sideUi: a.sideUi,
          sizeUsd: a.targetSizeUsd,
          collateralUsd: a.collateralUsd,
          leverage: a.leverage,
        });
      }
    }
  }

  /** One-shot: read leader → diff → apply → return the mirror actions. */
  async mirrorOnce(): Promise<MirrorAction[]> {
    const positions = await this.readLeaderPositions();
    const actions = await this.diff(positions);
    this.apply(actions);
    return actions;
  }

  /**
   * follow() — subscribe to the leader's LIVE positions via FlashStream and
   * re-run the pure diff on each full snapshot, mirroring changes. Mock
   * execution: each batch of actions is built (unsigned) and handed to `onMirror`.
   *
   * @returns a stop() function that closes the underlying stream.
   */
  follow(onMirror: (actions: MirrorAction[], leader: FlashPosition[]) => void): () => void {
    const stream = new FlashStream(this.leader, { updateIntervalMs: 1000 });
    // Snapshot semantics: each `positions` message is a FULL snapshot
    // (WebSocketStreaming.md §6) — exactly what diff() expects.
    stream.onPositions((positions) => {
      void this.diff(positions).then((actions) => {
        this.apply(actions);
        onMirror(actions, positions);
      });
    });
    stream.onError((err) => {
      console.error("[follow] stream error:", err instanceof Error ? err.message : err);
    });
    stream.connect();
    return () => stream.close();
  }

  // -------------------------------------------------------------------------
  // CrossBar → Flash composition.
  // -------------------------------------------------------------------------

  /**
   * "Follow the CrossBar cross": given a (simulated) CrossBar batch clear, emit
   * the matching Flash mirror trade. This shows the CrossBar→Flash composition —
   * a uniform-price batch clear on CrossBar becomes a single market mirror on
   * Flash, sized to the follower's capital and the cleared notional.
   */
  async mirrorCrossBarClear(clear: CrossBarClear): Promise<MirrorAction> {
    const sideUi = normSide(clear.side);
    const notionalUsd = clear.sizeUi * clear.pStar; // cleared size × clearing price p*
    // Cap the mirror notional at the follower's capital × a default 2x leverage
    // so a large CrossBar cross does not imply an un-fundable Flash position.
    const leverage = 2;
    const maxNotional = this.followerCapitalUsd * leverage;
    const sizeUsd = Math.min(notionalUsd, maxNotional);
    const collateralUsd = Math.max(sizeUsd / leverage, MIN_COLLATERAL_USD);
    const ll: Leg = {
      legKey: legKeyOf(clear.marketSymbol, sideUi),
      marketSymbol: clear.marketSymbol,
      sideUi,
      sizeUsd,
      collateralUsd,
      leverage,
    };
    const built = await this.buildOpen(ll, sizeUsd, collateralUsd, leverage);
    return {
      kind: "open",
      marketSymbol: clear.marketSymbol,
      sideUi,
      targetSizeUsd: sizeUsd,
      deltaSizeUsd: sizeUsd,
      collateralUsd,
      leverage,
      reason:
        `CrossBar clear ${sideUi} ${clear.marketSymbol} ${clear.sizeUi} @ p*=${clear.pStar} ` +
        `(notional $${notionalUsd.toFixed(2)}) → Flash mirror`,
      built,
    };
  }

  // -------------------------------------------------------------------------
  // Builders — MOCKED. Preview-only (owner omitted) → transactionBase64 null.
  // Nothing here is ever signed or submitted.
  // -------------------------------------------------------------------------

  private async buildOpen(
    leg: Leg,
    sizeUsd: number,
    collateralUsd: number,
    leverage: number,
  ): Promise<BuiltMirror> {
    const summary =
      `OPEN ${tradeType(leg.sideUi)} ${leg.marketSymbol} pay $${collateralUsd.toFixed(2)} ${INPUT_TOKEN} ` +
      `@ ${leverage.toFixed(2)}x → ~$${sizeUsd.toFixed(2)} size`;
    if (!this.live) {
      return {
        builder: "open-position",
        source: "offline-estimate",
        transactionBase64: null,
        summary,
      };
    }
    // REAL preview against the live API. owner omitted ⇒ preview-only,
    // transactionBase64 is null (FlashClient.previewOpenPosition).
    try {
      const response = await this.client.previewOpenPosition({
        inputTokenSymbol: INPUT_TOKEN,
        outputTokenSymbol: leg.marketSymbol,
        inputAmountUi: collateralUsd.toFixed(2),
        leverage,
        tradeType: tradeType(leg.sideUi),
      });
      return {
        builder: "open-position",
        source: "flash-api-preview",
        transactionBase64: null, // preview-only; never null-coerced to a real tx
        response,
        summary:
          summary +
          (response.err
            ? ` [api err: ${response.err}]`
            : ` [api: youReceive=$${response.youRecieveUsdUi}, entry=${response.newEntryPrice}, fee=$${response.entryFee}]`),
      };
    } catch (err) {
      return {
        builder: "open-position",
        source: "offline-estimate",
        transactionBase64: null,
        summary: summary + ` [live preview failed: ${err instanceof Error ? err.message : String(err)}]`,
      };
    }
  }

  private async buildClose(leg: Leg): Promise<BuiltMirror> {
    const summary = `CLOSE ${leg.sideUi} ${leg.marketSymbol} (~$${leg.sizeUsd.toFixed(2)} size) → receive ${INPUT_TOKEN}`;
    // Closing needs a positionKey, which a SIMULATED follower book does not have.
    // So the close is always an offline estimate here (we never had a real
    // follower position to reference). Labelled as such.
    return {
      builder: "close-position",
      source: "offline-estimate",
      transactionBase64: null,
      summary: summary + " [simulated follower position; no on-chain positionKey]",
    };
  }
}

// ---------------------------------------------------------------------------
// CrossBar clear input shape (simulated batch-clear → Flash mirror).
// ---------------------------------------------------------------------------

/** A (simulated) CrossBar batch clear leg to mirror onto Flash. */
export interface CrossBarClear {
  marketSymbol: string;
  /** "Long"/"Short" or "buy"/"sell" — normalized internally. */
  side: string;
  /** Cleared size in market units (UI). */
  sizeUi: number;
  /** Uniform clearing price p* (UI). */
  pStar: number;
}

// ---------------------------------------------------------------------------
// A clearly-labelled SIMULATED leader snapshot — used as a fallback so the
// diff / sizing logic always demonstrates even when the real leader is flat.
// Shapes are documented PositionTableDataUiDto fields only (ApiReference.md).
// ---------------------------------------------------------------------------

const SIMULATED_LEADER_POSITIONS: FlashPosition[] = [
  {
    key: "SimLeaderPos1111111111111111111111111111111",
    positionAccountData: "SIMULATED",
    sideUi: "Long",
    marketSymbol: "SOL",
    collateralSymbol: "USDC",
    entryPriceUi: "148.52",
    sizeAmountUi: "33.7",
    sizeUsdUi: "5000.00",
    collateralUsdUi: "1000.00",
    leverageUi: "5.00",
    pnlWithFeeUsdUi: "119.50",
  },
  {
    key: "SimLeaderPos2222222222222222222222222222222",
    positionAccountData: "SIMULATED",
    sideUi: "Short",
    marketSymbol: "BTC",
    collateralSymbol: "USDC",
    entryPriceUi: "64000.00",
    sizeAmountUi: "0.046",
    sizeUsdUi: "3000.00",
    collateralUsdUi: "1500.00",
    leverageUi: "2.00",
    pnlWithFeeUsdUi: "-42.10",
  },
];

// ---------------------------------------------------------------------------
// Reporting helpers.
// ---------------------------------------------------------------------------

function printLegTable(title: string, legs: Leg[]): void {
  console.log(`\n${title}`);
  if (legs.length === 0) {
    console.log("  (flat — no positions)");
    return;
  }
  for (const l of legs) {
    console.log(
      `  ${l.sideUi.padEnd(5)} ${l.marketSymbol.padEnd(5)} ` +
        `size=$${l.sizeUsd.toFixed(2).padStart(9)}  ` +
        `collat=$${l.collateralUsd.toFixed(2).padStart(8)}  lev=${l.leverage.toFixed(2)}x`,
    );
  }
}

function printActions(actions: MirrorAction[]): void {
  if (actions.length === 0) {
    console.log("  (no mirror actions — follower already in sync)");
    return;
  }
  for (const a of actions) {
    const tag = a.kind.toUpperCase().padEnd(8);
    console.log(`  [${tag}] ${a.sideUi} ${a.marketSymbol}`);
    console.log(
      `           target=$${a.targetSizeUsd.toFixed(2)}  delta=$${a.deltaSizeUsd.toFixed(2)}  ` +
        `collat=$${a.collateralUsd.toFixed(2)}  lev=${a.leverage.toFixed(2)}x`,
    );
    console.log(`           why:   ${a.reason}`);
    console.log(`           built: ${a.built.summary}`);
    console.log(`           src:   ${a.built.source}  signed=NO  tx=${a.built.transactionBase64 ?? "null"}`);
  }
}

// ---------------------------------------------------------------------------
// Demo entry point — npx tsx clients/flash/copytrade.ts
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const leader = process.env.LEADER ?? DEFAULT_LEADER;
  const followerCapitalUsd = num(process.env.FOLLOWER_USD, 250);
  const live = process.env.FLASH_LIVE === "1";

  console.log("=".repeat(74));
  console.log("Flash Trade — Copy Trading (Project CrossBar × Flash, MagicBlock build-on-Flash)");
  console.log("=".repeat(74));
  console.log(`Leader wallet   : ${leader}`);
  console.log(`Follower capital: $${followerCapitalUsd.toFixed(2)}`);
  console.log(`Mirror builds   : ${live ? "REAL API preview (FLASH_LIVE=1, owner omitted → unsigned)" : "offline estimate (set FLASH_LIVE=1 for real previews)"}`);

  const trader = new CopyTrader(leader, { followerCapitalUsd, live });

  // 1) Read the REAL leader positions; fall back to a SIMULATED snapshot if flat.
  let leaderPositions: FlashPosition[] = [];
  let usingSimulated = false;
  try {
    leaderPositions = await trader.readLeaderPositions();
    console.log(`\nLeader positions (REAL, public API): ${leaderPositions.length} found`);
  } catch (err) {
    console.log(`\nLeader read failed (${err instanceof Error ? err.message : String(err)}); using SIMULATED snapshot.`);
    usingSimulated = true;
  }
  if (!usingSimulated && leaderPositions.length === 0) {
    console.log("Leader has no open positions → falling back to a clearly-labelled SIMULATED leader snapshot.");
    usingSimulated = true;
  }
  if (usingSimulated) {
    leaderPositions = SIMULATED_LEADER_POSITIONS;
    console.log(`[SIMULATED] using ${leaderPositions.length} fabricated leader positions so the diff/sizing logic demonstrates.`);
  }

  // 2) Show leader legs.
  const leaderLegs = leaderPositions.map(legFromPosition).filter((l): l is Leg => l !== null);
  printLegTable(`Leader book${usingSimulated ? " [SIMULATED]" : " [REAL]"}:`, leaderLegs);
  console.log(`\nLeader total collateral: $${totalCollateral(leaderLegs).toFixed(2)} — proportional ratio = followerCapital / leaderCapital`);

  // 3) Snapshot-diff against the (empty) follower book → mirror actions.
  printLegTable("Follower book BEFORE (simulated, flat):", trader.getFollowerBook());
  const actions = await trader.diff(leaderPositions);
  console.log(`\nMirror actions (snapshot-diff, proportional sizing) — MOCKED, nothing signed:`);
  printActions(actions);
  trader.apply(actions);
  printLegTable("Follower book AFTER mirroring (simulated):", trader.getFollowerBook());

  // 4) Demonstrate a follow-up diff: leader trims a leg → produces a close/decrease.
  console.log("\n" + "-".repeat(74));
  console.log("Live-change demo: leader CLOSES the second leg → snapshot-diff reacts");
  console.log("-".repeat(74));
  const trimmed = leaderPositions.slice(0, 1); // drop the 2nd leg
  const reactions = await trader.diff(trimmed);
  printActions(reactions);
  trader.apply(reactions);
  printLegTable("Follower book AFTER reaction (simulated):", trader.getFollowerBook());

  // 5) CrossBar → Flash composition.
  console.log("\n" + "-".repeat(74));
  console.log("CrossBar → Flash composition: a (simulated) CrossBar batch clear → Flash mirror");
  console.log("-".repeat(74));
  const clear: CrossBarClear = { marketSymbol: "SOL", side: "Long", sizeUi: 12.5, pStar: 150.0 };
  console.log(`CrossBar clear: ${clear.side} ${clear.sizeUi} ${clear.marketSymbol} @ p*=${clear.pStar}`);
  const crossMirror = await trader.mirrorCrossBarClear(clear);
  printActions([crossMirror]);

  // 6) Optional live follow() demo against the real stream.
  if (process.env.FLASH_FOLLOW === "1" && !usingSimulated) {
    console.log("\n" + "-".repeat(74));
    console.log("follow() demo: subscribing to the leader's LIVE position feed for ~12s …");
    console.log("-".repeat(74));
    const follower = new CopyTrader(leader, { followerCapitalUsd, live });
    const stop = follower.follow((acts) => {
      console.log(`[follow] leader snapshot → ${acts.length} mirror action(s):`);
      printActions(acts);
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 12_000));
    stop();
    console.log("[follow] closed.");
  }

  // 7) Real-vs-mock footer.
  console.log("\n" + "=".repeat(74));
  console.log("REAL vs MOCK");
  console.log("=".repeat(74));
  console.log(`  REAL : leader positions ${usingSimulated ? "(SIMULATED fallback this run — leader was flat/unreachable)" : "read from the public Flash API (read-only, no auth)"}.`);
  console.log(`  REAL : proportional sizing + snapshot-diff logic (deterministic, pure).`);
  console.log(`  MOCK : every mirror trade is BUILT only — preview-only, owner omitted,`);
  console.log(`         transactionBase64 = null. NOTHING is signed or submitted.`);
  console.log(`  MOCK : the follower book is a local simulation (no on-chain follower wallet).`);
  console.log(`  Devnet/no-funds: this is a safe demo of the copy-trading mechanics.`);
  console.log(`  Set FLASH_LIVE=1 for REAL API mirror previews (still unsigned).`);
}

// Run only when executed directly (not when imported).
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
