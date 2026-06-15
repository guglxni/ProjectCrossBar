import { useMarketContext } from "@/context/MarketContext";
import { useCrossbarProgram } from "@/hooks/useCrossbarProgram";
import { useMarketPolling } from "@/hooks/useMarketPolling";
import { HeroSection } from "@/components/hero/HeroSection";
import { FlashTradeSection } from "@/components/landing/FlashTradeSection";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { FeatureGrid } from "@/components/landing/FeatureGrid";
import { InvariantsSection } from "@/components/landing/InvariantsSection";
import { FaqSection } from "@/components/landing/FaqSection";
import { CtaSection } from "@/components/landing/CtaSection";

export function LandingPage() {
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
    <>
      <HeroSection poll={poll} />
      <HowItWorks />
      <FlashTradeSection />
      <FeatureGrid />
      <InvariantsSection />
      <FaqSection />
      <CtaSection />
    </>
  );
}
