import { Toaster } from "@/components/ui/sonner";
import { MarketProvider } from "@/context/MarketContext";
import { WalletProvider } from "@/providers/WalletProvider";
import { useCrossbarProgram } from "@/hooks/useCrossbarProgram";
import { useMarketContext } from "@/context/MarketContext";
import { useMarketPolling } from "@/hooks/useMarketPolling";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { HeroSection } from "@/components/hero/HeroSection";

function HeroWithPoll() {
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
  return <HeroSection poll={poll} />;
}

function AppContent() {
  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-background">
      <HeroWithPoll />
      <DashboardShell />
      <Toaster richColors position="bottom-right" />
    </div>
  );
}

export default function App() {
  return (
    <WalletProvider>
      <MarketProvider>
        <AppContent />
      </MarketProvider>
    </WalletProvider>
  );
}
