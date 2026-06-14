import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    // Some Solana/MagicBlock deps reference `global`; map it to globalThis.
    global: "globalThis",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    include: ["buffer"],
  },
  server: {
    port: 5173,
    proxy: {
      "/api/coingecko": {
        target: "https://api.coingecko.com/api/v3",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/coingecko/, ""),
      },
      "/api/pyth": {
        target: "https://benchmarks.pyth.network",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/pyth/, ""),
      },
    },
  },
});
