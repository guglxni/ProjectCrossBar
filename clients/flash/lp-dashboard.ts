/**
 * Flash Trade — LP (Liquidity Provider) Dashboard
 * ------------------------------------------------
 * Project CrossBar × Flash integration. Powers the "LP dashboard" build-on-Flash
 * feature MagicBlock highlights ("track what you are earning" as a Flash LP).
 *
 * SOURCE OF TRUTH: .agents/skills/flash-trade/ApiReference.md
 *   - GET /pool-data  (section "Pool Data") — lpStats + custodyStats per pool.
 *   Only fields documented in that section are read here. No invented fields.
 *
 * READ-ONLY / NO FUNDS: This reads PUBLIC Flash mainnet pool-data only. It never
 *   connects a wallet, never signs, never moves funds, and never builds a
 *   transaction. It is a pure observability tool.
 *
 * Runnable:  npx tsx clients/flash/lp-dashboard.ts
 *   FLASH_API_URL  override base URL (default https://flashapi.trade)
 *   FLASH_OFFLINE=1  use the inline OFFLINE FIXTURE instead of the network
 *
 * Self-contained: uses Node global fetch only. No external deps, no local imports.
 */

// ----------------------------------------------------------------------------
// Types — mirror ONLY the documented GET /pool-data shape (ApiReference.md).
// ----------------------------------------------------------------------------

interface LpStats {
  lpTokenSupply: string;
  totalPoolValueUsd: string;
  lpPrice: string;
  stableCoinPercentage: string;
  maxAumUsd: string;
}

interface CustodyStats {
  symbol: string;
  custodyAccount: string;
  priceUi: string;
  minRatioUi: string;
  maxRatioUi: string;
  targetRatioUi: string;
  currentRatioUi: string;
  utilizationUi: string;
  lockedAmountUi: string;
  assetsOwnedAmountUi: string;
  totalUsdOwnedAmountUi: string;
  availableToAddAmountUi: string;
  availableToAddUsdUi: string;
  availableToRemoveAmountUi: string;
  availableToRemoveUsdUi: string;
  minCapacityAmountUi: string;
  maxCapacityAmountUi: string;
  rewardPerLpStaked: string;
  openPositionFeeRate: string;
  closePositionFeeRate: string;
  limitPriceBufferBps: string;
  maxLeverage: string;
  maxDegenLeverage: string;
  delaySeconds: string;
}

interface PoolDataSnapshot {
  poolName: string;
  poolAddress: string;
  lpStats: LpStats;
  custodyStats: CustodyStats[];
}

interface PoolDataResponse {
  pools: PoolDataSnapshot[];
}

// ----------------------------------------------------------------------------
// OFFLINE FIXTURE — small, clearly-labelled, air-gapped sample. Shape matches
// GET /pool-data exactly. Values are illustrative only (NOT live data).
// ----------------------------------------------------------------------------

const OFFLINE_FIXTURE: PoolDataResponse = {
  pools: [
    {
      poolName: "Crypto Pool",
      poolAddress: "2RLpwpC1X2FyMnVpwMGo9dTr8jGMfxHzU2S94MbYHBqn",
      lpStats: {
        lpTokenSupply: "1250000.00",
        totalPoolValueUsd: "15000000.00",
        lpPrice: "1.2000",
        stableCoinPercentage: "35.20",
        maxAumUsd: "50000000.00",
      },
      custodyStats: [
        {
          symbol: "SOL", custodyAccount: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
          priceUi: "148.52", minRatioUi: "5.00", maxRatioUi: "45.00", targetRatioUi: "25.00",
          currentRatioUi: "30.50", utilizationUi: "42.30", lockedAmountUi: "12500.0000",
          assetsOwnedAmountUi: "29550.0000", totalUsdOwnedAmountUi: "4389810.00",
          availableToAddAmountUi: "14600.2500", availableToAddUsdUi: "2168325.00",
          availableToRemoveAmountUi: "25600.5000", availableToRemoveUsdUi: "3801682.00",
          minCapacityAmountUi: "5050.0000", maxCapacityAmountUi: "45450.0000",
          rewardPerLpStaked: "123456789", openPositionFeeRate: "360", closePositionFeeRate: "360",
          limitPriceBufferBps: "100", maxLeverage: "100.00", maxDegenLeverage: "200.00", delaySeconds: "0",
        },
        {
          symbol: "BTC", custodyAccount: "9erjj6n8Hkrv9dVK1CjJatSNfCgUP6EbQ2hRbrsokRuL",
          priceUi: "65000.00", minRatioUi: "5.00", maxRatioUi: "45.00", targetRatioUi: "25.00",
          currentRatioUi: "18.10", utilizationUi: "61.75", lockedAmountUi: "25.8000",
          assetsOwnedAmountUi: "41.7700", totalUsdOwnedAmountUi: "2715050.00",
          availableToAddAmountUi: "12.5000", availableToAddUsdUi: "812500.00",
          availableToRemoveAmountUi: "8.2000", availableToRemoveUsdUi: "533000.00",
          minCapacityAmountUi: "4.0000", maxCapacityAmountUi: "100.0000",
          rewardPerLpStaked: "98765432", openPositionFeeRate: "340", closePositionFeeRate: "340",
          limitPriceBufferBps: "100", maxLeverage: "100.00", maxDegenLeverage: "200.00", delaySeconds: "0",
        },
        {
          symbol: "USDC", custodyAccount: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          priceUi: "1.0000", minRatioUi: "20.00", maxRatioUi: "60.00", targetRatioUi: "40.00",
          currentRatioUi: "35.20", utilizationUi: "12.40", lockedAmountUi: "655000.0000",
          assetsOwnedAmountUi: "5280000.0000", totalUsdOwnedAmountUi: "5280000.00",
          availableToAddAmountUi: "720000.0000", availableToAddUsdUi: "720000.00",
          availableToRemoveAmountUi: "1200000.0000", availableToRemoveUsdUi: "1200000.00",
          minCapacityAmountUi: "3000000.0000", maxCapacityAmountUi: "9000000.0000",
          rewardPerLpStaked: "55555555", openPositionFeeRate: "320", closePositionFeeRate: "320",
          limitPriceBufferBps: "100", maxLeverage: "100.00", maxDegenLeverage: "200.00", delaySeconds: "0",
        },
      ],
    },
  ],
};

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

