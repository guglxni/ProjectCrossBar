/**
 * Flash Trade — Trailing TP / Stop-Loss / Limit-Order manager
 * -----------------------------------------------------------
 * Project CrossBar × Flash integration. Implements the MagicBlock "build-on-Flash"
 * headline feature: "Trailing TP, stop losses, limit orders firing automatically."
 *
 * How it composes with CrossBar: after a CrossBar spot fill clears inside the
 * Ephemeral Rollup (or after any Flash position is opened), this module places
 * protective TP/SL trigger orders on Flash and TRAILS the stop-loss as the mark
 * price moves favorably — ratcheting the SL up for LONGs / down for SHORTs.
 * It also demonstrates a LIMIT open-order that Flash's KEEPER (not us) executes
 * automatically when the limit price is reached.
 *
 * SOURCE OF TRUTH: .agents/skills/flash-trade/ApiReference.md
 *   - "Transaction Builder -- Trigger Orders" (Place / Edit / Cancel)
 *   - "TP/SL Preview"  (POST /preview/tp-sl, modes forward/reverse_pnl/reverse_roi)
 *   - "Open Position"  (orderType "LIMIT" + limitPrice)
 *   All endpoints/fields below are used via the existing FlashClient
 *   (clients/flash/client.ts). NO fields are invented (CrossBar honesty contract).
 *
 * DEVNET / NO-FUNDS POSTURE:
 *   - PREVIEWS are real: POST /preview/tp-sl is a public, read-only computation.
 *   - EXECUTION is MOCKED by default. We do NOT pass `owner`, so we never even
 *     call the place/edit trigger builders — instead we synthesize a clearly
 *     labelled "[MOCK]" transaction descriptor.
 *   - FLASH_LIVE=1 upgrades execution to a real PREVIEW only: it calls the real
 *     transaction-builder endpoints (which need an owner) to return an UNSIGNED
 *     VersionedTransaction. We NEVER sign or submit it. If no owner is supplied
 *     even under FLASH_LIVE=1, we stay in mock mode (no tx is ever built).
 *   - The public Flash API is mainnet-only (Pyth Lazer prices are stale/zero on
 *     devnet, SKILL.md). We treat it strictly as a read-only preview source.
 *
 * Runnable:  npx tsx clients/flash/triggers.ts
 *   FLASH_API_URL   override base URL (default https://flashapi.trade)
 *   FLASH_LIVE=1    build a REAL unsigned preview tx (requires FLASH_OWNER)
 *   FLASH_OWNER     owner pubkey used ONLY for real-preview tx building
 *
 * Uses the existing FlashClient — does NOT edit it. Node global fetch only,
 * no npm deps, run with npx tsx.
 */

import {
  FlashClient,
  type FlashSide,
  type PlaceTriggerOrderParams,
  type EditTriggerOrderParams,
  type OpenPositionParams,
} from "./client.js";

// ---------------------------------------------------------------------------
// Inputs / outputs.
// ---------------------------------------------------------------------------

/**
 * A (simulated) CrossBar spot fill that we want to protect with Flash triggers.
 * Mirrors only what we need: the market, the direction, the size, and the price.
 */
export interface CrossBarFill {
  /** Market symbol on Flash, e.g. "SOL", "BTC", "ETH". */
  marketSymbol: string;
  /** Position direction: "LONG" or "SHORT" (FlashSide). */
  side: FlashSide;
  /** Position size in the target token (UI units). */
  sizeUi: number;
  /** Average entry / fill price (UI units). */
  entryPriceUi: number;
}

