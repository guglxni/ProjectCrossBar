/**
 * FlashClient — a typed, dependency-light REST client for the Flash Trade
 * perpetuals API.
 *
 * Mirrors the `packages/flash-v2` "typed client, edit to add endpoints" pattern
 * from `flash-trade/examples-v2`: each endpoint is a small typed method; add new
 * ones by following the same shape.
 *
 * SOURCE OF TRUTH: `.agents/skills/flash-trade/` (ApiReference.md,
 * TransactionFlow.md, SKILL.md). Every endpoint, field, and enum below is taken
 * verbatim from those docs — nothing here is invented (CrossBar honesty
 * contract, CLAUDE.md).
 *
 * Dependencies: none beyond the Node global `fetch` (Node 18+). No npm deps are
 * added; this matches CrossBar's TS conventions (run scripts with `npx tsx`).
 *
 * Network reality: the public Flash API is **mainnet only** — Pyth Lazer prices
 * on devnet are stale/zero (SKILL.md "Critical Rules"). Read-only endpoints
 * (`/prices`, `/pool-data`, `/raw/markets`, `/positions/owner/{owner}`) require
 * no auth. Transaction-builder endpoints return an UNSIGNED VersionedTransaction
 * as `transactionBase64`; the caller signs and submits.
 */

// ---------------------------------------------------------------------------
// Response types — shapes from .agents/skills/flash-trade/ApiReference.md
// ---------------------------------------------------------------------------

/** One entry from `GET /prices` (keyed by token symbol). ApiReference "Prices". */
export interface FlashPrice {
  /** Raw integer price (multiply by 10^exponent for decimal). */
  price: number;
  /** Price exponent (typically -8). */
  exponent: number;
  /** Confidence interval (always 0 for Lazer feeds). */
  confidence: number;
  /** Human-readable price as float. */
  priceUi: number;
  /** Price timestamp in microseconds since epoch. */
  timestampUs: number;
  /** "regular" | "preMarket" | "postMarket" | "overNight" | "closed". */
  marketSession: string;
}

/** `GET /prices` returns a map of token symbol -> price. SOL and WSOL share a feed. */
export type FlashPricesResponse = Record<string, FlashPrice>;

