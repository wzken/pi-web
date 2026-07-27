import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";

export default defineConfig({
  cacheDir:
    process.env.PI_WEB_VITE_CACHE_DIR ??
    fileURLToPath(new URL("../../.runtime/vite-cache", import.meta.url)),
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["pi-web.svg"],
      manifest: {
        name: "Pi Web",
        short_name: "Pi Web",
        description: "Private remote runtime for Pi Coding Agent",
        theme_color: "#0f1514",
        background_color: "#0f1514",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/pi-web.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any"
          }
        ]
      },
      workbox: {
        navigateFallback: "/index.html",
        runtimeCaching: [],
        globPatterns: ["**/*.{js,css,html,svg,woff2}"]
      }
    })
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        ws: true
      }
    }
  },
  build: {
    target: "es2022",
    sourcemap: false
  }
});
