import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { KORA_RPC, KORA_FEE_PAYER } from "@/lib/constants";

interface JsonRpcResponse<T> {
  result?: T;
  error?: { message: string };
}

async function koraPost<T>(path: string, body: unknown): Promise<JsonRpcResponse<T>> {
  if (!KORA_RPC) throw new Error("KORA_RPC not configured");
  const payload = JSON.stringify(body);
  const res = await fetch(`${KORA_RPC}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(new TextEncoder().encode(payload).length),
    },
    body: payload,
  });
  return res.json() as Promise<JsonRpcResponse<T>>;
}

export function useKoraRelay() {
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(!!KORA_RPC);
  // Kora's fee payer pubkey — sourced from VITE_KORA_FEE_PAYER env var or
  // queried from the running relayer via getConfig on first load.
  const [feePayer, setFeePayer] = useState<PublicKey | null>(
    KORA_FEE_PAYER
      ? (() => { try { return new PublicKey(KORA_FEE_PAYER); } catch { return null; } })()
      : null,
  );

  useEffect(() => {
    if (!KORA_RPC) {
      setAvailable(false);
      setChecking(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        // Kora JSON-RPC is at POST /rpc. Use getConfig as health check and
        // to fetch the fee payer pubkey in one round-trip.
        const cfg = await koraPost<{ fee_payers?: string[] }>("/rpc", {
          jsonrpc: "2.0",
          id: 1,
          method: "getConfig",
        });
        if (!cancelled) setAvailable(!!cfg.result);

        if (!KORA_FEE_PAYER) {
          const fp = cfg.result?.fee_payers?.[0];
          if (!cancelled && fp) {
            try { setFeePayer(new PublicKey(fp)); } catch { /* ignore */ }
          }
        }
      } catch {
        if (!cancelled) setAvailable(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const signAndSendTransaction = useCallback(
    async (transactionBase64: string): Promise<string> => {
      const json = await koraPost<string>("/rpc", {
        jsonrpc: "2.0",
        id: 1,
        method: "signAndSendTransaction",
        params: [{ transaction: transactionBase64 }],
      });
      if (json.error) throw new Error(json.error.message);
      if (!json.result) throw new Error("Kora returned no signature");
      return json.result;
    },
    [],
  );

  return {
    rpcUrl: KORA_RPC,
    available,
    checking,
    feePayer,
    signAndSendTransaction,
  };
}
