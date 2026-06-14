/**
 * FlashStream — a typed WebSocket streaming client for the Flash Trade
 * Builder API's per-owner positions/orders feed.
 *
 * SOURCE OF TRUTH: `.agents/skills/flash-trade/WebSocketStreaming.md` (and the
 * "WebSocket Streaming" section of ApiReference.md). Every URL, query param,
 * message shape, keepalive rule, and reconnection constant below is taken
 * verbatim from those docs — nothing here is invented (CrossBar honesty
 * contract, CLAUDE.md).
 *
 * Transport: prefers the Node global `WebSocket` (available on Node 21+, and on
 * Node 26 in this repo) so there is NO npm dependency. If no global `WebSocket`
 * exists, it falls back to the `ws` package if installed, otherwise throws a
 * clear runtime error telling the user to `npm i ws`.
 *
 * Read-only and public: the feed streams a wallet's enriched positions and
 * orders. No wallet, signing, or funds are involved.
 *
 * Endpoint (WebSocketStreaming.md §1):
 *   wss://flashapi.trade/owner/{owner}/ws?includePnlInLeverageDisplay=true&updateIntervalMs=1000
 *
 * The server handles WebSocket Ping/Pong keepalive (Ping every 30s, Pong
 * timeout 10s) — standard clients respond to Ping automatically, so this client
 * sends NO manual pings (WebSocketStreaming.md §3 "Server Keepalive").
 */

import type { FlashPosition, FlashOrderData } from "./client.js";

// Re-export the snapshot element types so consumers of the stream don't have to
// import from two files. These are the exact shapes the WS feed carries:
// positions = PositionTableDataUiDto[], orders = OrderDataUiDto[]
// (WebSocketStreaming.md §1 "Message Types": both are FULL SNAPSHOTS).
export type { FlashPosition, FlashOrderData } from "./client.js";

// ---------------------------------------------------------------------------
// Message envelope types — WebSocketStreaming.md §1 "Message Format".
// ---------------------------------------------------------------------------

/** A full positions snapshot pushed at the `updateIntervalMs` interval. */
export interface PositionsMessage {
  type: "positions";
  /** Complete array of all current positions for the owner (full snapshot). */
  data: FlashPosition[];
}

/** A full orders snapshot pushed only on an on-chain order event. */
export interface OrdersMessage {
  type: "orders";
  /** Complete array of all current order accounts for the owner (full snapshot). */
  data: FlashOrderData[];
}

/** Any message the server may send over the owner feed. */
export type FlashStreamMessage = PositionsMessage | OrdersMessage;

// ---------------------------------------------------------------------------
// Minimal structural WebSocket type — satisfied by both the Node global
// `WebSocket` and the `ws` package, so we depend on neither's typings.
// ---------------------------------------------------------------------------

interface MinimalWebSocket {
  readyState: number;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (ev: { data: unknown }) => void): void;
  addEventListener(type: "close", listener: (ev: { code?: number }) => void): void;
  addEventListener(type: "error", listener: (ev: unknown) => void): void;
}

interface WebSocketCtor {
  new (url: string): MinimalWebSocket;
  readonly OPEN: number;
}

/**
 * Resolve a WebSocket constructor. Prefers the Node global `WebSocket`
 * (no dependency); falls back to the optional `ws` package; otherwise throws
 * with installation guidance.
 */
function resolveWebSocketCtor(): WebSocketCtor {
  const g = globalThis as { WebSocket?: unknown };
  if (typeof g.WebSocket === "function") {
    return g.WebSocket as unknown as WebSocketCtor;
  }
  try {
    // Optional dependency — only required when no global WebSocket exists.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const req = (0, eval)("require") as NodeRequire;
    const ws = req("ws") as { WebSocket?: unknown } & unknown;
    const ctor = (ws as { WebSocket?: unknown }).WebSocket ?? ws;
    if (typeof ctor === "function") {
      return ctor as unknown as WebSocketCtor;
    }
  } catch {
    // fall through to the error below
  }
  throw new Error(
    "No WebSocket implementation available. Use Node 21+ (global WebSocket) " +
      "or install the `ws` package: npm i ws",
  );
}

// ---------------------------------------------------------------------------
// Configuration.
// ---------------------------------------------------------------------------

