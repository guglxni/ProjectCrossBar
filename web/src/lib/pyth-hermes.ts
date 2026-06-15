/**
 * Pyth Hermes — batched live + 24h-ago prices for marquee 24h change.
 *
 * Same oracle family as Flash Trade (Pyth Lazer). CORS allows browser-direct
 * calls, so we avoid Vercel shared-egress rate limits. Two HTTP requests cover
 * all marquee symbols.
 */

const HERMES = "https://hermes.pyth.network";

/** Hex feed IDs for marquee symbols (Crypto.{SYMBOL}/USD). */
export const PYTH_FEED_IDS: Record<string, `0x${string}`> = {
  SOL: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  BNB: "0x2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f",
  HYPE: "0x4279e31cc369bbcc2faf022b382b080e32a8e689ff20fbc530d2a603eb6cd98b",
  JUP: "0x0a0408d619e9380abad35060f9192039ed5042fa6f82301d0e48bb52be830996",
  BONK: "0x72b021217ca3fe68922a19aaf990109cb9d84e9ad004b4d2025ad6f529314419",
  JTO: "0xb43660a5f790c69354b0729a5ef9d50d68f1df92107540210b9cccba1f947cc2",
  PYTH: "0x0bbf28e9a841a1cc788f6a361b17ca072d0ea3098a1e5df1c3922d06719579ff",
  WIF: "0x4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc",
};

const ID_TO_SYMBOL = Object.fromEntries(
  Object.entries(PYTH_FEED_IDS).map(([sym, id]) => [id.slice(2).toLowerCase(), sym]),
) as Record<string, string>;

interface HermesPrice {
  price: string;
  expo: number;
}

interface HermesParsed {
  id: string;
  price: HermesPrice;
}

interface HermesResponse {
  parsed?: HermesParsed[];
}

const CACHE_TTL_MS = 300_000;
let cachedChanges: { at: number; data: Record<string, number> } | null = null;

function parseUsd(row: HermesPrice): number {
  return Number(row.price) * 10 ** row.expo;
}

function symbolForFeedId(id: string): string | undefined {
  const key = id.replace(/^0x/i, "").toLowerCase();
  return ID_TO_SYMBOL[key];
}

async function hermesBatch(
  path: string,
  feedIds: `0x${string}`[],
  signal?: AbortSignal,
): Promise<Map<string, number>> {
  const params = new URLSearchParams();
  for (const id of feedIds) params.append("ids[]", id);
  params.set("parsed", "true");

  const res = await fetch(`${HERMES}${path}?${params}`, {
    signal,
    headers: { accept: "application/json" },
  });
  if (res.status === 429) throw new Error("Hermes 429");
  if (!res.ok) throw new Error(`Hermes ${res.status}`);

  const data = (await res.json()) as HermesResponse;
  const out = new Map<string, number>();
  for (const row of data.parsed ?? []) {
    const sym = symbolForFeedId(row.id);
    if (sym) out.set(sym, parseUsd(row.price));
  }
  return out;
}

/** 24h % change keyed by symbol — two batched Hermes calls. */
export async function getHermesTickerChanges(
  symbols: string[],
  signal?: AbortSignal,
): Promise<Record<string, number>> {
  if (cachedChanges && Date.now() - cachedChanges.at < CACHE_TTL_MS) {
    return cachedChanges.data;
  }

  const feedIds = symbols
    .map((s) => PYTH_FEED_IDS[s])
    .filter((id): id is `0x${string}` => id != null);
  if (feedIds.length === 0) return {};

  const ts24h = Math.floor(Date.now() / 1000) - 86_400;
  const [latest, prior] = await Promise.all([
    hermesBatch("/v2/updates/price/latest", feedIds, signal),
    hermesBatch(`/v2/updates/price/${ts24h}`, feedIds, signal),
  ]);

  const out: Record<string, number> = {};
  for (const sym of symbols) {
    const now = latest.get(sym);
    const then = prior.get(sym);
    if (now == null || then == null || then === 0) continue;
    out[sym] = ((now - then) / then) * 100;
  }

  if (Object.keys(out).length > 0) {
    cachedChanges = { at: Date.now(), data: out };
  }
  return out;
}
