import {
  BASE_RPC,
  DELEGATION_PROGRAM,
  ER_RPC,
  MAX_ORDERS_PER_BATCH,
  PARITY_PASSED,
  PARITY_TOTAL,
  PRICE_SCALE,
  PROGRAM_ID,
  RUN_BATCH_CU_MAX,
  RUN_BATCH_CU_MIN,
  VALIDATOR,
} from "@/lib/constants";

export type DocsSectionId =
  | "overview"
  | "architecture"
  | "lifecycle"
  | "clearing"
  | "accounts"
  | "instructions"
  | "oracle"
  | "live-market"
  | "devnet"
  | "quickstart";

export const DOCS_SECTIONS: { id: DocsSectionId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "architecture", label: "Architecture" },
  { id: "lifecycle", label: "ER lifecycle" },
  { id: "clearing", label: "Clearing" },
  { id: "accounts", label: "Accounts" },
  { id: "instructions", label: "Instructions" },
  { id: "oracle", label: "Oracle band" },
  { id: "live-market", label: "Live market data" },
  { id: "devnet", label: "Devnet" },
  { id: "quickstart", label: "Quickstart" },
];

export type InstructionRow = {
  name: string;
  plane: "L1" | "ER" | "L1/ER";
  surface: string;
  summary: string;
};

export const INSTRUCTIONS: InstructionRow[] = [
  {
    name: "init_market",
    plane: "L1",
    surface: "Admin setup",
    summary: "Creates Market, vaults, and oracle PDAs. Sets tick interval, band, and slab capacity.",
  },
  {
    name: "delegate_market",
    plane: "L1",
    surface: "Lifecycle panel",
    summary: "Delegates Market, BatchBook, and vaults into the Ephemeral Rollup session.",
  },
  {
    name: "delegate_open_orders",
    plane: "L1",
    surface: "Auto on deposit",
    summary: "Delegates a trader OpenOrders PDA before first ER submit.",
  },
  {
    name: "set_delegated",
    plane: "L1",
    surface: "Pre-delegate flip",
    summary: "Marks market status Delegated after delegation wiring completes.",
  },
  {
    name: "make_private",
    plane: "L1",
    surface: "PER (advanced)",
    summary: "Upgrades market to a Private ER for confidential resting sizes (future TEE read path).",
  },
  {
    name: "make_open_orders_private",
    plane: "L1",
    surface: "PER (advanced)",
    summary: "Marks a trader OpenOrders account private under PER.",
  },
  {
    name: "schedule_batch",
    plane: "L1/ER",
    surface: "Crank registration",
    summary: "Registers ScheduleTask so run_batch fires every tick_interval_ms.",
  },
  {
    name: "deposit",
    plane: "L1",
    surface: "Wallet balances",
    summary: "Moves SPL into escrow on OpenOrders (base or quote).",
  },
  {
    name: "withdraw",
    plane: "L1",
    surface: "Wallet balances",
    summary: "Pulls claimable escrow back to the trader wallet.",
  },
  {
    name: "submit_order",
    plane: "ER",
    surface: "Order form",
    summary: "Adds an order to the forming batch window. Reserves escrow internally (no SPL CPI in ER).",
  },
  {
    name: "cancel_order",
    plane: "ER",
    surface: "Book row action",
    summary: "Removes an order while its window is still forming.",
  },
  {
    name: "update_reference_price",
    plane: "ER",
    surface: "Oracle panel",
    summary: "Authority override of oracle reference for demos. Production uses Pyth Lazer feed.",
  },
  {
    name: "run_batch",
    plane: "ER",
    surface: "Crank only",
    summary: "Deterministic clear: read oracle, compute p*, write BatchResult. Not user-callable.",
  },
  {
    name: "request_window_vrf",
    plane: "ER",
    surface: "Window progress",
    summary: "Requests VRF entropy for randomized window close target.",
  },
  {
    name: "consume_window_vrf",
    plane: "ER",
    surface: "Window progress",
    summary: "Consumes VRF and sets window_target_ticks for the forming window.",
  },
  {
    name: "commit",
    plane: "ER",
    surface: "Lifecycle",
    summary: "Checkpoints delegated accounts from ER to L1 without undelegating.",
  },
  {
    name: "undelegate_market",
    plane: "ER",
    surface: "Settle flow",
    summary: "Commits and undelegates market PDAs. Sets status Settling.",
  },
  {
    name: "undelegate_open_orders",
    plane: "ER",
    surface: "Settle flow",
    summary: "Undelegates trader OpenOrders after a clear.",
  },
  {
    name: "settle",
    plane: "L1",
    surface: "Settle flow",
    summary: "Moves tokens for fills and refunds unfilled escrow. One-shot per (trader, window).",
  },
  {
    name: "finalize_settlement",
    plane: "L1",
    surface: "Settle flow",
    summary: "Returns market to OnBase after all traders settle.",
  },
  {
    name: "request_marginal_vrf",
    plane: "ER",
    surface: "Marginal detail",
    summary: "VRF for indivisible marginal remainder only.",
  },
  {
    name: "consume_marginal_vrf",
    plane: "ER",
    surface: "Marginal detail",
    summary: "Applies marginal VRF tie-break to the last partial fill.",
  },
  {
    name: "force_undelegate",
    plane: "L1",
    surface: "Escape hatch",
    summary: "Timeout-based undelegation if the ER stalls.",
  },
];

export const PDA_SEEDS = [
  { account: "Market", seeds: '["market", base_mint, quote_mint]' },
  { account: "BatchBook", seeds: '["book", market]' },
  { account: "BatchResult", seeds: '["result", market]' },
  { account: "Base vault", seeds: '["base_vault", market]' },
  { account: "Quote vault", seeds: '["quote_vault", market]' },
  { account: "Oracle", seeds: '["oracle", market]' },
  { account: "OpenOrders", seeds: '["open_orders", market, owner]' },
];

