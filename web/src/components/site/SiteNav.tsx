import { Link, NavLink } from "react-router-dom";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const LINKS = [
  { label: "Dashboard", to: "/dashboard" },
  { label: "Docs", to: "/docs" },
  { label: "Parity", to: "/parity" },
  { label: "Integrations", to: "/integrations" },
];

export function SiteNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-md">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-3">
          <img
            src="/logo.png"
            alt="CrossBar"
            className="h-11 w-auto object-contain"
          />
          <span className="font-display text-2xl leading-none tracking-tight text-foreground">
            CrossBar<sup className="align-super text-[0.5rem]">®</sup>
          </span>
        </Link>

        <div className="hidden items-center gap-7 md:flex">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                cn(
                  "text-sm transition-colors hover:text-foreground",
                  isActive ? "text-foreground" : "text-muted-foreground",
                )
              }
            >
              {link.label}
            </NavLink>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <WalletMultiButton className="crossbar-wallet-btn" />
          <Button asChild className="hidden rounded-full sm:inline-flex">
            <Link to="/dashboard">Open dashboard</Link>
          </Button>
        </div>
      </nav>
    </header>
  );
}