/** Options for constructing a {@link FlashStream}. */
export interface FlashStreamOptions {
  /**
   * Base API URL (http(s) scheme). Defaults to FLASH_API_URL env or
   * https://flashapi.trade. The scheme is rewritten to ws(s):// internally
   * (WebSocketStreaming.md §1 "URL construction").
   */
  baseUrl?: string;
  /**
   * Include PnL in the leverage display calculation (required query param;
   * the doc's canonical URL uses `true`). Default true.
   */
  includePnlInLeverageDisplay?: boolean;
  /**
   * How often the server recomputes position data, in ms. Server clamps to
   * [100, 10000]; default 1000 (WebSocketStreaming.md §1 "Query Parameters").
   */
  updateIntervalMs?: number;
  /**
   * Max reconnect attempts before giving up. WebSocketStreaming.md §4 "Tier 1"
   * uses 3. Set to 0 to disable reconnection.
   */
  maxReconnects?: number;
  /** Base backoff delay in ms (delay = baseDelayMs * 2^attempt). Default 1000. */
  baseDelayMs?: number;
  /**
   * Connection timeout in ms — if the socket does not reach OPEN within this
   * window it is closed and treated as a failed attempt. Default 3000
   * (WebSocketStreaming.md §4 "Tier 1": 3000ms).
   */
  connectTimeoutMs?: number;
}

const DEFAULT_BASE_URL = "https://flashapi.trade";

type PositionsCallback = (positions: FlashPosition[], message: PositionsMessage) => void;
type OrdersCallback = (orders: FlashOrderData[], message: OrdersMessage) => void;

/**
 * Typed WebSocket client for the Flash Trade per-owner positions/orders feed.
 *
 * Usage:
 * ```ts
 * const stream = new FlashStream("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
 * stream.onPositions((positions) => console.log(positions.length, "positions"));
 * stream.onOrders((orders) => console.log(orders.length, "order accounts"));
 * stream.connect();
 * // ... later
 * stream.close();
 * ```
 *
 * Snapshot semantics: every `positions`/`orders` message is a FULL snapshot —
 * replace local state entirely on each callback; do not merge or diff
 * (WebSocketStreaming.md §6 "Understand the Data Model").
 */
export class FlashStream {
  readonly owner: string;
  readonly url: string;

  private readonly WS: WebSocketCtor;
  private readonly maxReconnects: number;
  private readonly baseDelayMs: number;
  private readonly connectTimeoutMs: number;

  private ws: MinimalWebSocket | null = null;
  private reconnectAttempts = 0;
  private closedByUser = false;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private positionsCb: PositionsCallback | null = null;
  private ordersCb: OrdersCallback | null = null;
  private errorCb: ((err: unknown) => void) | null = null;