export const DIAGRAMS = [
  {
    id: "architecture",
    label: "Two-plane architecture",
    src: "/diagrams/architecture.png",
    caption: "Custody and settlement on Solana L1. Matching and clearing inside the Ephemeral Rollup.",
  },
  {
    id: "lifecycle",
    label: "Market lifecycle",
    src: "/diagrams/lifecycle.png",
    caption: "Delegate, clear in the ER, undelegate, then settle on L1.",
  },
  {
    id: "settlement",
    label: "Settlement path",
    src: "/diagrams/settlement.png",
    caption: "Clearing runs in the ER. SPL reconciliation is a separate L1 step after undelegation.",
  },
  {
    id: "clearing",
    label: "run_batch pipeline",
    src: "/diagrams/clearing.png",
    caption: "Oracle read, curve aggregation, uniform p*, fills, and BatchResult write.",
  },
  {
    id: "dual-flow",
    label: "Dual-flow crossing",
    src: "/diagrams/dual-flow.png",
    caption: "Maker priority at the margin with a single uniform clearing price preserved.",
  },
  {
    id: "math-curves",
    label: "Demand and supply curves",
    src: "/diagrams/math-curves.png",
    caption: "Aggregated ladders crossed at one p* by the canonical call-auction rule.",
  },
  {
    id: "account-model",
    label: "Account model",
    src: "/diagrams/account-model.png",
    caption: "PDA layout and which instructions touch L1 vs the ER.",
  },
];

export const DEVNET_CONSTANTS = [
  { key: "Program ID", value: PROGRAM_ID.toBase58() },
  { key: "Delegation program", value: DELEGATION_PROGRAM.toBase58() },
  { key: "MagicBlock validator", value: VALIDATOR.toBase58() },
  { key: "Base RPC", value: BASE_RPC },
  { key: "ER RPC", value: ER_RPC },
  { key: "PRICE_SCALE", value: String(PRICE_SCALE) },
  { key: "MAX_ORDERS_PER_BATCH", value: String(MAX_ORDERS_PER_BATCH) },
  {
    key: "run_batch CU",
    value: `~${(RUN_BATCH_CU_MIN / 1000).toFixed(0)}k–${(RUN_BATCH_CU_MAX / 1000).toFixed(0)}k`,
  },
  {
    key: "Certified parity",
    value: `${PARITY_PASSED}/${PARITY_TOTAL}`,
  },
];

export const QUICKSTART_STEPS = [
  {
    title: "Build the program (optional)",
    code: "anchor build",
    note: "IDL is already vendored at web/src/idl/crossbar.json.",
  },
  {
    title: "Configure the web app",
    code: "cd web && cp .env.example .env",
    note: "Set VITE_MARKET_PUBKEY if you have an existing devnet market.",
  },
  {
    title: "Run locally",
    code: "npm install && npm run dev",
    note: "Open http://localhost:5173/dashboard and hard-refresh (Cmd+Shift+R) after proxy changes.",
  },
  {
    title: "Full ER round-trip (CLI)",
    code: "npx tsx tests/er-demo.ts",
    note: "Requires EPHEMERAL_PROVIDER_ENDPOINT=https://devnet.magicblock.app/",
  },
  {
    title: "Crank + settle keeper",
    code: "npx tsx tests/crank-demo.ts",
    note: "ScheduleTask fires run_batch; keeper undelegates and settles each trader.",
  },
];

export const LIVE_MARKET_SOURCES = [
  {
    data: "Live spot price",
    primary: "Flash Trade GET /prices",
    fallback: "CoinGecko simple/price",
    module: "flash-prices.ts",
  },
  {
    data: "24h change %",
    primary: "Pyth Benchmarks (hourly candles)",
    fallback: "CoinGecko usd_24h_change",
    module: "pyth-benchmarks.ts",
  },
  {
    data: "Intraday chart + 24h high/low",
    primary: "Pyth Benchmarks TradingView shim",
    fallback: "CoinGecko market_chart",
    module: "market-data.ts",
  },
] as const;

export const LIVE_MARKET_SYMBOLS =
  "SOL, ETH, BTC, BNB, HYPE, JUP, BONK, JTO, PYTH, WIF";

export const ENV_VARS = [
  { name: "VITE_BASE_RPC", default: BASE_RPC, purpose: "Solana L1 RPC" },
  { name: "VITE_ER_RPC", default: ER_RPC, purpose: "MagicBlock Ephemeral Rollup RPC" },
  { name: "VITE_PROGRAM_ID", default: PROGRAM_ID.toBase58(), purpose: "CrossBar program" },
  { name: "VITE_VALIDATOR", default: VALIDATOR.toBase58(), purpose: "ER validator pubkey" },
  { name: "VITE_MARKET_PUBKEY", default: "(empty)", purpose: "Existing market PDA" },
  { name: "VITE_KORA_RPC", default: "https://crossbar-kora-devnet-b94b9586c6b7.herokuapp.com", purpose: "Kora gasless relayer (Heroku)" },
  { name: "VITE_KORA_FEE_PAYER", default: "3dJTjgE…DSSHE", purpose: "Kora fee payer pubkey" },
  { name: "VITE_FLASH_MOCK", default: "0 (hosted)", purpose: "1 = offline sample Flash data in dashboard" },
  { name: "VITE_FLASH_API_URL", default: "https://flashapi.trade", purpose: "Flash read-only API" },
  {
    name: "COINGECKO_API_KEY",
    default: "(Vercel server env only)",
    purpose: "Optional CoinGecko demo key for fallback rate limits",
  },
];