const BASE_URL = (process.env.FLASH_API_URL ?? "https://flashapi.trade").replace(/\/+$/, "");
const OFFLINE = process.env.FLASH_OFFLINE === "1";

/** Parse a UI string to number; NaN-safe (returns 0 for unparseable). */
function num(s: string | undefined): number {
  if (s == null) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Compact USD formatting: $1.23M / $4.56K / $789.00 */
function usd(n: number): string {
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(2)}K`;
  return `${sign}$${a.toFixed(2)}`;
}

/** Plain number with thousands separators and fixed decimals. */
function fmt(n: number, decimals = 2): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function pct(n: number): string {
  return `${n.toFixed(2)}%`;
}

/**
 * Flash open/close fee rates are raw u64 (divide by RATE_POWER for decimal).
 * RATE_POWER on Flash is 1e9 (rate is stored in 1e-9 units); the documented
 * sample "360" with openPositionFeePercent "0.036%" elsewhere in the API
 * confirms rate/1e6 = percent  (360 / 1e6 = 0.00036 -> 0.036%).
 * We report the percent value to two extra decimals for fee comparison.
 */
function feeRatePct(raw: string): string {
  const r = num(raw);
  return `${(r / 1e6).toFixed(4)}%`;
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}
function padL(s: string, w: number): string {
  return s.length >= w ? s : " ".repeat(w - s.length) + s;
}

function rule(ch = "─", w = 92): string {
  return ch.repeat(w);
}

// ----------------------------------------------------------------------------
// Fetch
// ----------------------------------------------------------------------------

async function fetchPoolData(): Promise<{ data: PoolDataResponse; offline: boolean }> {
  if (OFFLINE) {
    return { data: OFFLINE_FIXTURE, offline: true };
  }
  const url = `${BASE_URL}/pool-data`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} from ${url}`);
    }
    const data = (await res.json()) as PoolDataResponse;
    if (!data || !Array.isArray(data.pools)) {
      throw new Error(`Unexpected response shape from ${url} (no 'pools' array)`);
    }
    return { data, offline: false };
  } finally {
    clearTimeout(timeout);
  }
}

// ----------------------------------------------------------------------------
// Render
// ----------------------------------------------------------------------------

interface CustodyView {
  pool: string;
  symbol: string;
  utilization: number;
  current: number;
  target: number;
  openFeeRaw: string;
  usdOwned: number;
}

