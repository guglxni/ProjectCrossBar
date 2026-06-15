import { Link } from "react-router-dom";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useMarketContext } from "@/context/MarketContext";
import { useCrossbarProgram } from "@/hooks/useCrossbarProgram";
import { useMarketPolling } from "@/hooks/useMarketPolling";
import { BatchBookPanel } from "@/components/dashboard/BatchBookPanel";
import { BatchResultPanel } from "@/components/dashboard/BatchResultPanel";
import { FlashPanel } from "@/components/dashboard/FlashPanel";
import { MarketConfigBar } from "@/components/dashboard/MarketConfigBar";
import { MarketLifecyclePanel } from "@/components/dashboard/MarketLifecyclePanel";
import { OracleBandPanel } from "@/components/dashboard/OracleBandPanel";
import { OrderEntryPanel } from "@/components/dashboard/OrderEntryPanel";
import { ProgramFooter } from "@/components/dashboard/ProgramFooter";
import { VerificationPanel } from "@/components/dashboard/VerificationPanel";
import { DemoScenariosPanel } from "@/components/dashboard/DemoScenariosPanel";
import { RoundTripPanel } from "@/components/dashboard/RoundTripPanel";
import { PriceTicker } from "@/components/dashboard/PriceTicker";
import { LiveMarketPanel } from "@/components/dashboard/LiveMarketPanel";
import { MarketTickerProvider } from "@/context/MarketTickerContext";

const NAV = [
  { id: "livemarket", label: "Live market" },
  { id: "roundtrip", label: "One-click round-trip" },
  { id: "lifecycle", label: "Lifecycle" },
  { id: "book", label: "Batch book" },
  { id: "result", label: "Clear result" },
  { id: "orders", label: "Order entry" },
  { id: "oracle", label: "Oracle band" },
  { id: "demos", label: "Scenario demos" },
  { id: "flash", label: "Flash Trade" },
  { id: "verification", label: "Verification" },
];

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function DashboardPage() {
  const marketCtx = useMarketContext();
  const { baseProgram, erProgram, programId, publicKey } = useCrossbarProgram();
  const poll = useMarketPolling(
    marketCtx.marketPubkey,
    programId,
    baseProgram,
    erProgram,
    publicKey,
    marketCtx.configured,
  );

  return (
    <MarketTickerProvider>
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <Link to="/" className="flex items-center gap-2.5 px-2 py-1.5">
            <img
              src="/logo.png"
              alt="CrossBar"
              className="h-9 w-auto object-contain"
            />
            <span className="font-display text-xl tracking-tight">CrossBar</span>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Dashboard</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton onClick={() => scrollTo(item.id)}>
                      {item.label}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <Link
            to="/"
            className="px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            ← Back to home
          </Link>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger />
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate text-sm font-medium">
              Live trading dashboard
            </span>
            <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
              <span className="mr-1 h-1.5 w-1.5 rounded-full bg-[var(--success)]" />
              Devnet + MagicBlock ER
            </Badge>
          </div>
          <WalletMultiButton className="crossbar-wallet-btn" />
        </header>

        <PriceTicker />

        <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
          <LiveMarketPanel />

          <MarketConfigBar />

          {poll.error && (
            <Alert variant="destructive">
              <AlertDescription>{poll.error}</AlertDescription>
            </Alert>
          )}

          <RoundTripPanel onComplete={poll.refresh} />

          <MarketLifecyclePanel poll={poll} />

          <div className="grid gap-6 lg:grid-cols-2">
            <BatchBookPanel poll={poll} />
            <OrderEntryPanel poll={poll} />
          </div>

          <BatchResultPanel poll={poll} />
          <OracleBandPanel poll={poll} />
          <DemoScenariosPanel poll={poll} />
          <FlashPanel poll={poll} />
          <VerificationPanel />
          <ProgramFooter />
        </main>
      </SidebarInset>
    </SidebarProvider>
    </MarketTickerProvider>
  );
}
