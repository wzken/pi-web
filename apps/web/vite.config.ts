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
      includeAssets: [
        "pi-web.svg",
        "pwa-192.png",
        "pwa-512.png",
        "pwa-maskable-512.png",
        "push-sw.js"
      ],
      manifest: {
        name: "Pi Web",
        short_name: "Pi Web",
        description: "Private remote runtime for Pi Coding Agent",
        theme_color: "#0c1110",
        background_color: "#0c1110",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/pwa-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "/pwa-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "/pwa-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        cacheId: "pi-web",
        cleanupOutdatedCaches: true,
        navigateFallback: "/index.html",
        importScripts: ["push-sw.js"],
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
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("react-markdown") || id.includes("remark-") || id.includes("rehype-") || id.includes("/micromark") || id.includes("/mdast-") || id.includes("/hast-") || id.includes("/unist-")) {
            return "vendor-markdown";
          }
          if (id.includes("@xterm") || id.includes("/xterm")) return "vendor-terminal";
          if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/")) {
            return "vendor-react";
          }
          return undefined;
        }
      }
    }
  }
});
