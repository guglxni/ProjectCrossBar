import { useCallback, useEffect, useRef, useState } from "react";
import type { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { BATCH_CLEARED } from "@/lib/constants";
import { deriveMarketPdas, ooPda } from "@/lib/pdas";

export interface PriceHistoryPoint {
  window: number;
  clearingPrice: number;
  matchedVolume: number;
  status: number;
}

export interface MarketPollState {
  market: Record<string, unknown> | null;
  batchBook: Record<string, unknown> | null;
  batchResult: Record<string, unknown> | null;
  openOrders: Record<string, unknown> | null;
  oracle: Record<string, unknown> | null;
  priceHistory: PriceHistoryPoint[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

function pickConnection(
  market: Record<string, unknown> | null,
  baseProgram: Program,
  erProgram: Program,
): Program {
  const status = market?.status;
  const key =
    status && typeof status === "object"
      ? Object.keys(status as object)[0]
      : "";
  return key === "delegated" ? erProgram : baseProgram;
}

export function useMarketPolling(
  marketPubkey: PublicKey | null,
  programId: PublicKey,
  baseProgram: Program,
  erProgram: Program,
  owner: PublicKey | null,
  enabled = true,
): MarketPollState {
  const [market, setMarket] = useState<Record<string, unknown> | null>(null);
  const [batchBook, setBatchBook] = useState<Record<string, unknown> | null>(
    null,
  );
  const [batchResult, setBatchResult] = useState<Record<string, unknown> | null>(
    null,
  );
  const [openOrders, setOpenOrders] = useState<Record<string, unknown> | null>(
    null,
  );
  const [oracle, setOracle] = useState<Record<string, unknown> | null>(null);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastWindowRef = useRef<number | null>(null);

  const fetchAll = useCallback(async () => {
    if (!marketPubkey || !enabled) return;
    setLoading(true);
    setError(null);
    try {
      const pdas = deriveMarketPdas(programId, marketPubkey);
      let marketData: Record<string, unknown> | null = null;
      try {
        marketData = (await (
          baseProgram.account as Record<string, { fetch: (k: PublicKey) => Promise<unknown> }>
        ).market.fetch(marketPubkey)) as Record<string, unknown>;
        setMarket(marketData);
      } catch {
        setMarket(null);
        setBatchBook(null);
        setBatchResult(null);
        setOpenOrders(null);
        setOracle(null);
        setError("Market account not found on devnet. Configure a valid market pubkey.");
        return;
      }

      const program = pickConnection(marketData, baseProgram, erProgram);
      const accounts = program.account as Record<
        string,
        { fetch: (k: PublicKey) => Promise<unknown> }
      >;

      const [book, result, oracleData] = await Promise.all([
        accounts.batchBook.fetch(pdas.batchBook).catch(() => null),
        accounts.batchResult.fetch(pdas.batchResult).catch(() => null),
        accounts.oraclePrice.fetch(pdas.oraclePrice).catch(() => null),
      ]);

      setBatchBook(book as Record<string, unknown> | null);
      setBatchResult(result as Record<string, unknown> | null);
      setOracle(oracleData as Record<string, unknown> | null);

      if (owner) {
        const ooKey = ooPda(programId, marketPubkey, owner);
        const oo = await accounts.openOrders.fetch(ooKey).catch(() => null);
        setOpenOrders(oo as Record<string, unknown> | null);
      } else {
        setOpenOrders(null);
      }

      if (result) {
        const r = result as {
          window: { toNumber?: () => number } | number;
          status: number;
          clearingPrice: { toNumber?: () => number } | number;
          matchedVolume: { toNumber?: () => number } | number;
        };
        const window =
          typeof r.window === "number"
            ? r.window
            : (r.window?.toNumber?.() ?? Number(r.window));
        const clearingPrice =
          typeof r.clearingPrice === "number"
            ? r.clearingPrice
            : (r.clearingPrice?.toNumber?.() ?? Number(r.clearingPrice));
        const matchedVolume =
          typeof r.matchedVolume === "number"
            ? r.matchedVolume
            : (r.matchedVolume?.toNumber?.() ?? Number(r.matchedVolume));

        if (
          r.status === BATCH_CLEARED &&
          clearingPrice > 0 &&
          lastWindowRef.current !== window
        ) {
          lastWindowRef.current = window;
          setPriceHistory((prev) => {
            const next = [
              ...prev,
              { window, clearingPrice, matchedVolume, status: r.status },
            ];
            return next.slice(-32);
          });
        }
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [
    marketPubkey,
    programId,
    baseProgram,
    erProgram,
    owner,
    enabled,
  ]);

  useEffect(() => {
    if (!enabled || !marketPubkey) return;
    void fetchAll();
    const id = window.setInterval(() => void fetchAll(), 2000);
    return () => window.clearInterval(id);
  }, [fetchAll, enabled, marketPubkey]);

  return {
    market,
    batchBook,
    batchResult,
    openOrders,
    oracle,
    priceHistory,
    loading,
    error,
    refresh: fetchAll,
  };
}
