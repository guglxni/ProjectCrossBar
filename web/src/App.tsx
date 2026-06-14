import { Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { MarketProvider } from "@/context/MarketContext";
import { WalletProvider } from "@/providers/WalletProvider";
import { RootLayout } from "@/layouts/RootLayout";
import { LandingPage } from "@/pages/LandingPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { IntegrationsPage } from "@/pages/IntegrationsPage";
import { ParityPage } from "@/pages/ParityPage";
import { DocsPage } from "@/pages/DocsPage";
import { NotFoundPage } from "@/pages/NotFoundPage";

export default function App() {
  return (
    <WalletProvider>
      <MarketProvider>
        <Routes>
          <Route element={<RootLayout />}>
            <Route path="/" element={<LandingPage />} />
            <Route path="/integrations" element={<IntegrationsPage />} />
            <Route path="/docs" element={<DocsPage />} />
            <Route path="/parity" element={<ParityPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
          <Route path="/dashboard" element={<DashboardPage />} />
        </Routes>
        <Toaster richColors position="bottom-right" />
      </MarketProvider>
    </WalletProvider>
  );
}
