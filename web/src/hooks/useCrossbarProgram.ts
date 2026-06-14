import { useMemo } from "react";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import idl from "@/idl/crossbar.json";
import { BASE_RPC, ER_RPC, PROGRAM_ID } from "@/lib/constants";

function readOnlyWallet(): anchor.Wallet {
  return {
    publicKey: PublicKey.default,
    signTransaction: async () => {
      throw new Error("Wallet not connected");
    },
    signAllTransactions: async () => {
      throw new Error("Wallet not connected");
    },
  } as unknown as anchor.Wallet;
}

export function useCrossbarProgram() {
  const wallet = useWallet();
  const anchorWallet = useAnchorWallet();

  const baseConnection = useMemo(
    () => new anchor.web3.Connection(BASE_RPC, "confirmed"),
    [],
  );
  const erConnection = useMemo(
    () => new anchor.web3.Connection(ER_RPC, "confirmed"),
    [],
  );

  const programs = useMemo(() => {
    const w = anchorWallet ?? readOnlyWallet();
    const baseProvider = new anchor.AnchorProvider(
      baseConnection,
      w,
      { commitment: "confirmed" },
    );
    const erProvider = new anchor.AnchorProvider(erConnection, w, {
      commitment: "confirmed",
    });

    const baseProgram = new Program(idl as anchor.Idl, baseProvider);
    const erProgram = new Program(idl as anchor.Idl, erProvider);

    return { baseProgram, erProgram };
  }, [anchorWallet, baseConnection, erConnection]);

  return {
    baseProgram: programs.baseProgram,
    erProgram: programs.erProgram,
    baseConnection,
    erConnection,
    programId: PROGRAM_ID,
    wallet: anchorWallet ?? null,
    connected: wallet.connected,
    publicKey: wallet.publicKey,
  };
}