/** Custody-level stats inside a pool snapshot. ApiReference "Custody Stats Fields". */
export interface FlashCustodyStats {
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

/** Pool-level LP stats. ApiReference "LP Stats Fields". */
export interface FlashLpStats {
  lpTokenSupply: string;
  totalPoolValueUsd: string;
  lpPrice: string;
  stableCoinPercentage: string;
  maxAumUsd: string;
}

/** One pool snapshot from `GET /pool-data`. */
export interface FlashPoolSnapshot {
  poolName: string;
  poolAddress: string;
  lpStats: FlashLpStats;
  custodyStats: FlashCustodyStats[];
}

/** `GET /pool-data` response. */
export interface FlashPoolDataResponse {
  pools: FlashPoolSnapshot[];
}

/** One element of `GET /raw/markets` (raw Anchor account JSON, opaque here). */
export interface FlashRawMarket {
  pubkey: string;
  /** Raw Anchor-deserialized market account; shape mirrors the on-chain IDL. */
  account: unknown;
}

/** Oracle price embedded in enriched position data. */
export interface FlashOraclePrice {
  price: string;
  exponent: string;
  confidence: string;
  timestamp: string;
}

/** PnL breakdown inside an enriched position. */
export interface FlashPositionPnl {
  profitUsd?: string;
  lossUsd?: string;
  exitFeeUsd?: string;
  borrowFeeUsd?: string;
  exitFeeAmount?: string;
  borrowFeeAmount?: string;
  priceImpactUsd?: string;
  priceImpactSet?: boolean;
}

/**
 * One enriched position from `GET /positions/owner/{owner}`
 * (`PositionTableDataUiDto`). All fields except `key`/`positionAccountData` are
 * optional (omitted when null). ApiReference "Enriched Positions".
 */
export interface FlashPosition {
  key: string;
  positionAccountData: string;
  sideUi?: string;
  marketSymbol?: string;
  collateralSymbol?: string;
  entryOraclePrice?: FlashOraclePrice;
  entryPriceUi?: string;
  sizeAmountUi?: string;
  sizeAmountUiKmb?: string;
  sizeUsdUi?: string;
  collateralAmountUi?: string;
  collateralAmountUiKmb?: string;
  collateralUsdUi?: string;
  isDegen?: boolean;
  pnl?: FlashPositionPnl;
  pnlWithFeeUsdUi?: string;
  pnlPercentageWithFee?: string;
  pnlWithoutFeeUsdUi?: string;
  pnlPercentageWithoutFee?: string;
  liquidationPriceUi?: string;
  leverageUi?: string;
}

/** Trade side / type. ApiReference "TradeType" enum (SCREAMING_SNAKE_CASE). */
export type FlashTradeType = "LONG" | "SHORT" | "SWAP";

/** Order type. ApiReference "OrderType" enum. */
export type FlashOrderType = "MARKET" | "LIMIT";

/** Privilege type. ApiReference "PrivilegeType" enum (SCREAMING_SNAKE_CASE). */
export type FlashPrivilegeType = "NONE" | "REFERRAL" | "STAKE";

/** Margin action. ApiReference "MarginAction" enum (SCREAMING_SNAKE_CASE). */
export type FlashMarginAction = "ADD" | "REMOVE";

/** Trade side used by preview / trigger-order endpoints. ApiReference. */
export type FlashSide = "LONG" | "SHORT";

// ---------------------------------------------------------------------------
// Health, Tokens, Pool-data status — small read shapes.
// ---------------------------------------------------------------------------

/** Account-count breakdown inside `GET /health`. ApiReference "Health". */
export interface FlashHealthAccounts {
  perpetuals: number;
  pools: number;
  custodies: number;
  markets: number;
  positions: number;
  orders: number;
}

/** `GET /health` response. ApiReference "Health". */
export interface FlashHealthResponse {
  /** Service status, e.g. "ok". */
  status: string;
  accounts: FlashHealthAccounts;
}

/** One supported token from `GET /tokens` (`TokenDto`). ApiReference "Tokens". */
export interface FlashToken {
  /** Token ticker symbol. */
  symbol: string;
  /** SPL token mint address (base58). */
  mintKey: string;
  /** Token native decimals. */
  decimals: number;
  /** Display precision for USD values. */
  usdPrecision: number;
  /** Display precision for token amounts. */
  tokenPrecision: number;
  /** Whether token is a stablecoin. */
  isStable: boolean;
  /** Whether token is a virtual (synthetic) asset. */
  isVirtual: boolean;
  /** Pyth Lazer feed ID. */
  lazerId: number;
  /** Pyth ticker string, e.g. "Crypto.SOL/USD". */
  pythTicker: string;
  /** Pyth price feed ID (hex). */
  pythPriceId: string;
  /** Whether token uses the SPL Token-2022 standard. */
  isToken2022: boolean;
}

/** `GET /pool-data/status/initialized` response. ApiReference "Pool Data". */
export interface FlashPoolDataInitialized {
  /** Whether pool data has been computed at least once after startup. */
  initialized: boolean;
}

// ---------------------------------------------------------------------------
// Enriched orders — shapes from ApiReference "Enriched Orders" / WebSocketStreaming.
// ---------------------------------------------------------------------------

/** One active limit order (`LimitOrderUiDto`). ApiReference / WebSocketStreaming. */
export interface FlashLimitOrder {
  /** Market account pubkey. */
  market: string;
  /** Index within the order account. */
  orderId: number;
  /** "Long" or "Short". */
  sideUi: string;
  /** Target market symbol. */
  symbol: string;
  /** Reserve token symbol. */
  reserveSymbol: string;
  reserveAmountUi: string;
  reserveAmountUsdUi: string;
  sizeAmountUi: string;
  sizeAmountUiKmb: string;
  sizeUsdUi: string;
  collateralAmountUi: string;
  collateralAmountUiKmb: string;
  collateralAmountUsdUi: string;
  /** Limit trigger price as an oracle-price object. */
  entryOraclePrice: FlashOraclePrice;
  entryPriceUi: string;
  leverageUi: string;
  liquidationPriceUi: string;
  /** Attached TP price ("-" if none). */
  limitTakeProfitPriceUi: string;
  /** Attached SL price ("-" if none). */
  limitStopLossPriceUi: string;
  receiveTokenSymbol: string;
  /** Token used as reserve (same as `reserveSymbol`). */
  reserveTokenSymbol: string;
}

/**
 * One TP / SL trigger order (`TakeProfitOrderUiDto` / `StopLossOrderUiDto` —
 * identical shape). ApiReference "Enriched Orders" / WebSocketStreaming.
 */
export interface FlashTriggerOrder {
  /** Market account pubkey. */
  market: string;
  /** Index within the order account. */
  orderId: number;
  /** "Long" or "Short". */
  sideUi: string;
  /** Target market symbol. */
  symbol: string;
  /** Token received when triggered. */
  receiveTokenSymbol: string;
  sizeAmountUi: string;
  sizeAmountUiKmb: string;
  sizeUsdUi: string;
  /** "TP" for take-profit, "SL" for stop-loss. */
  type: string;
  triggerPriceUi: string;
  /** Leverage (may be an empty string). */
  leverage: string;
}

/**
 * One enriched order account from `GET /orders/owner/{owner}`
 * (`OrderDataUiDto`). ApiReference "Enriched Orders".
 */
export interface FlashOrderData {
  /** Order account pubkey (base58). */
  key: string;
  /** Raw Anchor-encoded order account data (base64). */
  orderAccountData: string;
  /** Active limit orders. */
  limitOrders: FlashLimitOrder[];
  /** Active take-profit trigger orders. */
  takeProfitOrders: FlashTriggerOrder[];
  /** Active stop-loss trigger orders. */
  stopLossOrders: FlashTriggerOrder[];
}

// ---------------------------------------------------------------------------
// Raw accounts — `{ pubkey, account }` wrappers; the single `/{pubkey}`
// variants return the bare account JSON (opaque, mirrors the on-chain IDL).
// ---------------------------------------------------------------------------

/** One `{ pubkey, account }` entry from a `GET /raw/{collection}` list. */
export interface FlashRawAccount {
  pubkey: string;
  /** Raw Anchor-deserialized account; shape mirrors the on-chain IDL. */
  account: unknown;
}

// ---------------------------------------------------------------------------
// Preview request/response shapes — ApiReference "Previews".
// ---------------------------------------------------------------------------

/** Request for `POST /preview/limit-order-fees`. ApiReference "Limit Order Fees". */
export interface PreviewLimitOrderFeesParams {
  /** Market symbol, e.g. "SOL", "BTC". */
  marketSymbol: string;
  /** Input (collateral) amount in UI format. */
  inputAmountUi: string;
  /** Output (size) amount in UI format. */
  outputAmountUi: string;
  /** "LONG" or "SHORT". */
  side: FlashSide;
  /** Limit price in UI format (uses live price if omitted). */
  limitPrice?: string;
  /** Fee discount from staking (0-100). */
  tradingFeeDiscountPercent?: number;
}

/** Response for `POST /preview/limit-order-fees`. ApiReference. */
export interface PreviewLimitOrderFeesResponse {
  entryPriceUi: string;
  entryFeeUsdUi: string;
  liquidationPriceUi: string;
  /** Hourly borrow rate (decimal format). */
  borrowRateUi: string;
  err: string | null;
}

/** Request for `POST /preview/exit-fee`. ApiReference "Exit Fee". */
export interface PreviewExitFeeParams {
  /** Position account pubkey. */
  positionKey: string;
  /** USD amount to close. */
  closeAmountUsdUi: string;
}

/** Response for `POST /preview/exit-fee`. ApiReference. */
export interface PreviewExitFeeResponse {
  exitFeeUsdUi: string;
  /** Exit fee in token amount. */
  exitFeeAmountUi: string;
  /** Exit price after spread. */
  exitPriceUi: string;
  err: string | null;
}

/** TP/SL preview mode. ApiReference "TP/SL Preview". */
export type FlashTpSlMode = "forward" | "reverse_pnl" | "reverse_roi";

/**
 * Request for `POST /preview/tp-sl`. ApiReference "TP/SL Preview".
 * Works with existing positions (via `positionKey`) or hypothetical limit
 * orders (via inline `marketSymbol`/`entryPriceUi`/`sizeUsdUi`/... fields).
 * Which fields are required depends on `mode` (see ApiReference).
 */
export interface PreviewTpSlParams {
  /** "forward", "reverse_pnl", or "reverse_roi". */
  mode: FlashTpSlMode;
  /** Position pubkey (for existing positions). */
  positionKey?: string;
  /** Market symbol (for inline limit orders). */
  marketSymbol?: string;
  /** Entry price (for inline limit orders). */
  entryPriceUi?: string;
  /** Size in USD (for inline limit orders). */
  sizeUsdUi?: string;
  /** Collateral in USD (for inline limit orders). */
  collateralUsdUi?: string;
  /** "LONG" or "SHORT" (for inline limit orders). */
  side?: FlashSide;
  /** Trigger price (forward mode). */
  triggerPriceUi?: string;
  /** Target PnL in USD (reverse_pnl mode). */
  targetPnlUsdUi?: string;
  /** Target ROI percentage (reverse_roi mode). */
  targetRoiPercent?: number;
}

/** Response for `POST /preview/tp-sl`. ApiReference. */
export interface PreviewTpSlResponse {
  /** Estimated PnL in USD (forward mode). */
  pnlUsdUi?: string;
  /** PnL percentage (forward mode). */
  pnlPercentage?: string;
  /** Computed trigger price (reverse modes). */
  triggerPriceUi?: string;
  err: string | null;
}

/** Request for `POST /preview/margin`. ApiReference "Margin Preview". */
export interface PreviewMarginParams {
  /** Position account pubkey. */
  positionKey: string;
  /** Margin delta in USD. */
  marginDeltaUsdUi: string;
  /** "ADD" or "REMOVE". */
  action: FlashMarginAction;
}

/** Response for `POST /preview/margin`. ApiReference. */
export interface PreviewMarginResponse {
  newLeverageUi: string;
  newLiquidationPriceUi: string;
  /** Maximum addable/removable amount in USD. */
  maxAmountUsdUi: string;
  err: string | null;
}

// ---------------------------------------------------------------------------
// Transaction-builder request/response shapes — ApiReference.
// All builders return an unsigned base64 VersionedTransaction; the trading /
// collateral variants are preview-only when `owner` is omitted (then
// `transactionBase64` is null). Trigger-order builders require `owner`.
// ---------------------------------------------------------------------------

/** Request for `POST /transaction-builder/close-position`. ApiReference "Close Position". */
export interface ClosePositionParams {
  /** Position account pubkey to close. */
  positionKey: string;
  /** USD amount to close (full size = complete close, partial = partial close). */
  inputUsdUi: string;
  /** Token to receive, e.g. "USDC", "SOL". */
  withdrawTokenSymbol: string;
  /** Maintain current leverage during a partial close. */
  keepLeverageSame?: boolean;
  /** Slippage tolerance percentage (default "0.5"). */
  slippagePercentage?: string;
  /** Fee discount from staking (0-100). */
  tradingFeeDiscountPercent?: number;
  /** Token stake FAF account for fee discounts. */
  tokenStakeFafAccount?: string;
  /** Referral account for referral privilege. */
  userReferralAccount?: string;
  /** Enable funded wallet privilege. */
  enableFundedWallet?: boolean;
  /** "NONE", "STAKE", or "REFERRAL". */
  privilege?: FlashPrivilegeType;
  /** Wallet pubkey. Omit for preview-only mode (no tx built). */
  owner?: string;
}

/** Response for `POST /transaction-builder/close-position`. ApiReference. */
export interface ClosePositionResponse {
  receiveTokenSymbol: string;
  receiveTokenAmountUi: string;
  receiveTokenAmountUsdUi: string;
  /** Current mark/exit price. */
  markPrice: string;
  entryPrice: string;
  existingLiquidationPrice: string;
  /** Liquidation price after close ("0" for full close). */
  newLiquidationPrice: string;
  existingSize: string;
  newSize: string;
  existingCollateral: string;
  newCollateral: string;
  existingLeverage: string;
  newLeverage: string;
  /** Settled PnL in USD (negative prefixed with "-"). */
  settledPnl: string;
  /** Total fees (exit + borrow) in USD after discount. */
  fees: string;
  feesBeforeDiscount: string;
  /** Lock and unsettled fee (partial closes). */
  lockAndUnsettledFeeUsd?: string;
  /** Base64 unsigned VersionedTransaction (null when `owner` omitted). */
  transactionBase64: string | null;
  err: string | null;
}

/** Request for `POST /transaction-builder/reverse-position`. ApiReference "Reverse Position". */
export interface ReversePositionParams {
  /** Position account pubkey to reverse. */
  positionKey: string;
  /** Wallet pubkey (required — builds combined close+open transaction). */
  owner: string;
  /** Slippage tolerance (default "0.5"). */
  slippagePercentage?: string;
  /** Fee discount from staking (0-100). */
  tradingFeeDiscountPercent?: number;
  /** Token stake FAF account. */
  tokenStakeFafAccount?: string;
  /** Referral account. */
  userReferralAccount?: string;
  /** Enable funded wallet privilege. */
  enableFundedWallet?: boolean;
  /** "NONE", "STAKE", or "REFERRAL". */
  privilege?: FlashPrivilegeType;
  /** Enable degen mode for the new position. */
  degenMode?: boolean;
}

/** Response for `POST /transaction-builder/reverse-position`. ApiReference. */
export interface ReversePositionResponse {
  /** USD received from closing (after fees). */
  closeReceiveUsd: string;
  closeFees: string;
  /** Settled PnL from the close (negative = "-X.XX"). */
  closeSettledPnl: string;
  /** New position side: "Long" or "Short". */
  newSide: string;
  newLeverage: string;
  newEntryPrice: string;
  newLiquidationPrice: string;
  newSizeUsd: string;
  newSizeAmountUi: string;
  /** Collateral for new position (after 2% haircut). */
  newCollateralUsd: string;
  openEntryFee: string;
  /** Base64 unsigned VersionedTransaction (close + open combined). */
  transactionBase64: string | null;
  err: string | null;
}

/** Request for `POST /transaction-builder/add-collateral`. ApiReference "Add Collateral". */
export interface AddCollateralParams {
  /** Position account pubkey. */
  positionKey: string;
  /** Amount to deposit (UI format, in deposit token). */
  depositAmountUi: string;
  /** Deposit token symbol, e.g. "USDC", "SOL". */
  depositTokenSymbol: string;
  /** Wallet pubkey. Omit for preview-only mode (no tx built). */
  owner?: string;
  /** Slippage tolerance (default "0.5"). */
  slippagePercentage?: string;
}

/** Response for `POST /transaction-builder/add-collateral`. ApiReference. */
export interface AddCollateralResponse {
  existingCollateralUsd: string;
  newCollateralUsd: string;
  existingLeverage: string;
  newLeverage: string;
  existingLiquidationPrice: string;
  newLiquidationPrice: string;
  depositUsdValue: string;
  maxAddableUsd: string;
  /** Base64 unsigned VersionedTransaction (null when `owner` omitted). */
  transactionBase64: string | null;
  err: string | null;
}

/** Request for `POST /transaction-builder/remove-collateral`. ApiReference "Remove Collateral". */
export interface RemoveCollateralParams {
  /** Position account pubkey. */
  positionKey: string;
  /** USD amount to withdraw. */
  withdrawAmountUsdUi: string;
  /** Token to receive, e.g. "USDC", "SOL". */
  withdrawTokenSymbol: string;
  /** Wallet pubkey. Omit for preview-only mode (no tx built). */
  owner?: string;
  /** Slippage tolerance (default "0.5"). */
  slippagePercentage?: string;
}

/** Response for `POST /transaction-builder/remove-collateral`. ApiReference. */
export interface RemoveCollateralResponse {
  existingCollateralUsd: string;
  newCollateralUsd: string;
  existingLeverage: string;
  newLeverage: string;
  existingLiquidationPrice: string;
  newLiquidationPrice: string;
  receiveAmountUi: string;
  receiveAmountUsdUi: string;
  maxWithdrawableUsd: string;
  /** Base64 unsigned VersionedTransaction (null when `owner` omitted). */
  transactionBase64: string | null;
  err: string | null;
}

/**
 * Response shared by the trigger-order builders. ApiReference "Trigger Orders".
 * On success these return only `{ transactionBase64 }`; errors use the
 * `{ "err": "..." }` shape (surfaced as a thrown Error by {@link FlashClient}).
 */
export interface TriggerOrderResponse {
  /** Base64 unsigned VersionedTransaction. */
  transactionBase64: string;
}

/** Request for `POST /transaction-builder/place-trigger-order`. ApiReference "Place Trigger Order". */
export interface PlaceTriggerOrderParams {
  /** Market symbol, e.g. "SOL", "BTC". */
  marketSymbol: string;
  /** "LONG" or "SHORT". */
  side: FlashSide;
  /** Trigger price in UI format. */
  triggerPriceUi: string;
  /** Size to close in target token when the trigger fires. */
  sizeAmountUi: string;
  /** `true` for stop-loss, `false` for take-profit. */
  isStopLoss: boolean;
  /** Wallet pubkey (position owner). */
  owner: string;
}

/** Request for `POST /transaction-builder/edit-trigger-order`. ApiReference "Edit Trigger Order". */
export interface EditTriggerOrderParams {
  /** Market symbol. */
  marketSymbol: string;
  /** "LONG" or "SHORT". */
  side: FlashSide;
  /** Index of the trigger order to edit (0-4). */
  orderId: number;
  /** New trigger price in UI format. */
  triggerPriceUi: string;
  /** New size in target token. */
  sizeAmountUi: string;
  /** `true` for SL, `false` for TP. */
  isStopLoss: boolean;
  /** Wallet pubkey (must be original order owner). */
  owner: string;
}

/** Request for `POST /transaction-builder/cancel-trigger-order`. ApiReference "Cancel Trigger Order". */
export interface CancelTriggerOrderParams {
  /** Market symbol. */
  marketSymbol: string;
  /** "LONG" or "SHORT". */
  side: FlashSide;
  /** Index of the trigger order to cancel (0-4). */
  orderId: number;
  /** `true` for SL, `false` for TP. */
  isStopLoss: boolean;
  /** Wallet pubkey (must own the order). */
  owner: string;
}

/** Request for `POST /transaction-builder/cancel-all-trigger-orders`. ApiReference "Cancel All Trigger Orders". */
export interface CancelAllTriggerOrdersParams {
  /** Market symbol. */
  marketSymbol: string;
  /** "LONG" or "SHORT". */
  side: FlashSide;
  /** Wallet pubkey (must own the orders). */
  owner: string;
}

/**
 * Request body for `POST /transaction-builder/open-position`.
 * Only fields verified in ApiReference/TransactionFlow are included.
 * Omit `owner` for preview-only mode (then `transactionBase64` is null).
 */
export interface OpenPositionParams {
  /** Token symbol to pay with, e.g. "USDC", "SOL". */
  inputTokenSymbol: string;
  /** Target market token symbol, e.g. "SOL", "BTC", "ETH". */
  outputTokenSymbol: string;
  /** Input amount in human-readable UI format, e.g. "100.0". */
  inputAmountUi: string;
  /** Leverage multiplier, e.g. 5.0. */
  leverage: number;
  /** "LONG" | "SHORT" | "SWAP". */
  tradeType: FlashTradeType;
  /** Wallet pubkey. Omit for preview-only (no tx built). */
  owner?: string;
  /** "MARKET" (default) or "LIMIT". */
  orderType?: FlashOrderType;
  /** Trigger price for LIMIT orders (UI format). */
  limitPrice?: string;
  /** Slippage tolerance percentage, default "0.5". */
  slippagePercentage?: string;
  /** TP trigger price (UI format) — appends a TP trigger instruction. */
  takeProfit?: string;
  /** SL trigger price (UI format) — appends an SL trigger instruction. */
  stopLoss?: string;
  /** Enable degen mode (higher max leverage). */
  degenMode?: boolean;
}

/**
 * Response for `POST /transaction-builder/open-position`.
 * Field names match the backend exactly — note `youRecieveUsdUi` is an
 * intentional misspelling in the API and must NOT be "corrected" (ApiReference).
 */
export interface OpenPositionResponse {
  /** Existing position leverage (only when increasing a position). */
  oldLeverage?: string;
  newLeverage: string;
  oldEntryPrice?: string;
  newEntryPrice: string;
  oldLiquidationPrice?: string;
  newLiquidationPrice: string;
  entryFee: string;
  entryFeeBeforeDiscount?: string;
  openPositionFeePercent?: string;
  availableLiquidity?: string;
  youPayUsdUi: string;
  /** Position size received in USD. Misspelling is intentional (matches backend). */
  youRecieveUsdUi: string;
  marginFeePercentage?: string;
  outputAmount?: string;
  outputAmountUi: string;
  /** Base64 unsigned VersionedTransaction. null when `owner` omitted. */
  transactionBase64: string | null;
  takeProfitQuote?: unknown;
  stopLossQuote?: unknown;
  /** Error / warning message if computation failed. */
  err: string | null;
}

/** Options for constructing a {@link FlashClient}. */
export interface FlashClientOptions {
  /** Base URL override. Defaults to FLASH_API_URL env or https://flashapi.trade. */
  baseUrl?: string;
  /** Per-request timeout in ms. Default 15000. */
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = "https://flashapi.trade";

/**
 * Typed REST client for the Flash Trade perpetuals API.
 *
 * Usage:
 * ```ts
 * const flash = new FlashClient();              // https://flashapi.trade
 * const prices = await flash.getPrices();
 * const preview = await flash.previewOpenPosition({
 *   inputTokenSymbol: "USDC", outputTokenSymbol: "SOL",
 *   inputAmountUi: "100.0", leverage: 5, tradeType: "SHORT",
 * });
 * ```
 */
export class FlashClient {
  readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: FlashClientOptions = {}) {
    // Precedence: explicit option > FLASH_API_URL env > default.
    this.baseUrl = (opts.baseUrl ?? process.env.FLASH_API_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  // -------------------------------------------------------------------------
  // Internal HTTP helpers (Node global fetch; no node-fetch dependency).
  // -------------------------------------------------------------------------

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`Flash ${method} ${path} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
      }
      if (!res.ok) {
        // Error shape is { "error": "..." } or { "err": "..." } (ApiReference).
        const msg =
          (parsed as { error?: string; err?: string } | null)?.error ??
          (parsed as { error?: string; err?: string } | null)?.err ??
          `HTTP ${res.status}`;
        throw new Error(`Flash ${method} ${path} failed: ${msg}`);
      }
      return parsed as T;
    } finally {
      clearTimeout(timer);
    }
  }

  // -------------------------------------------------------------------------
  // Read-only, public, no-auth endpoints.
  // -------------------------------------------------------------------------

  /** `GET /health` — service status and cached account counts. */
  getHealth(): Promise<FlashHealthResponse> {
    return this.request<FlashHealthResponse>("GET", "/health");
  }

  /** `GET /tokens` — all supported tokens from pool config (deduped by mint). */
  getTokens(): Promise<FlashToken[]> {
    return this.request<FlashToken[]>("GET", "/tokens");
  }

  /** `GET /prices` — all current Pyth Lazer oracle prices keyed by symbol. */
  getPrices(): Promise<FlashPricesResponse> {
    return this.request<FlashPricesResponse>("GET", "/prices");
  }

  /**
   * `GET /prices/{symbol}` — price for a single token. Symbol lookup is
   * case-insensitive. Throws if the symbol is not found (HTTP 404).
   * @param symbol Token symbol, e.g. "SOL", "BTC", "ETH".
   */
  getPrice(symbol: string): Promise<FlashPrice> {
    return this.request<FlashPrice>("GET", `/prices/${encodeURIComponent(symbol)}`);
  }

  /** `GET /pool-data` — aggregated pool stats (TVL, utilization, custody ratios). */
  getPoolData(): Promise<FlashPoolDataResponse> {
    return this.request<FlashPoolDataResponse>("GET", "/pool-data");
  }

  /**
   * `GET /pool-data/{pool_pubkey}` — data for a single pool.
   * @param poolPubkey Pool public key (base58).
   */
  getPoolDataForPool(poolPubkey: string): Promise<FlashPoolSnapshot> {
    return this.request<FlashPoolSnapshot>("GET", `/pool-data/${poolPubkey}`);
  }

  /** `GET /pool-data/status/initialized` — whether pool data was computed yet. */
  getPoolDataInitialized(): Promise<FlashPoolDataInitialized> {
    return this.request<FlashPoolDataInitialized>("GET", "/pool-data/status/initialized");
  }

  /**
   * `GET /positions/owner/{owner}` — enriched positions (PnL, leverage, liq).
   * @param owner Owner wallet pubkey (base58).
   * @param includePnlInLeverageDisplay Factor PnL into displayed leverage (required query param).
   */
  getPositions(owner: string, includePnlInLeverageDisplay = false): Promise<FlashPosition[]> {
    const q = `?includePnlInLeverageDisplay=${includePnlInLeverageDisplay ? "true" : "false"}`;
    return this.request<FlashPosition[]>("GET", `/positions/owner/${owner}${q}`);
  }

  /**
   * `GET /orders/owner/{owner}` — enriched orders for an owner: limit orders,
   * take-profit, and stop-loss trigger orders.
   * @param owner Owner wallet pubkey (base58).
   */
  getOrders(owner: string): Promise<FlashOrderData[]> {
    return this.request<FlashOrderData[]>("GET", `/orders/owner/${owner}`);
  }

  // -------------------------------------------------------------------------
  // Raw account reads — list endpoints return `{ pubkey, account }[]`; the
  // single `/{pubkey}` variants return the bare account JSON (opaque).
  // -------------------------------------------------------------------------

  /** `GET /raw/perpetuals` — all perpetuals accounts. */
  getRawPerpetuals(): Promise<FlashRawAccount[]> {
    return this.request<FlashRawAccount[]>("GET", "/raw/perpetuals");
  }

  /** `GET /raw/perpetuals/{pubkey}` — a single perpetuals account (raw JSON). */
  getRawPerpetual(pubkey: string): Promise<unknown> {
    return this.request<unknown>("GET", `/raw/perpetuals/${pubkey}`);
  }

  /** `GET /raw/pools` — all pool accounts. */
  getRawPools(): Promise<FlashRawAccount[]> {
    return this.request<FlashRawAccount[]>("GET", "/raw/pools");
  }

  /** `GET /raw/pools/{pubkey}` — a single pool account (raw JSON). */
  getRawPool(pubkey: string): Promise<unknown> {
    return this.request<unknown>("GET", `/raw/pools/${pubkey}`);
  }

  /** `GET /raw/custodies` — all custody accounts. */
  getRawCustodies(): Promise<FlashRawAccount[]> {
    return this.request<FlashRawAccount[]>("GET", "/raw/custodies");
  }

  /** `GET /raw/custodies/{pubkey}` — a single custody account (raw JSON). */
  getRawCustody(pubkey: string): Promise<unknown> {
    return this.request<unknown>("GET", `/raw/custodies/${pubkey}`);
  }

  /** `GET /raw/markets` — all raw Anchor-deserialized market accounts. */
  getRawMarkets(): Promise<FlashRawAccount[]> {
    return this.request<FlashRawAccount[]>("GET", "/raw/markets");
  }

  /** `GET /raw/markets/{pubkey}` — a single market account (raw JSON). */
  getRawMarket(pubkey: string): Promise<unknown> {
    return this.request<unknown>("GET", `/raw/markets/${pubkey}`);
  }

  /** `GET /raw/positions/{pubkey}` — a single position account (raw JSON). */
  getRawPosition(pubkey: string): Promise<unknown> {
    return this.request<unknown>("GET", `/raw/positions/${pubkey}`);
  }

  /** `GET /raw/orders/{pubkey}` — a single order account (raw JSON). */
  getRawOrder(pubkey: string): Promise<unknown> {
    return this.request<unknown>("GET", `/raw/orders/${pubkey}`);
  }

  // -------------------------------------------------------------------------
  // Previews — fee / PnL / margin calculations, never build a transaction.
  // -------------------------------------------------------------------------

  /** `POST /preview/limit-order-fees` — entry price, fee, liq price, borrow rate. */
  previewLimitOrderFees(params: PreviewLimitOrderFeesParams): Promise<PreviewLimitOrderFeesResponse> {
    return this.request<PreviewLimitOrderFeesResponse>("POST", "/preview/limit-order-fees", params);
  }

  /** `POST /preview/exit-fee` — exit fee and exit price for closing a position. */
  previewExitFee(params: PreviewExitFeeParams): Promise<PreviewExitFeeResponse> {
    return this.request<PreviewExitFeeResponse>("POST", "/preview/exit-fee", params);
  }

  /**
   * `POST /preview/tp-sl` — TP/SL projections in `forward`, `reverse_pnl`, or
   * `reverse_roi` mode (set via `params.mode`).
   */
  previewTpSl(params: PreviewTpSlParams): Promise<PreviewTpSlResponse> {
    return this.request<PreviewTpSlResponse>("POST", "/preview/tp-sl", params);
  }

  /** `POST /preview/margin` — leverage / liq-price effect of adding/removing collateral. */
  previewMargin(params: PreviewMarginParams): Promise<PreviewMarginResponse> {
    return this.request<PreviewMarginResponse>("POST", "/preview/margin", params);
  }

  // -------------------------------------------------------------------------
  // Transaction builder — open position.
  // -------------------------------------------------------------------------

  /**
   * Preview an open-position trade WITHOUT building a transaction.
   * Forces preview-only mode by omitting `owner`; response `transactionBase64`
   * will be null (TransactionFlow "Preview-Only Mode").
   */
  previewOpenPosition(params: Omit<OpenPositionParams, "owner">): Promise<OpenPositionResponse> {
    const { ...rest } = params;
    return this.request<OpenPositionResponse>("POST", "/transaction-builder/open-position", rest);
  }

  /**
   * Build an open-position transaction. `owner` is required here; the response
   * includes preview fields plus `transactionBase64` (an UNSIGNED v0
   * VersionedTransaction). The caller must decode, sign, and submit promptly
   * (blockhash expires ~60s — TransactionFlow).
   */
  buildOpenPosition(params: OpenPositionParams & { owner: string }): Promise<OpenPositionResponse> {
    return this.request<OpenPositionResponse>("POST", "/transaction-builder/open-position", params);
  }

  // -------------------------------------------------------------------------
  // Transaction builder — close / reverse / collateral.
  // Trading & collateral builders accept preview-only mode by omitting `owner`
  // (then `transactionBase64` is null). Reverse requires `owner`.
  // -------------------------------------------------------------------------

  /**
   * `POST /transaction-builder/close-position` — close or partially close a
   * position. Omit `owner` for preview-only mode (`transactionBase64` null);
   * with `owner` the response includes an UNSIGNED VersionedTransaction.
   */
  buildClosePosition(params: ClosePositionParams): Promise<ClosePositionResponse> {
    return this.request<ClosePositionResponse>("POST", "/transaction-builder/close-position", params);
  }

  /**
   * `POST /transaction-builder/reverse-position` — reverse a position
   * (close + open combined). `owner` is required.
   */
  buildReversePosition(params: ReversePositionParams): Promise<ReversePositionResponse> {
    return this.request<ReversePositionResponse>("POST", "/transaction-builder/reverse-position", params);
  }

  /**
   * `POST /transaction-builder/add-collateral` — add collateral (lowers
   * leverage). Omit `owner` for preview-only mode (`transactionBase64` null).
   */
  buildAddCollateral(params: AddCollateralParams): Promise<AddCollateralResponse> {
    return this.request<AddCollateralResponse>("POST", "/transaction-builder/add-collateral", params);
  }

  /**
   * `POST /transaction-builder/remove-collateral` — remove collateral (raises
   * leverage). Omit `owner` for preview-only mode (`transactionBase64` null).
   */
  buildRemoveCollateral(params: RemoveCollateralParams): Promise<RemoveCollateralResponse> {
    return this.request<RemoveCollateralResponse>("POST", "/transaction-builder/remove-collateral", params);
  }

  // -------------------------------------------------------------------------
  // Transaction builder — trigger orders (TP / SL).
  // These require `owner` and return only `{ transactionBase64 }`; errors use
  // the `{ "err": "..." }` shape (thrown as an Error by `request`).
  // -------------------------------------------------------------------------

  /** `POST /transaction-builder/place-trigger-order` — place a TP or SL order. */
  buildPlaceTriggerOrder(params: PlaceTriggerOrderParams): Promise<TriggerOrderResponse> {
    return this.request<TriggerOrderResponse>("POST", "/transaction-builder/place-trigger-order", params);
  }

  /** `POST /transaction-builder/edit-trigger-order` — edit a trigger order's price/size. */
  buildEditTriggerOrder(params: EditTriggerOrderParams): Promise<TriggerOrderResponse> {
    return this.request<TriggerOrderResponse>("POST", "/transaction-builder/edit-trigger-order", params);
  }

  /** `POST /transaction-builder/cancel-trigger-order` — cancel a single trigger order. */
  buildCancelTriggerOrder(params: CancelTriggerOrderParams): Promise<TriggerOrderResponse> {
    return this.request<TriggerOrderResponse>("POST", "/transaction-builder/cancel-trigger-order", params);
  }

  /** `POST /transaction-builder/cancel-all-trigger-orders` — cancel all TP/SL for a market+side. */
  buildCancelAllTriggerOrders(params: CancelAllTriggerOrdersParams): Promise<TriggerOrderResponse> {
    return this.request<TriggerOrderResponse>("POST", "/transaction-builder/cancel-all-trigger-orders", params);
  }
}