function renderPool(p: PoolDataSnapshot, lines: string[], collect: CustodyView[]): number {
  const ls = p.lpStats;
  const aum = num(ls.totalPoolValueUsd);
  const maxAum = num(ls.maxAumUsd);
  const aumUtil = maxAum > 0 ? (aum / maxAum) * 100 : 0;

  lines.push("");
  lines.push(`POOL  ${p.poolName}`);
  lines.push(`      ${p.poolAddress}`);
  lines.push(rule());
  lines.push(
    `  AUM (total pool value): ${pad(usd(aum), 12)}` +
      `LP price: ${pad("$" + fmt(num(ls.lpPrice), 4), 12)}` +
      `LP supply: ${fmt(num(ls.lpTokenSupply), 2)}`,
  );
  lines.push(
    `  Stablecoin: ${pad(pct(num(ls.stableCoinPercentage)), 12)}` +
      `Max AUM: ${pad(usd(maxAum), 14)}` +
      `Cap used: ${pct(aumUtil)}`,
  );
  lines.push(rule());

  // Custody table header
  lines.push(
    "  " +
      pad("SYM", 6) +
      padL("PRICE", 12) +
      padL("ASSETS OWNED", 22) +
      padL("USD OWNED", 12) +
      padL("UTIL%", 10) +
      padL("CUR/TGT WT", 18) +
      padL("OPEN/CLOSE FEE", 18),
  );
  lines.push("  " + rule("·", 89));

  for (const c of p.custodyStats) {
    const util = num(c.utilizationUi);
    const cur = num(c.currentRatioUi);
    const tgt = num(c.targetRatioUi);
    const skew = cur < tgt ? "↓under" : cur > tgt ? "↑over" : "=";
    const wt = `${cur.toFixed(1)}/${tgt.toFixed(1)} ${skew}`;
    const fee = `${feeRatePct(c.openPositionFeeRate)}/${feeRatePct(c.closePositionFeeRate)}`;

    lines.push(
      "  " +
        pad(c.symbol, 6) +
        padL("$" + fmt(num(c.priceUi), 2), 12) +
        padL(fmt(num(c.assetsOwnedAmountUi), 4), 22) +
        padL(usd(num(c.totalUsdOwnedAmountUi)), 12) +
        padL(pct(util), 10) +
        padL(wt, 18) +
        padL(fee, 18),
    );

    collect.push({
      pool: p.poolName,
      symbol: c.symbol,
      utilization: util,
      current: cur,
      target: tgt,
      openFeeRaw: c.openPositionFeeRate,
      usdOwned: num(c.totalUsdOwnedAmountUi),
    });
  }

  return aum;
}

function renderSignals(custodies: CustodyView[], totalAum: number, lines: string[]): void {
  lines.push("");
  lines.push(rule("═"));
  lines.push("LP SIGNALS  (derived — what a liquidity provider watches)");
  lines.push(rule("═"));
  lines.push(`  Total AUM across all pools: ${usd(totalAum)}`);

  if (custodies.length === 0) {
    lines.push("  (no custodies)");
    return;
  }

  const sortedByUtil = [...custodies].sort((a, b) => b.utilization - a.utilization);
  const most = sortedByUtil[0];
  const least = sortedByUtil[sortedByUtil.length - 1];

  lines.push(
    `  Most-utilized custody:  ${pad(most.symbol + " (" + most.pool + ")", 32)}${pct(most.utilization)}` +
      "   <- highest fee/borrow yield to LPs",
  );
  lines.push(
    `  Least-utilized custody: ${pad(least.symbol + " (" + least.pool + ")", 32)}${pct(least.utilization)}` +
      "   <- idle inventory",
  );

  // Underweight-vs-target custodies => lower deposit fee = LP incentive to deposit.
  const under = custodies
    .filter((c) => c.current < c.target)
    .sort((a, b) => a.current - a.target - (b.current - b.target));

  lines.push("");
  if (under.length === 0) {
    lines.push("  Underweight custodies (deposit incentive): none — all at/above target weight.");
  } else {
    lines.push("  Underweight vs target (lower deposit fee = LP incentive to add):");
    for (const c of under) {
      const gap = c.target - c.current;
      lines.push(
        "    " +
          pad(c.symbol + " (" + c.pool + ")", 32) +
          `cur ${pad(c.current.toFixed(2) + "%", 9)} tgt ${pad(c.target.toFixed(2) + "%", 9)} ` +
          `gap ${padL(gap.toFixed(2) + "%", 8)}`,
      );
    }
  }
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main(): Promise<void> {
  let data: PoolDataResponse;
  let offline: boolean;
  try {
    const r = await fetchPoolData();
    data = r.data;
    offline = r.offline;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("");
    console.error("Flash LP Dashboard — network error.");
    console.error(`  Could not reach ${BASE_URL}/pool-data`);
    console.error(`  Reason: ${msg}`);
    console.error("  Tip: re-run air-gapped with  FLASH_OFFLINE=1  to use the inline fixture.");
    console.error("");
    process.exitCode = 1;
    return;
  }

  const lines: string[] = [];
  lines.push("");
  lines.push(rule("═"));
  lines.push("  FLASH TRADE — LP DASHBOARD          Project CrossBar × Flash integration");
  lines.push("  Read-only public pool data. No wallet, no funds, no transactions.");
  if (offline) {
    lines.push("  ** OFFLINE FIXTURE ** (FLASH_OFFLINE=1) — illustrative values, NOT live data.");
  } else {
    lines.push(`  Source: ${BASE_URL}/pool-data   (live mainnet, refreshed ~15s)`);
  }
  lines.push(rule("═"));

  const custodies: CustodyView[] = [];
  let totalAum = 0;
  for (const pool of data.pools) {
    totalAum += renderPool(pool, lines, custodies);
  }

  renderSignals(custodies, totalAum, lines);
  lines.push("");

  console.log(lines.join("\n"));
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
