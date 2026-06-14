import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

const LINKS = [
  { label: "Markets", href: "#dashboard" },
  { label: "Dashboard", href: "#dashboard" },
  { label: "Parity", href: "#verification" },
  { label: "Integrations", href: "#flash" },
  { label: "Docs", href: "https://github.com/guglxni/ProjectCrossBar" },
];

function scrollTo(href: string) {
  if (href.startsWith("#")) {
    document.querySelector(href)?.scrollIntoView({ behavior: "smooth" });
  } else {
    window.open(href, "_blank", "noopener");
  }
}

export function HeroNav() {
  return (
    <nav className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-8 py-6">
      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        className="flex items-center gap-3"
      >
        <img
          src="/crossbar-logo-mark.png"
          alt="Project CrossBar"
          className="h-9 w-9"
        />
        <span className="font-display text-3xl tracking-tight text-foreground">
          CrossBar<sup className="text-xs">®</sup>
        </span>
      </button>
      <div className="hidden items-center gap-8 md:flex">
        {LINKS.map((link) => (
          <button
            key={link.label}
            type="button"
            onClick={() => scrollTo(link.href)}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {link.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <WalletMultiButton className="!rounded-full !bg-black !text-sm !text-white hover:!scale-[1.03]" />
        <button
          type="button"
          onClick={() => scrollTo("#dashboard")}
          className="hidden rounded-full bg-primary px-6 py-2.5 text-sm text-primary-foreground transition-transform hover:scale-[1.03] sm:inline-block"
        >
          Open Dashboard
        </button>
      </div>
    </nav>
  );
}