  /**
   * @param owner Owner wallet pubkey (base58) whose positions/orders to stream.
   * @param opts  Connection and reconnection options.
   */
  constructor(owner: string, opts: FlashStreamOptions = {}) {
    if (!owner) throw new Error("FlashStream requires an owner pubkey");
    this.owner = owner;

    const baseUrl = (opts.baseUrl ?? process.env.FLASH_API_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    // URL construction: swap http(s):// -> ws(s):// then append the path
    // (WebSocketStreaming.md §1).
    const wsBase = baseUrl.replace(/^http/, "ws");
    const includePnl = opts.includePnlInLeverageDisplay ?? true;
    const intervalMs = opts.updateIntervalMs ?? 1000;
    this.url =
      `${wsBase}/owner/${owner}/ws` +
      `?includePnlInLeverageDisplay=${includePnl ? "true" : "false"}` +
      `&updateIntervalMs=${intervalMs}`;

    this.maxReconnects = opts.maxReconnects ?? 3;
    this.baseDelayMs = opts.baseDelayMs ?? 1000;
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 3000;
    this.WS = resolveWebSocketCtor();
  }

  /** Register a callback for `positions` snapshots (full array each time). */
  onPositions(cb: PositionsCallback): this {
    this.positionsCb = cb;
    return this;
  }

  /** Register a callback for `orders` snapshots (full array each time). */
  onOrders(cb: OrdersCallback): this {
    this.ordersCb = cb;
    return this;
  }

  /** Register a callback for transport/parse errors. */
  onError(cb: (err: unknown) => void): this {
    this.errorCb = cb;
    return this;
  }

  /** Open the WebSocket connection (idempotent while already open/connecting). */
  connect(): void {
    this.closedByUser = false;
    this.openSocket();
  }

  private openSocket(): void {
    const ws = new this.WS(this.url);
    this.ws = ws;

    // Connection timeout — close if not OPEN within connectTimeoutMs
    // (WebSocketStreaming.md §4 "Tier 1": 3000ms).
    this.clearConnectTimer();
    this.connectTimer = setTimeout(() => {
      if (ws.readyState !== this.WS.OPEN) {
        ws.close();
      }
    }, this.connectTimeoutMs);

    ws.addEventListener("open", () => {
      this.clearConnectTimer();
      this.reconnectAttempts = 0;
    });

    ws.addEventListener("message", (ev: { data: unknown }) => {
      this.handleMessage(ev.data);
    });

    ws.addEventListener("close", () => {
      this.clearConnectTimer();
      this.ws = null;
      this.scheduleReconnect();
    });

    ws.addEventListener("error", (err: unknown) => {
      // `close` fires after `error`; reconnection is handled there. Suppress the
      // spurious error event that fires when we close intentionally.
      if (this.closedByUser) return;
      if (this.errorCb) this.errorCb(err);
    });
  }

  private handleMessage(data: unknown): void {
    let raw: string;
    if (typeof data === "string") {
      raw = data;
    } else if (data instanceof Uint8Array) {
      raw = Buffer.from(data).toString("utf8");
    } else if (Buffer.isBuffer(data)) {
      raw = data.toString("utf8");
    } else {
      raw = String(data);
    }

    let msg: FlashStreamMessage;
    try {
      msg = JSON.parse(raw) as FlashStreamMessage;
    } catch (err) {
      if (this.errorCb) this.errorCb(err);
      return;
    }

    if (msg.type === "positions") {
      if (this.positionsCb) this.positionsCb(msg.data, msg);
    } else if (msg.type === "orders") {
      if (this.ordersCb) this.ordersCb(msg.data, msg);
    }
    // Unknown types are ignored (forward-compatible).
  }

  private scheduleReconnect(): void {
    if (this.closedByUser) return;
    if (this.reconnectAttempts >= this.maxReconnects) {
      if (this.errorCb) {
        this.errorCb(new Error(`max reconnects (${this.maxReconnects}) reached`));
      }
      return;
    }
    // Exponential backoff: baseDelayMs * 2^attempt
    // (WebSocketStreaming.md §4 "Tier 1": 1000/2000/4000ms).
    const delay = this.baseDelayMs * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
  }

  private clearConnectTimer(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  /** Close the connection intentionally and stop all reconnection attempts. */
  close(): void {
    this.closedByUser = true;
    this.clearConnectTimer();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Demo entry point — `npx tsx clients/flash/stream.ts`.
// Streams a public mainnet owner for ~10s and prints each snapshot.
// ---------------------------------------------------------------------------

// Sample owner pubkey documented in WebSocketStreaming.md §1/§5 examples.
const SAMPLE_OWNER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

async function main(): Promise<void> {
  const owner = process.env.FLASH_OWNER ?? SAMPLE_OWNER;
  const stream = new FlashStream(owner, { updateIntervalMs: 1000 });

  console.log(`Connecting to Flash Trade owner feed for ${owner} ...`);
  console.log(`URL: ${stream.url}`);

  stream
    .onPositions((positions) => {
      console.log(`[positions] snapshot: ${positions.length} position(s)`);
      for (const p of positions) {
        console.log(
          `  ${p.sideUi ?? "?"} ${p.marketSymbol ?? "?"}: ` +
            `size=${p.sizeUsdUi ?? "-"} USD, pnl=${p.pnlWithFeeUsdUi ?? "-"} USD, ` +
            `lev=${p.leverageUi ?? "-"}x, liq=${p.liquidationPriceUi ?? "-"}`,
        );
      }
    })
    .onOrders((orders) => {
      console.log(`[orders] snapshot: ${orders.length} order account(s)`);
      for (const oa of orders) {
        console.log(
          `  ${oa.key}: ${oa.limitOrders.length} limit, ` +
            `${oa.takeProfitOrders.length} TP, ${oa.stopLossOrders.length} SL`,
        );
      }
    })
    .onError((err) => {
      console.error("[error]", err instanceof Error ? err.message : err);
    });

  stream.connect();

  // Stream for ~10s, then close cleanly.
  await new Promise<void>((resolve) => setTimeout(resolve, 10_000));
  stream.close();
  console.log("Closed stream after ~10s.");
}

// Run only when executed directly (not when imported).
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
