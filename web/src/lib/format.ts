import { BN } from "@coral-xyz/anchor";
import { EXPLORER_CLUSTER, PRICE_SCALE } from "./constants";

type PriceInput = BN | bigint | number | string;

export function formatPrice(value: PriceInput): string {
  const n =
    value instanceof BN
      ? value.toString()
      : typeof value === "bigint"
        ? value.toString()
        : String(value);
  const whole = BigInt(n);
  const intPart = whole / BigInt(PRICE_SCALE);
  const frac = whole % BigInt(PRICE_SCALE);
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return fracStr.length > 0 ? `${intPart}.${fracStr}` : intPart.toString();
}

export function formatQty(value: PriceInput, decimals = 6): string {
  const n =
    value instanceof BN
      ? value.toString()
      : typeof value === "bigint"
        ? value.toString()
        : String(value);
  const whole = BigInt(n);
  const scale = 10n ** BigInt(decimals);
  const intPart = whole / scale;
  const frac = whole % scale;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr.length > 0 ? `${intPart}.${fracStr}` : intPart.toString();
}

export function explorerTxLink(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=${EXPLORER_CLUSTER}`;
}

export function explorerAccountLink(address: string): string {
  return `https://explorer.solana.com/address/${address}?cluster=${EXPLORER_CLUSTER}`;
}

export function truncatePubkey(pk: string, chars = 4): string {
  if (pk.length <= chars * 2 + 3) return pk;
  return `${pk.slice(0, chars)}...${pk.slice(-chars)}`;
}