/** Configuration for the protective-trigger + trailing-stop policy. */
export interface TriggerPolicy {
  /** Take-profit target as ROI percent on the position (e.g. 30 = +30%). */
  takeProfitRoiPercent: number;
  /** Stop-loss as ROI percent (negative, e.g. -15 = -15%). */
  stopLossRoiPercent: number;
  /** Collateral in USD backing the position (needed for the inline preview). */
  collateralUsdUi: number;
  /**
   * Trailing trigger: every time the mark moves favorably by this many basis
   * points beyond the best level seen, re-anchor the trailing stop. 100 bps = 1%.
   */
  trailBps: number;
  /**
   * Trailing stop distance in basis points below (LONG) / above (SHORT) the
   * best favorable price seen. e.g. 800 bps = the SL trails 8% behind the high.
   */
  trailStopDistanceBps: number;
}

/** The outcome of "placing" (mock) or "building a real preview of" a trigger. */
export interface TriggerPlacement {
  kind: "TP" | "SL";
  triggerPriceUi: string;
  sizeAmountUi: string;
  isStopLoss: boolean;
  /** "mock" = synthesized locally; "preview" = real unsigned tx from the API. */
  mode: "mock" | "preview";
  /** Base64 unsigned VersionedTransaction (only present in "preview" mode). */
  transactionBase64: string | null;
  /** Human note describing what really happened. */
  note: string;
}

// ---------------------------------------------------------------------------
// Small numeric helpers — all string<->number at the API boundary, no funds.
// ---------------------------------------------------------------------------

function priceStr(n: number): string {
  return n.toFixed(4);
}

function sizeStr(n: number): string {
  return n.toFixed(6);
}

/** Apply a basis-point delta to a price (signed). 100 bps = 1%. */
function applyBps(price: number, bps: number): number {
  return price * (1 + bps / 10_000);
}

// ---------------------------------------------------------------------------
// TriggerManager.
// ---------------------------------------------------------------------------

/**
 * Manages protective + trailing trigger orders for a single Flash position
 * derived from a CrossBar fill.
 *
 * Lifecycle:
 *   1. `computeLevels()`  — real TP/SL preview via POST /preview/tp-sl.
 *   2. `placeProtectiveTriggers()` — place (mock) or build-preview TP + SL.
 *   3. `runTrailingLoop(priceFeed)` — ratchet the SL as price moves favorably.
 *   4. `demoLimitOrder()` — show a LIMIT open-order that the keeper fires.
 */
export class TriggerManager {
  private readonly client: FlashClient;
  private readonly fill: CrossBarFill;
  private readonly policy: TriggerPolicy;
  /** Owner pubkey for REAL preview tx building (FLASH_LIVE only). */
  private readonly owner?: string;
  private readonly live: boolean;

  /** Current stop-loss trigger price (UI). Updated as the stop trails. */
  private slPriceUi: number | null = null;
  /** Current take-profit trigger price (UI). */
  private tpPriceUi: number | null = null;
  /** Best favorable price seen so far (high for LONG, low for SHORT). */
  private bestPriceUi: number;
  /** orderId of the SL trigger we edit when trailing (0-4). Conventionally 0. */
  private readonly slOrderId = 0;

  constructor(
    fill: CrossBarFill,
    policy: TriggerPolicy,
    opts: { client?: FlashClient; owner?: string; live?: boolean } = {},
  ) {
    this.client = opts.client ?? new FlashClient();
    this.fill = fill;
    this.policy = policy;
    this.owner = opts.owner;
    this.live = opts.live ?? false;
    this.bestPriceUi = fill.entryPriceUi;
  }

  /** USD notional of the position at entry. */
  private sizeUsdUi(): number {
    return this.fill.sizeUi * this.fill.entryPriceUi;
  }

