import { BN, type Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { PRICE_SCALE } from "./constants";

export const enc = (s: string) => Buffer.from(s);

export function marketPda(
  programId: PublicKey,
  base: PublicKey,
  quote: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [enc("market"), base.toBuffer(), quote.toBuffer()],
    programId,
  )[0];
}

export function pda(
  programId: PublicKey,
  seed: string,
  market: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [enc(seed), market.toBuffer()],
    programId,
  )[0];
}

export function ooPda(
  programId: PublicKey,
  market: PublicKey,
  owner: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [enc("open_orders"), market.toBuffer(), owner.toBuffer()],
    programId,
  )[0];
}

/** Human price to fixed-point BN (integer math at UI boundary). */
export function px(p: number): BN {
  return new BN(Math.round(p * PRICE_SCALE));
}

/** Alias used in tests: human string/number to scaled u64. */
export function humanToPrice(p: number): BN {
  return px(p);
}

/** Program-scoped helpers matching tests/crossbar-demo.ts. */
export function marketPdaForProgram(
  program: Program,
  base: PublicKey,
  quote: PublicKey,
): PublicKey {
  return marketPda(program.programId, base, quote);
}

export function pdaForProgram(
  program: Program,
  seed: string,
  market: PublicKey,
): PublicKey {
  return pda(program.programId, seed, market);
}

export function ooPdaForProgram(
  program: Program,
  market: PublicKey,
  owner: PublicKey,
): PublicKey {
  return ooPda(program.programId, market, owner);
}

export interface MarketPdas {
  market: PublicKey;
  batchBook: PublicKey;
  batchResult: PublicKey;
  baseVault: PublicKey;
  quoteVault: PublicKey;
  oraclePrice: PublicKey;
}

export function deriveMarketPdas(
  programId: PublicKey,
  market: PublicKey,
): Omit<MarketPdas, "market"> {
  return {
    batchBook: pda(programId, "book", market),
    batchResult: pda(programId, "result", market),
    baseVault: pda(programId, "base_vault", market),
    quoteVault: pda(programId, "quote_vault", market),
    oraclePrice: pda(programId, "oracle", market),
  };
}
