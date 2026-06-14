import { PublicKey } from "@solana/web3.js";
import { MAGIC_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";

export const PRICE_SCALE = 1_000_000;
export const MAX_ORDERS_PER_BATCH = 64;

export const SIDE_BUY = 0;
export const SIDE_SELL = 1;
export const FLOW_MAKER = 0;
export const FLOW_TAKER = 1;

export const BATCH_CLEARED = 0;
export const BATCH_SKIPPED_STALE_ORACLE = 1;
export const BATCH_REJECTED_OUT_OF_BAND = 2;
export const BATCH_EMPTY = 3;
export const BATCH_FORMING = 4;

export const BATCH_STATUS_LABELS: Record<number, string> = {
  [BATCH_CLEARED]: "Cleared",
  [BATCH_SKIPPED_STALE_ORACLE]: "SkippedStaleOracle",
  [BATCH_REJECTED_OUT_OF_BAND]: "RejectedOutOfBand",
  [BATCH_EMPTY]: "Empty",
  [BATCH_FORMING]: "Forming",
};

export const MARKET_STATUS_LABELS: Record<string, string> = {
  onBase: "OnBase",
  delegated: "Delegated",
  settling: "Settling",
};

export const BASE_RPC =
  import.meta.env.VITE_BASE_RPC ?? "https://api.devnet.solana.com";
export const ER_RPC =
  import.meta.env.VITE_ER_RPC ?? "https://devnet.magicblock.app/";
export const PROGRAM_ID = new PublicKey(
  import.meta.env.VITE_PROGRAM_ID ??
    "CG4brtfmRvvHLGEfLazSmrTWeUJsDvyKYfosx2Abbzbd",
);
export const DELEGATION_PROGRAM = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
);
export const MAGIC_PROGRAM = MAGIC_PROGRAM_ID;
export const VALIDATOR = new PublicKey(
  import.meta.env.VITE_VALIDATOR ?? "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57",
);

export const HERO_VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_083109_283f3553-e28f-428b-a723-d639c617eb2b.mp4";

export const KORA_RPC = import.meta.env.VITE_KORA_RPC as string | undefined;
// Kora fee payer pubkey — set to the pubkey of kora/fee-payer.json so gasless
// transactions use Kora's signer as feePayer instead of the user's wallet.
export const KORA_FEE_PAYER = import.meta.env.VITE_KORA_FEE_PAYER as string | undefined;
export const FLASH_API_URL =
  (import.meta.env.VITE_FLASH_API_URL as string | undefined) ??
  "https://flashapi.trade";
export const FLASH_MOCK = import.meta.env.VITE_FLASH_MOCK === "1";

export const EXPLORER_CLUSTER = "devnet";
export const PARITY_PASSED = 4006;
export const PARITY_TOTAL = 4006;
export const RUN_BATCH_CU_MIN = 18_000;
export const RUN_BATCH_CU_MAX = 21_000;

export const STORAGE_KEYS = {
  market: "crossbar.market",
  baseMint: "crossbar.baseMint",
  quoteMint: "crossbar.quoteMint",
} as const;
