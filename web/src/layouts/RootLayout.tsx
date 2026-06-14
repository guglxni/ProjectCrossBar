import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { SiteNav } from "@/components/site/SiteNav";
import { SiteFooter } from "@/components/site/SiteFooter";

export function RootLayout() {
  const { pathname } = useLocation();

  // Scroll to top on route change so each marketing page starts at the hero.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteNav />
      <main className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}