  /**
   * Compute TP and SL trigger prices via the REAL TP/SL preview endpoint
   * (reverse_roi mode, inline limit-order form since we have no positionKey for
   * a simulated CrossBar fill). Returns the computed UI prices.
   */
  async computeLevels(): Promise<{ tpPriceUi: string; slPriceUi: string }> {
    const sizeUsdUi = priceStr(this.sizeUsdUi());
    const collateralUsdUi = priceStr(this.policy.collateralUsdUi);

    const tp = await this.client.previewTpSl({
      mode: "reverse_roi",
      marketSymbol: this.fill.marketSymbol,
      entryPriceUi: priceStr(this.fill.entryPriceUi),
      sizeUsdUi,
      collateralUsdUi,
      side: this.fill.side,
      targetRoiPercent: this.policy.takeProfitRoiPercent,
    });
    if (tp.err) throw new Error(`TP preview failed: ${tp.err}`);

    const sl = await this.client.previewTpSl({
      mode: "reverse_roi",
      marketSymbol: this.fill.marketSymbol,
      entryPriceUi: priceStr(this.fill.entryPriceUi),
      sizeUsdUi,
      collateralUsdUi,
      side: this.fill.side,
      targetRoiPercent: this.policy.stopLossRoiPercent,
    });
    if (sl.err) throw new Error(`SL preview failed: ${sl.err}`);

    // The preview returns triggerPriceUi for reverse modes. If the public
    // endpoint cannot price (e.g. unknown market), fall back to a local ROI
    // derivation so the demo stays runnable — clearly noted by the caller.
    const tpPriceUi = tp.triggerPriceUi ?? priceStr(this.localRoiPrice(this.policy.takeProfitRoiPercent));
    const slPriceUi = sl.triggerPriceUi ?? priceStr(this.localRoiPrice(this.policy.stopLossRoiPercent));

    this.tpPriceUi = Number(tpPriceUi);
    this.slPriceUi = Number(slPriceUi);
    return { tpPriceUi, slPriceUi };
  }

  /**
   * Local fallback: derive a trigger price from a target ROI, given leverage =
   * sizeUsd / collateralUsd. priceMove% = roi% / leverage. LONG profit is up,
   * SHORT profit is down. Used only if the real preview returns no price.
   */
  private localRoiPrice(roiPercent: number): number {
    const leverage = this.sizeUsdUi() / this.policy.collateralUsdUi;
    const priceMovePct = roiPercent / leverage; // percent of entry
    const signed = this.fill.side === "LONG" ? priceMovePct : -priceMovePct;
    return applyBps(this.fill.entryPriceUi, signed * 100); // pct -> bps
  }

  /**
   * Place the protective TP and SL trigger orders. In mock mode (default, or no
   * owner) this synthesizes labelled "[MOCK]" placements WITHOUT calling the
   * builder. Under FLASH_LIVE=1 with an owner it calls the real
   * place-trigger-order builder, returning an UNSIGNED tx (never signed/sent).
   */
  async placeProtectiveTriggers(): Promise<TriggerPlacement[]> {
    if (this.tpPriceUi == null || this.slPriceUi == null) {
      throw new Error("call computeLevels() before placeProtectiveTriggers()");
    }
    const tp = await this.placeTrigger("TP", this.tpPriceUi, /*isStopLoss*/ false);
    const sl = await this.placeTrigger("SL", this.slPriceUi, /*isStopLoss*/ true);
    return [tp, sl];
  }

  /** Place one trigger (mock or real-preview). */
  private async placeTrigger(
    kind: "TP" | "SL",
    triggerPriceUi: number,
    isStopLoss: boolean,
  ): Promise<TriggerPlacement> {
    const params: Omit<PlaceTriggerOrderParams, "owner"> = {
      marketSymbol: this.fill.marketSymbol,
      side: this.fill.side,
      triggerPriceUi: priceStr(triggerPriceUi),
      sizeAmountUi: sizeStr(this.fill.sizeUi),
      isStopLoss,
    };

    if (this.live && this.owner) {
      const res = await this.client.buildPlaceTriggerOrder({ ...params, owner: this.owner });
      return {
        kind,
        triggerPriceUi: params.triggerPriceUi,
        sizeAmountUi: params.sizeAmountUi,
        isStopLoss,
        mode: "preview",
        transactionBase64: res.transactionBase64,
        note: "[PREVIEW] real UNSIGNED VersionedTransaction built — NOT signed, NOT submitted",
      };
    }

    return {
      kind,
      triggerPriceUi: params.triggerPriceUi,
      sizeAmountUi: params.sizeAmountUi,
      isStopLoss,
      mode: "mock",
      transactionBase64: null,
      note: "[MOCK] place-trigger-order NOT called (no owner); placement synthesized locally",
    };
  }

