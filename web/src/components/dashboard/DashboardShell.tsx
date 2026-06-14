import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useMarketContext } from "@/context/MarketContext";
import { useCrossbarProgram } from "@/hooks/useCrossbarProgram";
import { useMarketPolling } from "@/hooks/useMarketPolling";
import { BatchBookPanel } from "./BatchBookPanel";
import { BatchResultPanel } from "./BatchResultPanel";
import { FlashPanel } from "./FlashPanel";
import { MarketConfigBar } from "./MarketConfigBar";
import { MarketLifecyclePanel } from "./MarketLifecyclePanel";
import { OracleBandPanel } from "./OracleBandPanel";
import { OrderEntryPanel } from "./OrderEntryPanel";
import { ProgramFooter } from "./ProgramFooter";
import { VerificationPanel } from "./VerificationPanel";
import { DemoScenariosPanel } from "./DemoScenariosPanel";

const NAV = [
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
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

export function DashboardShell() {
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
    <SidebarProvider>
      <section id="dashboard" className="border-t border-border bg-background">
        <div className="flex min-h-screen w-full">
          <Sidebar>
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupLabel>CrossBar dashboard</SidebarGroupLabel>
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
          </Sidebar>
          <SidebarInset>
            <header className="flex h-14 items-center gap-2 border-b border-border px-4">
              <SidebarTrigger />
              <span className="text-sm font-medium">Live trading dashboard</span>
              <span className="text-xs text-muted-foreground">Solana devnet + MagicBlock ER</span>
            </header>
            <main className="flex flex-1 flex-col gap-6 p-4 md:p-6">
              <MarketConfigBar />

              {poll.error && (
                <Alert variant="destructive">
                  <AlertDescription>{poll.error}</AlertDescription>
                </Alert>
              )}

              <MarketLifecyclePanel poll={poll} />
              <BatchBookPanel poll={poll} />
              <BatchResultPanel poll={poll} />
              <OrderEntryPanel poll={poll} />
              <OracleBandPanel poll={poll} />
              <DemoScenariosPanel />
              <FlashPanel poll={poll} />
              <VerificationPanel />
              <ProgramFooter />
            </main>
          </SidebarInset>
        </div>
      </section>
    </SidebarProvider>
  );
}
