/**
 * Tier 2 demo — spot/perp delta hedging across CrossBar and Flash Trade in one
 * (shared MagicBlock ER) session. Standalone, run with:
 *
 *   npx tsx tests/hedge-demo.ts              # MOCK mode (default, runs clean)
 *   FLASH_LIVE=1 npx tsx tests/hedge-demo.ts # real Flash PREVIEW (never submits)
 *
 * Scenario (docs/integrations/FLASH_TRADE.md, "Tier 2 — the headline"):
 *   A CrossBar window clears and fills a trader LONG some SOL at the uniform
 *   price p*. That leaves the trader with +delta SOL exposure. To become
 *   delta-neutral, the trader opens an offsetting SHORT on Flash for the same
 *   notional, both legs priced off the same Pyth Lazer reference, so the basis
 *   is locked. CrossBar gives the fair, MEV-resistant SPOT fill; Flash gives the
 *   leverage/shorting to manage the resulting exposure — neither can do the
 *   other's job, and they sit on the same rollup so latency is symmetric.
 *
 * HONESTY / network reality:
 *   - The CrossBar leg here is a SIMULATED fill (clearly labelled). It does NOT
 *     require the on-chain program; the real on-chain auction is exercised by
 *     tests/demo-devnet.ts. This demo is about the *composition*, not re-proving
 *     the clear.
 *   - Flash V2 is MAINNET ONLY with real funds; CrossBar is devnet today. So by
 *     default this runs in MOCK mode: it synthesizes a realistic Flash
 *     open-position response (clearly labelled MOCK) instead of calling the API.
 *     With FLASH_LIVE=1 it calls the REAL Flash API for a PREVIEW ONLY
 *     (owner omitted -> no transaction, nothing is ever signed or submitted).
 *   - No CPI, no real funds, no live co-execution is claimed.
 */
import {
  FlashClient,
  type OpenPositionResponse,
  type OpenPositionParams,
} from "../clients/flash/client";

const PRICE_SCALE = 1_000_000;
const FLASH_LIVE = process.env.FLASH_LIVE === "1";

/** ---- Simulated CrossBar spot leg --------------------------------------- */
// A window cleared and filled this trader LONG `spotQtySol` of SOL at p*.
// These numbers are SIMULATED (no on-chain call); see header.
const SIMULATED = {
  asset: "SOL",
  /** Uniform clearing price p* (UI float). */
  pStarUi: 148.52,
  /** Spot quantity the trader was filled LONG, in SOL. */
  spotQtySol: 3.0,
};

/**
 * Build a realistic MOCK Flash open-position response so the demo runs without
 * touching mainnet. Clearly labelled MOCK; numbers are illustrative and derived
 * from the requested params so they stay internally consistent.
 */
function mockOpenPositionResponse(params: OpenPositionParams): OpenPositionResponse {
  const notionalUsd = SIMULATED.spotQtySol * SIMULATED.pStarUi;
  const collateralUsd = notionalUsd / params.leverage;
  const sizeSol = SIMULATED.spotQtySol;
  // ~0.06% open fee, illustrative (real value comes from /pool-data openPositionFeeRate).
  const entryFee = notionalUsd * 0.0006;
  // Short liquidation sits above entry; ~ entry * (1 + 1/leverage), illustrative.
  const liqPrice = SIMULATED.pStarUi * (1 + 1 / params.leverage);
  return {
    newLeverage: params.leverage.toFixed(2),
    newEntryPrice: SIMULATED.pStarUi.toFixed(2),
    newLiquidationPrice: liqPrice.toFixed(2),
    entryFee: entryFee.toFixed(2),
    youPayUsdUi: collateralUsd.toFixed(2),
    youRecieveUsdUi: notionalUsd.toFixed(2), // intentional misspelling — matches Flash backend
    outputAmountUi: sizeSol.toFixed(4),
    transactionBase64: null, // MOCK: no real tx; preview-shaped only
    err: null,
  };
}