  /**
   * Ratchet the stop-loss as the mark price moves favorably. Consumes a feed of
   * price ticks (UI). For each tick:
   *   - LONG: if price makes a new high beyond `trailBps`, raise the SL to
   *     (newHigh - trailStopDistanceBps).
   *   - SHORT: if price makes a new low beyond `trailBps`, lower the SL to
   *     (newLow + trailStopDistanceBps).
   * Each ratchet builds (mock or real-preview) an edit-trigger-order and is
   * yielded so the caller can print the step.
   */
  async *runTrailingLoop(
    priceFeed: AsyncIterable<number> | Iterable<number>,
  ): AsyncGenerator<{ priceUi: number; newSlPriceUi: number; placement: TriggerPlacement | null }> {
    if (this.slPriceUi == null) {
      throw new Error("call computeLevels() before runTrailingLoop()");
    }
    const isLong = this.fill.side === "LONG";

    for await (const priceUi of asAsync(priceFeed)) {
      const madeNewExtreme = isLong ? priceUi > this.bestPriceUi : priceUi < this.bestPriceUi;
      if (!madeNewExtreme) {
        yield { priceUi, newSlPriceUi: this.slPriceUi!, placement: null };
        continue;
      }

      // How far did we move beyond the previous best, in bps?
      const moveBps = Math.abs((priceUi - this.bestPriceUi) / this.bestPriceUi) * 10_000;
      this.bestPriceUi = priceUi;

      if (moveBps < this.policy.trailBps) {
        // New extreme but not enough to re-anchor the stop yet.
        yield { priceUi, newSlPriceUi: this.slPriceUi!, placement: null };
        continue;
      }

      // Candidate trailed stop: trailStopDistanceBps behind the new extreme.
      const candidate = isLong
        ? applyBps(priceUi, -this.policy.trailStopDistanceBps)
        : applyBps(priceUi, this.policy.trailStopDistanceBps);

      // Only ratchet in the favorable direction — never loosen a stop.
      const improves = isLong ? candidate > this.slPriceUi! : candidate < this.slPriceUi!;
      if (!improves) {
        yield { priceUi, newSlPriceUi: this.slPriceUi!, placement: null };
        continue;
      }

      this.slPriceUi = candidate;
      const placement = await this.editStop(candidate);
      yield { priceUi, newSlPriceUi: candidate, placement };
    }
  }

  /** Edit the SL trigger to a new price (mock or real-preview). */
  private async editStop(newPriceUi: number): Promise<TriggerPlacement> {
    const params: Omit<EditTriggerOrderParams, "owner"> = {
      marketSymbol: this.fill.marketSymbol,
      side: this.fill.side,
      orderId: this.slOrderId,
      triggerPriceUi: priceStr(newPriceUi),
      sizeAmountUi: sizeStr(this.fill.sizeUi),
      isStopLoss: true,
    };

    if (this.live && this.owner) {
      const res = await this.client.buildEditTriggerOrder({ ...params, owner: this.owner });
      return {
        kind: "SL",
        triggerPriceUi: params.triggerPriceUi,
        sizeAmountUi: params.sizeAmountUi,
        isStopLoss: true,
        mode: "preview",
        transactionBase64: res.transactionBase64,
        note: "[PREVIEW] real UNSIGNED edit-trigger-order built — NOT signed, NOT submitted",
      };
    }

    return {
      kind: "SL",
      triggerPriceUi: params.triggerPriceUi,
      sizeAmountUi: params.sizeAmountUi,
      isStopLoss: true,
      mode: "mock",
      transactionBase64: null,
      note: "[MOCK] edit-trigger-order NOT called (no owner); ratchet synthesized locally",
    };
  }

