import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, STORAGE_KEYS } from "@/lib/constants";
import { deriveMarketPdas, marketPda } from "@/lib/pdas";

function readEnvOrStorage(envKey: string, storageKey: string): string {
  const fromEnv = (import.meta.env as Record<string, string | undefined>)[envKey];
  if (fromEnv?.trim()) return fromEnv.trim();
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(storageKey);
    if (stored?.trim()) return stored.trim();
  }
  return "";
}

function parsePubkey(value: string): PublicKey | null {
  if (!value) return null;
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

export interface MarketConfig {
  marketPubkey: PublicKey | null;
  baseMint: PublicKey | null;
  quoteMint: PublicKey | null;
  batchBook: PublicKey | null;
  batchResult: PublicKey | null;
  baseVault: PublicKey | null;
  quoteVault: PublicKey | null;
  oraclePrice: PublicKey | null;
  configured: boolean;
  setConfig: (market: string, baseMint: string, quoteMint: string) => void;
}

const MarketContext = createContext<MarketConfig | null>(null);

export function MarketProvider({ children }: { children: ReactNode }) {
  const [marketStr, setMarketStr] = useState(() =>
    readEnvOrStorage("VITE_MARKET_PUBKEY", STORAGE_KEYS.market),
  );
  const [baseMintStr, setBaseMintStr] = useState(() =>
    readEnvOrStorage("VITE_BASE_MINT", STORAGE_KEYS.baseMint),
  );
  const [quoteMintStr, setQuoteMintStr] = useState(() =>
    readEnvOrStorage("VITE_QUOTE_MINT", STORAGE_KEYS.quoteMint),
  );

  const setConfig = useCallback(
    (market: string, baseMint: string, quoteMint: string) => {
      setMarketStr(market.trim());
      setBaseMintStr(baseMint.trim());
      setQuoteMintStr(quoteMint.trim());
      localStorage.setItem(STORAGE_KEYS.market, market.trim());
      localStorage.setItem(STORAGE_KEYS.baseMint, baseMint.trim());
      localStorage.setItem(STORAGE_KEYS.quoteMint, quoteMint.trim());
    },
    [],
  );

  const value = useMemo((): MarketConfig => {
    const baseMint = parsePubkey(baseMintStr);
    const quoteMint = parsePubkey(quoteMintStr);
    let marketPubkey = parsePubkey(marketStr);

    if (!marketPubkey && baseMint && quoteMint) {
      marketPubkey = marketPda(PROGRAM_ID, baseMint, quoteMint);
    }

    const pdas =
      marketPubkey != null
        ? deriveMarketPdas(PROGRAM_ID, marketPubkey)
        : null;

    return {
      marketPubkey,
      baseMint,
      quoteMint,
      batchBook: pdas?.batchBook ?? null,
      batchResult: pdas?.batchResult ?? null,
      baseVault: pdas?.baseVault ?? null,
      quoteVault: pdas?.quoteVault ?? null,
      oraclePrice: pdas?.oraclePrice ?? null,
      configured: marketPubkey != null,
      setConfig,
    };
  }, [marketStr, baseMintStr, quoteMintStr, setConfig]);

  return (
    <MarketContext.Provider value={value}>{children}</MarketContext.Provider>
  );
}

export function useMarketContext(): MarketConfig {
  const ctx = useContext(MarketContext);
  if (!ctx) throw new Error("useMarketContext must be used within MarketProvider");
  return ctx;
}
