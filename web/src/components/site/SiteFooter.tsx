import { Link } from "react-router-dom";
import { PROGRAM_ID } from "@/lib/constants";
import { explorerAccountLink } from "@/lib/format";

const NAV = [
  { label: "Dashboard", to: "/dashboard" },
  { label: "Docs", to: "/docs" },
  { label: "Parity", to: "/parity" },
  { label: "Integrations", to: "/integrations" },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto grid max-w-7xl gap-10 px-6 py-14 md:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <Link to="/" className="flex items-center gap-3">
            <img
              src="/crossbar-logo.png"
              alt="CrossBar"
              className="h-11 w-11 object-contain"
            />
            <span className="font-display text-2xl tracking-tight text-foreground">
              CrossBar
            </span>
          </Link>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
            A frequent batch auction DEX on Solana. Uniform-price clearing runs
            inside a MagicBlock Ephemeral Rollup and settles atomically to L1.
          </p>
        </div>

        <div>
          <p className="text-sm font-medium text-foreground">Product</p>
          <ul className="mt-4 space-y-3 text-sm">
            {NAV.map((n) => (
              <li key={n.to}>
                <Link
                  to={n.to}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-sm font-medium text-foreground">On chain</p>
          <ul className="mt-4 space-y-3 text-sm">
            <li>
              <a
                href={explorerAccountLink(PROGRAM_ID.toBase58())}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {PROGRAM_ID.toBase58().slice(0, 10)}…{PROGRAM_ID.toBase58().slice(-4)}
              </a>
            </li>
            <li className="text-xs text-muted-foreground">Solana devnet</li>
            <li>
              <a
                href="https://github.com/guglxni/ProjectCrossBar"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                GitHub
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-6 py-6 text-xs text-muted-foreground sm:flex-row">
          <p>© {new Date().getFullYear()} Project CrossBar. Built on Solana and MagicBlock.</p>
          <p className="font-mono">Beyond the slot, one price for every window.</p>
        </div>
      </div>
    </footer>
  );
}
