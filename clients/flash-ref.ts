/**
 * Tier 0 keeper — Flash Trade as an independent price/liquidity reference.
 * Standalone, read-only, NO WALLET. Run with:
 *
 *   npx tsx clients/flash-ref.ts
 *   CROSSBAR_REF=149.10 BAND_BPS=50 npx tsx clients/flash-ref.ts
 *   FLASH_OFFLINE=1 FLASH_FIXTURE_PRICE=150 npx tsx clients/flash-ref.ts  # zero network
 *
 * What it does (see docs/integrations/FLASH_TRADE.md, "Tier 0"):
 *   1. Pulls Flash's public, no-auth `/prices` and `/pool-data` (REAL mainnet
 *      data — these endpoints are public and read-only, safe to call anywhere).
 *   2. Picks an asset (default SOL) and reads Flash's mark price + pool depth.
 *   3. Cross-checks Flash's mark against a CrossBar reference price (env
 *      CROSSBAR_REF, else defaults to Flash's own mark so the demo always runs),
 *      computes the divergence in basis points, and decides whether it is within
 *      a band delta (env BAND_BPS, default 50):
 *          band OK   -> within delta, proceed
 *          widen     -> 1x..2x delta, widen the band defensively
 *          skip window (fail safe) -> beyond 2x delta, do not clear this window
 *
 * SAFETY (honesty contract): this is the OFF-CHAIN keeper only. It NEVER feeds
 * run_batch — that would break N1 (the matcher is a pure function of the batch
 * set + reference price). Flash data only ever informs the off-chain oracle band
 * before `update_reference_price`. Read-only, advisory.
 *
 * NOTE: Flash prices are LIVE on MAINNET; CrossBar runs on devnet. The default
 * mode does a read-only HTTP GET of Flash's PUBLIC price API — no wallet, no RPC,
 * no funds (just fetching public JSON, like loading a webpage). For a strictly
 * devnet-only / air-gapped setup, FLASH_OFFLINE=1 skips the network entirely and
 * uses a fixture mark, so the cross-check arithmetic still runs with zero mainnet
 * contact (also handy if the live API is unreachable during a demo).
 */
import { FlashClient, type FlashPrice } from "./flash/client";

// CrossBar's on-chain fixed-point scale (PRICE_SCALE). Shown for parity with the
// rest of the repo; the bps math itself is scale-independent.
const PRICE_SCALE = 1_000_000;

const ASSET = (process.env.FLASH_ASSET || "SOL").toUpperCase();
const BAND_BPS = Number(process.env.BAND_BPS || 50);
const OFFLINE = process.env.FLASH_OFFLINE === "1";
const FIXTURE_PRICE = Number(process.env.FLASH_FIXTURE_PRICE || 150);

/** Divergence of `a` from reference `ref`, in basis points (signed). */
function divergenceBps(a: number, ref: number): number {
  if (ref === 0) return Infinity;
  return ((a - ref) / ref) * 10_000;
}

/** Map an absolute divergence (bps) + band half-width to a keeper decision. */
function bandDecision(absBps: number, bandBps: number): { verdict: string; detail: string } {
  if (absBps <= bandBps) {
    return { verdict: "band OK", detail: `within +/-${bandBps} bps; proceed with update_reference_price` };
  }
  if (absBps <= bandBps * 2) {
    return { verdict: "widen", detail: `between ${bandBps} and ${bandBps * 2} bps; widen the band defensively` };
  }
  return { verdict: "skip window (fail safe)", detail: `beyond ${bandBps * 2} bps; skip the clear, do not trust the band` };
}

async function main() {
  const flash = new FlashClient();
  console.log("=== Flash Trade Tier 0 keeper (read-only, no wallet) ===");
  console.log(`Mode           : ${OFFLINE ? "OFFLINE FIXTURE (zero network, no mainnet contact)" : "LIVE READ (public Flash mainnet HTTP API; no wallet/RPC/funds)"}`);
  if (!OFFLINE) console.log(`Flash API base : ${flash.baseUrl}`);
  console.log(`Asset          : ${ASSET}`);
  console.log(`Band half-width: ${BAND_BPS} bps\n`);

  // Resolve Flash's mark for ASSET — from a fixture (offline) or the live public API.
  let mark: Pick<FlashPrice, "priceUi" | "marketSession" | "exponent">;
  if (OFFLINE) {
    mark = { priceUi: FIXTURE_PRICE, marketSession: "fixture", exponent: 0 };
    console.log(`Flash mark for ${ASSET}: $${mark.priceUi}  (OFFLINE FIXTURE — set FLASH_FIXTURE_PRICE to change)`);
  } else {
    let prices: Record<string, FlashPrice>;
    try {
      prices = await flash.getPrices();
    } catch (e) {
      console.error("Could not reach Flash /prices:", (e as Error).message);
      console.error("Run with FLASH_OFFLINE=1 for a zero-network fixture, or restore connectivity.");
      process.exit(1);
    }
    const live = prices[ASSET];
    if (!live) {
      console.error(`Flash /prices did not include "${ASSET}". Available: ${Object.keys(prices).slice(0, 20).join(", ")}`);
      process.exit(1);
    }
    mark = live;
    console.log(`Flash mark for ${ASSET}: $${mark.priceUi}  (session: ${mark.marketSession}, exp: ${mark.exponent})`);

    // Pool depth for the same asset (advisory liquidity signal) — live only.
    try {
      const pools = await flash.getPoolData();
      for (const pool of pools.pools) {
        const c = pool.custodyStats.find((s) => s.symbol.toUpperCase() === ASSET);
        if (c) {
          console.log(
            `Flash pool "${pool.poolName}": ${ASSET} owned=${c.assetsOwnedAmountUi} ` +
              `locked=${c.lockedAmountUi} utilization=${c.utilizationUi}% (depth signal)`,
          );
        }
      }
    } catch (e) {
      console.warn("(/pool-data unavailable, continuing with price cross-check only:", (e as Error).message + ")");
    }
  }

  // CrossBar reference: env override, else fall back to Flash's own mark so the
  // demo always produces a meaningful (zero-divergence) result.
  const refEnv = process.env.CROSSBAR_REF;
  const crossbarRef = refEnv !== undefined ? Number(refEnv) : mark.priceUi;
  const refSource = refEnv !== undefined ? "env CROSSBAR_REF" : "defaulted to Flash mark (set CROSSBAR_REF to compare a real push)";
  console.log(`\nCrossBar reference price: $${crossbarRef}  (${refSource})`);
  console.log(`  (as fixed-point @ PRICE_SCALE=${PRICE_SCALE}: ${Math.round(crossbarRef * PRICE_SCALE)})`);

  const bps = divergenceBps(mark.priceUi, crossbarRef);
  const absBps = Math.abs(bps);
  const decision = bandDecision(absBps, BAND_BPS);

  console.log("\n--- Band cross-check ---");
  console.log(`Flash mark vs CrossBar ref divergence: ${bps.toFixed(2)} bps (|${absBps.toFixed(2)}|)`);
  console.log(`Decision: ${decision.verdict}`);
  console.log(`  -> ${decision.detail}`);
  console.log("\n(Advisory only. This never enters run_batch — N1 keeps the matcher pure.)");
}

main().catch((e) => {
  console.error("Unexpected error:", (e as Error).message);
  process.exit(1);
});