async function main() {
  console.log("=== Tier 2: CrossBar spot fill -> Flash perp delta-hedge ===");
  console.log(`Mode: ${FLASH_LIVE ? "LIVE PREVIEW (real Flash API, owner omitted -> no tx, never submits)" : "MOCK (no network; synthesized Flash response)"}`);
  console.log("");

  // ---- Leg 1: the CrossBar spot fill (SIMULATED) ------------------------
  const notionalUsd = SIMULATED.spotQtySol * SIMULATED.pStarUi;
  console.log("--- Leg 1: CrossBar SPOT fill  [SIMULATED — no on-chain call] ---");
  console.log(`  Filled LONG ${SIMULATED.spotQtySol} ${SIMULATED.asset} at uniform p* = $${SIMULATED.pStarUi}`);
  console.log(`  p* as fixed-point @ PRICE_SCALE=${PRICE_SCALE}: ${Math.round(SIMULATED.pStarUi * PRICE_SCALE)}`);
  console.log(`  Spot notional: $${notionalUsd.toFixed(2)}`);
  console.log(`  Resulting exposure: +${SIMULATED.spotQtySol} ${SIMULATED.asset} (long delta)`);

  // ---- Leg 2: the offsetting Flash SHORT --------------------------------
  // To hedge a LONG of N SOL, open a SHORT of the same N SOL notional on Flash.
  // The collateral input is sized so leverage * collateral == spot notional.
  const leverage = 2.0;
  const collateralUsd = notionalUsd / leverage;
  const hedgeParams: Omit<OpenPositionParams, "owner"> = {
    inputTokenSymbol: "USDC",
    outputTokenSymbol: SIMULATED.asset,
    inputAmountUi: collateralUsd.toFixed(2),
    leverage,
    tradeType: "SHORT",
    slippagePercentage: "0.5",
  };

  console.log("\n--- Leg 2: Flash PERP hedge (open SHORT) ---");
  console.log("  Hedge params (Flash open-position):");
  console.log(`    inputTokenSymbol : ${hedgeParams.inputTokenSymbol}`);
  console.log(`    outputTokenSymbol: ${hedgeParams.outputTokenSymbol}`);
  console.log(`    inputAmountUi    : "${hedgeParams.inputAmountUi}"  (collateral, UI format)`);
  console.log(`    leverage         : ${hedgeParams.leverage}`);
  console.log(`    tradeType        : ${hedgeParams.tradeType}`);
  console.log(`    slippagePercentage: "${hedgeParams.slippagePercentage}"`);

  let resp: OpenPositionResponse;
  let dataSource: string;
  if (FLASH_LIVE) {
    const flash = new FlashClient();
    console.log(`\n  Calling REAL Flash API for a PREVIEW (owner omitted): ${flash.baseUrl}`);
    try {
      resp = await flash.previewOpenPosition(hedgeParams);
      dataSource = "LIVE Flash preview (real mainnet quote; no tx built, nothing submitted)";
    } catch (e) {
      console.error("  Live Flash preview failed:", (e as Error).message);
      console.error("  Falling back to MOCK so the demo still completes.");
      resp = mockOpenPositionResponse(hedgeParams as OpenPositionParams);
      dataSource = "MOCK (live call failed)";
    }
  } else {
    resp = mockOpenPositionResponse(hedgeParams as OpenPositionParams);
    dataSource = "MOCK (synthesized, illustrative numbers)";
  }

  console.log(`\n  Flash open-position quote  [${dataSource}]:`);
  console.log(`    newEntryPrice      : $${resp.newEntryPrice}`);
  console.log(`    newLeverage        : ${resp.newLeverage}x`);
  console.log(`    newLiquidationPrice: $${resp.newLiquidationPrice}`);
  console.log(`    entryFee           : $${resp.entryFee}`);
  console.log(`    youPayUsdUi (coll) : $${resp.youPayUsdUi}`);
  console.log(`    youRecieveUsdUi    : $${resp.youRecieveUsdUi}  (size; misspelling matches Flash backend)`);
  console.log(`    outputAmountUi     : ${resp.outputAmountUi} ${SIMULATED.asset}`);
  console.log(`    transactionBase64  : ${resp.transactionBase64 === null ? "null (preview-only; never signed/submitted)" : "<unsigned tx present>"}`);
  if (resp.err) console.log(`    err                : ${resp.err}`);

  // ---- Net delta --------------------------------------------------------
  const longDelta = SIMULATED.spotQtySol;                 // +SOL from CrossBar spot
  const shortDelta = -Number(resp.outputAmountUi);        // -SOL from Flash perp short
  const netDelta = longDelta + shortDelta;

  console.log("\n--- Net delta ---");
  console.log(`  CrossBar spot : +${longDelta.toFixed(4)} ${SIMULATED.asset}`);
  console.log(`  Flash perp    : ${shortDelta.toFixed(4)} ${SIMULATED.asset}`);
  console.log(`  Net delta     : ${netDelta >= 0 ? "+" : ""}${netDelta.toFixed(4)} ${SIMULATED.asset}  (~0 => delta-neutral)`);

  console.log("\n--- Shared Pyth-reference framing ---");
  console.log("  Both legs price off the same Pyth Lazer feed (CrossBar's band gate and");
  console.log("  Flash's mark), so the spot fill and the perp hedge reference one price and");
  console.log("  the basis is locked. CrossBar = fair MEV-resistant spot; Flash = leverage/short.");

  console.log("\n--- What is real vs simulated ---");
  console.log("  Leg 1 (CrossBar spot fill): SIMULATED (no on-chain call here; see tests/demo-devnet.ts for the real clear).");
  console.log(`  Leg 2 (Flash perp hedge)  : ${FLASH_LIVE ? "REAL preview from mainnet Flash API (no tx, never submitted)." : "MOCK synthesized response (Flash V2 is mainnet-only with real funds)."}`);
  console.log("  No CPI, no real funds, no live co-execution is claimed (honesty contract).");

  if (Math.abs(netDelta) > 1e-6) {
    console.warn(`\n  Note: net delta is ${netDelta.toFixed(6)}, not exactly 0 (rounding / fees). Round-trip is approximately neutral.`);
  }
  console.log("\nHEDGE DEMO OK.");
}

main().catch((e) => {
  console.error("Unexpected error:", (e as Error).message);
  process.exit(1);
});