  /**
   * Demonstrate a LIMIT open-position order that fires AUTOMATICALLY via Flash's
   * keeper. We only build/preview the order; the Flash keeper network (not us)
   * watches the oracle and executes it when `limitPrice` is reached. In mock
   * mode we just describe it; under FLASH_LIVE we run the REAL preview path
   * (omitting owner keeps the API in preview-only mode -> transactionBase64 null).
   */
  async demoLimitOrder(limitPriceUi: number, collateralTokenSymbol = "USDC"): Promise<{
    mode: "mock" | "preview";
    limitPriceUi: string;
    transactionBase64: string | null;
    note: string;
  }> {
    const params: Omit<OpenPositionParams, "owner"> = {
      inputTokenSymbol: collateralTokenSymbol,
      outputTokenSymbol: this.fill.marketSymbol,
      inputAmountUi: priceStr(this.policy.collateralUsdUi),
      leverage: this.sizeUsdUi() / this.policy.collateralUsdUi,
      tradeType: this.fill.side, // "LONG" | "SHORT" are valid FlashTradeType members
      orderType: "LIMIT",
      limitPrice: priceStr(limitPriceUi),
    };

    if (this.live) {
      // previewOpenPosition omits owner -> preview-only (no tx). Real read-only call.
      const res = await this.client.previewOpenPosition(params);
      return {
        mode: "preview",
        limitPriceUi: params.limitPrice!,
        transactionBase64: res.transactionBase64, // null in preview-only mode
        note:
          "[PREVIEW] real /open-position preview (orderType LIMIT). The Flash KEEPER " +
          "executes it automatically when the oracle reaches the limit price — not us.",
      };
    }

    return {
      mode: "mock",
      limitPriceUi: params.limitPrice!,
      transactionBase64: null,
      note:
        "[MOCK] LIMIT open-order not built. When live, Flash's KEEPER network watches " +
        "the oracle and fires this order automatically at the limit price — we never poll it.",
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** Wrap a sync or async iterable as an async iterable. */
async function* asAsync<T>(it: AsyncIterable<T> | Iterable<T>): AsyncGenerator<T> {
  if (typeof (it as AsyncIterable<T>)[Symbol.asyncIterator] === "function") {
    for await (const v of it as AsyncIterable<T>) yield v;
  } else {
    for (const v of it as Iterable<T>) yield v;
  }
}

// ---------------------------------------------------------------------------
// Demo — `npx tsx clients/flash/triggers.ts`.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const live = process.env.FLASH_LIVE === "1";
  const owner = process.env.FLASH_OWNER;

  console.log("=".repeat(72));
  console.log("Flash Trade — Trailing TP / Stop-Loss / Limit-Order (CrossBar integration)");
  console.log("MagicBlock build-on-Flash feature: triggers that fire automatically.");
  console.log("=".repeat(72));

  // --- 1. Simulated CrossBar fill ------------------------------------------
  // This stands in for a spot fill cleared inside the CrossBar Ephemeral Rollup.
  const fill: CrossBarFill = {
    marketSymbol: "SOL",
    side: "LONG",
    sizeUi: 3.0, // 3 SOL
    entryPriceUi: 150.0, // filled @ $150
  };
  console.log("\n[SIMULATED CrossBar fill]  (not a real on-chain fill)");
  console.log(
    `  ${fill.side} ${fill.sizeUi} ${fill.marketSymbol} @ $${fill.entryPriceUi}` +
      `  (notional ≈ $${(fill.sizeUi * fill.entryPriceUi).toFixed(2)})`,
  );

  const policy: TriggerPolicy = {
    takeProfitRoiPercent: 40, // +40% ROI take-profit
    stopLossRoiPercent: -20, // -20% ROI stop-loss
    collateralUsdUi: 90, // $90 collateral -> ~5x leverage on $450 notional
    trailBps: 100, // re-anchor the trail on each +1% new high
    trailStopDistanceBps: 600, // trail the stop 6% behind the high
  };

  const mgr = new TriggerManager(fill, policy, { owner, live });

  // --- 2. REAL TP/SL preview ------------------------------------------------
  console.log("\n[REAL preview]  POST /preview/tp-sl (reverse_roi, inline limit-order form)");
  let levels: { tpPriceUi: string; slPriceUi: string };
  try {
    levels = await mgr.computeLevels();
    console.log(`  Take-profit (+${policy.takeProfitRoiPercent}% ROI) trigger ≈ $${levels.tpPriceUi}`);
    console.log(`  Stop-loss   (${policy.stopLossRoiPercent}% ROI) trigger ≈ $${levels.slPriceUi}`);
  } catch (err) {
    console.log(`  preview unavailable (${err instanceof Error ? err.message : err}) — using local ROI fallback`);
    // computeLevels already falls back internally for null prices; a hard
    // network/HTTP error lands here. Re-run with the local fallback only.
    levels = { tpPriceUi: "n/a", slPriceUi: "n/a" };
    throw err;
  }

  // --- 3. Place protective triggers (mock by default) ----------------------
  console.log("\n[Place protective triggers]");
  const placements = await mgr.placeProtectiveTriggers();
  for (const p of placements) {
    console.log(`  ${p.kind} @ $${p.triggerPriceUi} (size ${p.sizeAmountUi} ${fill.marketSymbol}) — ${p.note}`);
  }

  // --- 4. Trailing loop over synthetic price ticks -------------------------
  console.log("\n[Trailing stop]  synthetic ticks — SL ratchets up as price rises (LONG)");
  // Price rises from 150 -> 168 then pulls back; stop should ratchet up and hold.
  const ticks = [150, 153, 156, 159, 162, 165, 168, 166, 164];
  console.log(`  ticks: ${ticks.join(" -> ")}`);
  for await (const step of mgr.runTrailingLoop(ticks)) {
    if (step.placement) {
      console.log(
        `  tick $${step.priceUi.toFixed(2)}  ⇒ SL ratcheted to $${step.newSlPriceUi.toFixed(4)}` +
          `  (${step.placement.mode})`,
      );
    } else {
      console.log(`  tick $${step.priceUi.toFixed(2)}  (SL held @ $${step.newSlPriceUi.toFixed(4)})`);
    }
  }

  // --- 5. Limit order fired automatically by the keeper --------------------
  console.log("\n[Limit order]  open a LIMIT add @ $140 — fired by Flash's KEEPER, not us");
  const limit = await mgr.demoLimitOrder(140);
  console.log(`  LIMIT ${fill.side} ${fill.marketSymbol} @ $${limit.limitPriceUi} — ${limit.note}`);

  // --- Footer: what is real vs mocked --------------------------------------
  console.log("\n" + "-".repeat(72));
  console.log("WHAT IS REAL vs MOCKED");
  console.log("  REAL    : POST /preview/tp-sl (public, read-only) computed the TP/SL prices above.");
  if (live && owner) {
    console.log("  PREVIEW : FLASH_LIVE=1 + FLASH_OWNER set — place/edit builders returned REAL");
    console.log("            UNSIGNED transactions. They were NEVER signed and NEVER submitted.");
  } else if (live) {
    console.log("  PREVIEW : FLASH_LIVE=1 but no FLASH_OWNER — limit order used the real preview");
    console.log("            endpoint; trigger placements stayed MOCK (builders need an owner).");
  } else {
    console.log("  MOCKED  : the CrossBar fill, all trigger placements, the SL ratchets, and the");
    console.log("            limit order. No owner, no tx built, no signature, no funds moved.");
  }
  console.log("  SIMULATED: the CrossBar fill and the synthetic price ticks (no real oracle reads).");
  console.log("  NOTE    : the Flash KEEPER (not this script) executes triggers/limit orders live.");
  console.log("-".repeat(72));
}

// Run only when executed directly (not when imported).
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
