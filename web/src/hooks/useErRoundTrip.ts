import { useCallback, useState } from "react";
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { useMarketContext } from "@/context/MarketContext";
import { useCrossbarProgram } from "@/hooks/useCrossbarProgram";
import { SIDE_BUY, SIDE_SELL, FLOW_MAKER, FLOW_TAKER, VALIDATOR } from "@/lib/constants";
import { parseProgramError } from "@/lib/errors";
import { humanToPrice, ooPda, pda } from "@/lib/pdas";

export type StepStatus = "pending" | "running" | "done" | "error" | "skipped";

export interface RoundTripStep {
  id: string;
  label: string;
  plane: "L1" | "ER";
  status: StepStatus;
  sig?: string;
  detail?: string;
}

export interface RoundTripOptions {
  includeDeposits: boolean;
  depositBase: string;
  depositQuote: string;
  buyPrice: string;
  sellPrice: string;
  qty: string;
}

export const DEFAULT_ROUND_TRIP: RoundTripOptions = {
  includeDeposits: true,
  depositBase: "1000000",
  depositQuote: "1000000",
  buyPrice: "101",
  sellPrice: "99",
  qty: "100",
};

interface PlanItem {
  id: string;
  label: string;
  plane: "L1" | "ER";
  exec: (ctx: { setDetail: (d: string) => void }) => Promise<string | undefined>;
}

