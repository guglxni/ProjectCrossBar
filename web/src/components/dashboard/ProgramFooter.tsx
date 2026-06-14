import {
  DELEGATION_PROGRAM,
  ER_RPC,
  MAX_ORDERS_PER_BATCH,
  PRICE_SCALE,
  PROGRAM_ID,
} from "@/lib/constants";
import { explorerAccountLink } from "@/lib/format";

const ROWS = [
  ["Program ID", PROGRAM_ID.toBase58()],
  ["Delegation program", DELEGATION_PROGRAM.toBase58()],
  ["MagicBlock devnet ER", ER_RPC],
  ["PRICE_SCALE", String(PRICE_SCALE)],
  ["MAX_ORDERS_PER_BATCH", String(MAX_ORDERS_PER_BATCH)],
];

export function ProgramFooter() {
  return (
    <footer className="mt-8 rounded-lg border border-border bg-muted/30 p-4">
      <p className="mb-3 text-sm font-medium">Program constants</p>
      <table className="w-full text-xs">
        <tbody>
          {ROWS.map(([label, value]) => (
            <tr key={label} className="border-b border-border/60 last:border-0">
              <td className="py-2 pr-4 text-muted-foreground">{label}</td>
              <td className="py-2 font-mono break-all">
                {label === "Program ID" || label === "Delegation program" ? (
                  <a
                    href={explorerAccountLink(value)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {value}
                  </a>
                ) : (
                  value
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </footer>
  );
}