export function useErRoundTrip(onComplete?: () => void) {
  const ctx = useMarketContext();
  const {
    baseProgram,
    erProgram,
    baseConnection,
    publicKey,
    connected,
  } = useCrossbarProgram();

  const [steps, setSteps] = useState<RoundTripStep[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = useCallback(() => {
    setSteps([]);
    setError(null);
    setDone(false);
  }, []);

  const run = useCallback(
    async (opts: RoundTripOptions) => {
      if (!connected || !publicKey || !ctx.marketPubkey) {
        setError("Connect a wallet and configure a market first.");
        return;
      }
      const marketPk = ctx.marketPubkey;
      const owner = publicKey;
      const PROG = baseProgram.programId;
      const ERPROG = erProgram.programId;

      const valMeta = [{ pubkey: VALIDATOR, isSigner: false, isWritable: false }];
      const cuMax = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({
        units: 1_400_000,
      });

      const plan: PlanItem[] = [];

      // 0. Deposits (one L1 tx with base + quote) — optional.
      if (opts.includeDeposits) {
        plan.push({
          id: "deposit",
          label: "Fund balances (deposit base + quote)",
          plane: "L1",
          exec: async () => {
            if (!ctx.baseMint || !ctx.quoteMint || !ctx.baseVault || !ctx.quoteVault) {
              throw new Error("Market mints/vaults not configured.");
            }
            const baseAta = getAssociatedTokenAddressSync(ctx.baseMint, owner);
            const quoteAta = getAssociatedTokenAddressSync(ctx.quoteMint, owner);
            const oo = ooPda(PROG, marketPk, owner);
            const quoteIx = await baseProgram.methods
              .deposit(new BN(opts.depositQuote), false)
              .accountsPartial({
                market: marketPk,
                vault: ctx.quoteVault,
                userTokenAccount: quoteAta,
                openOrders: oo,
                owner,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
              })
              .instruction();
            return baseProgram.methods
              .deposit(new BN(opts.depositBase), true)
              .accountsPartial({
                market: marketPk,
                vault: ctx.baseVault,
                userTokenAccount: baseAta,
                openOrders: oo,
                owner,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
              })
              .postInstructions([quoteIx])
              .rpc();
          },
        });
      }

      // 1. Set delegated (L1).
      plan.push({
        id: "set-delegated",
        label: "Arm market for delegation",
        plane: "L1",
        exec: async () =>
          baseProgram.methods
            .setDelegated()
            .accountsPartial({ market: marketPk, authority: owner })
            .rpc(),
      });

      // 2. Delegate market PDAs to the ER (L1).
      plan.push({
        id: "delegate-market",
        label: "Delegate market to MagicBlock ER",
        plane: "L1",
        exec: async () =>
          baseProgram.methods
            .delegateMarket()
            .accountsPartial({
              payer: owner,
              authority: owner,
              baseMint: ctx.baseMint!,
              quoteMint: ctx.quoteMint!,
              market: marketPk,
              book: pda(PROG, "book", marketPk),
              result: pda(PROG, "result", marketPk),
              oracle: pda(PROG, "oracle", marketPk),
            })
            .remainingAccounts(valMeta)
            .preInstructions([cuMax])
            .rpc(),
      });

      // 3. Delegate the trader's OpenOrders (L1).
      plan.push({
        id: "delegate-oo",
        label: "Delegate your open orders",
        plane: "L1",
        exec: async () =>
          baseProgram.methods
            .delegateOpenOrders(owner)
            .accountsPartial({
              payer: owner,
              authority: owner,
              market: marketPk,
              openOrders: ooPda(PROG, marketPk, owner),
            })
            .remainingAccounts(valMeta)
            .preInstructions([cuMax])
            .rpc(),
      });

      // 4. Submit a crossing buy + sell into the same window (one ER tx).
      plan.push({
        id: "submit",
        label: "Submit crossing buy + sell into the window",
        plane: "ER",
        exec: async () => {
          const sellIx = await erProgram.methods
            .submitOrder(
              SIDE_SELL,
              humanToPrice(Number(opts.sellPrice)),
              new BN(opts.qty),
              FLOW_MAKER,
            )
            .accountsPartial({
              market: marketPk,
              batchBook: pda(ERPROG, "book", marketPk),
              openOrders: ooPda(ERPROG, marketPk, owner),
              owner,
            })
            .instruction();
          return erProgram.methods
            .submitOrder(
              SIDE_BUY,
              humanToPrice(Number(opts.buyPrice)),
              new BN(opts.qty),
              FLOW_TAKER,
            )
            .accountsPartial({
              market: marketPk,
              batchBook: pda(ERPROG, "book", marketPk),
              openOrders: ooPda(ERPROG, marketPk, owner),
              owner,
            })
            .postInstructions([sellIx])
            .rpc();
        },
      });

      // 5. Clear the batch inside the ER (permissionless).
      plan.push({
        id: "run-batch",
        label: "Run the auction (uniform-price clear)",
        plane: "ER",
        exec: async () =>
          erProgram.methods
            .runBatch()
            .accountsPartial({
              market: marketPk,
              batchBook: pda(ERPROG, "book", marketPk),
              batchResult: pda(ERPROG, "result", marketPk),
              oraclePrice: pda(ERPROG, "oracle", marketPk),
            })
            .preInstructions([cuMax])
            .rpc(),
      });

      // 6. Undelegate market PDAs back toward L1 (ER).
      plan.push({
        id: "undelegate-market",
        label: "Commit + undelegate market",
        plane: "ER",
        exec: async () =>
          erProgram.methods
            .undelegateMarket()
            .accountsPartial({
              payer: owner,
              authority: owner,
              market: marketPk,
              batchBook: pda(ERPROG, "book", marketPk),
              batchResult: pda(ERPROG, "result", marketPk),
              oraclePrice: pda(ERPROG, "oracle", marketPk),
            })
            .preInstructions([cuMax])
            .rpc(),
      });

      // 7. Undelegate the trader's OpenOrders (ER).
      plan.push({
        id: "undelegate-oo",
        label: "Commit + undelegate your open orders",
        plane: "ER",
        exec: async () =>
          erProgram.methods
            .undelegateOpenOrders()
            .accountsPartial({
              payer: owner,
              openOrders: ooPda(ERPROG, marketPk, owner),
            })
            .preInstructions([cuMax])
            .rpc(),
      });

      // 8. Settle on L1 (waits for ownership transfer back from the delegation program).
      plan.push({
        id: "settle",
        label: "Settle fills atomically on Solana L1",
        plane: "L1",
        exec: async ({ setDetail }) => {
          const pre = await baseConnection.getAccountInfo(marketPk);
          if (!pre?.owner.equals(PROG)) {
            let owned = false;
            for (let i = 0; i < 20; i++) {
              setDetail(`Waiting for L1 ownership transfer… (${i * 3}s)`);
              await new Promise((r) => setTimeout(r, 3000));
              const info = await baseConnection.getAccountInfo(marketPk);
              if (info?.owner.equals(PROG)) {
                owned = true;
                break;
              }
            }
            if (!owned) {
              throw new Error(
                "Market still owned by delegation program after 60s — retry settle.",
              );
            }
          }
          setDetail("");
          return baseProgram.methods
            .settle()
            .accountsPartial({
              market: marketPk,
              batchResult: pda(PROG, "result", marketPk),
              openOrders: ooPda(PROG, marketPk, owner),
            })
            .rpc();
        },
      });

      // 9. Finalize settlement (L1).
      plan.push({
        id: "finalize",
        label: "Finalize settlement",
        plane: "L1",
        exec: async () =>
          baseProgram.methods
            .finalizeSettlement()
            .accountsPartial({ market: marketPk, authority: owner })
            .rpc(),
      });

      setSteps(
        plan.map((p) => ({
          id: p.id,
          label: p.label,
          plane: p.plane,
          status: "pending" as StepStatus,
        })),
      );
      setRunning(true);
      setError(null);
      setDone(false);

      const setDetail = (detail: string) =>
        setSteps((prev) =>
          prev.map((s) => (s.status === "running" ? { ...s, detail } : s)),
        );

      for (let i = 0; i < plan.length; i++) {
        setSteps((prev) =>
          prev.map((s, idx) => (idx === i ? { ...s, status: "running" } : s)),
        );
        try {
          const sig = await plan[i].exec({ setDetail });
          setSteps((prev) =>
            prev.map((s, idx) =>
              idx === i ? { ...s, status: "done", sig, detail: undefined } : s,
            ),
          );
        } catch (e) {
          const msg = parseProgramError(e);
          setSteps((prev) =>
            prev.map((s, idx) =>
              idx === i ? { ...s, status: "error", detail: msg } : s,
            ),
          );
          setError(msg);
          setRunning(false);
          onComplete?.();
          return;
        }
      }

      setRunning(false);
      setDone(true);
      onComplete?.();
    },
    [
      connected,
      publicKey,
      ctx.marketPubkey,
      ctx.baseMint,
      ctx.quoteMint,
      ctx.baseVault,
      ctx.quoteVault,
      baseProgram,
      erProgram,
      baseConnection,
      onComplete,
    ],
  );

  return { steps, running, error, done, run, reset, connected };
}
