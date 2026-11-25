import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import { existsSync, readFileSync } from "fs";

// ── TLS ──────────────────────────────────────────────────────────────────────
// Use the mkcert certs from data/ if present so the dev server runs on HTTPS.
// data/ is two levels above apps/web/.
const dataDir = path.resolve(__dirname, "../../data");
const certFile = path.join(dataDir, "ciara.pem");
const keyFile  = path.join(dataDir, "ciara-key.pem");

const tls =
  existsSync(certFile) && existsSync(keyFile)
    ? { cert: readFileSync(certFile), key: readFileSync(keyFile) }
    : null;

// The Vite proxy runs in Node.js, which does NOT trust the Windows CA store
// (and therefore doesn't trust the mkcert CA). secure: false tells the proxy
// to skip certificate verification when forwarding requests to the API.
const apiTarget = tls ? "https://localhost:3001" : "http://localhost:3001";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // Enable the service worker in dev mode so we can test installability
      // without doing a full production build first.
      devOptions: { enabled: true },
      manifest: {
        name: "Ciara Assistant",
        short_name: "Ciara",
        description: "Personal business management for authors and artists",
        theme_color: "#4f46e5",
        background_color: "#ffffff",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        icons: [
          { src: "pwa-64x64.png",             sizes: "64x64",   type: "image/png" },
          { src: "pwa-192x192.png",            sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png",            sizes: "512x512", type: "image/png" },
          { src: "maskable-icon-512x512.png",  sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // This is a local-first app — the API must be running anyway, so there
        // is no value in caching API responses. Only pre-cache static assets
        // (JS, CSS, HTML, fonts, icons) so the shell loads fast after install.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
        runtimeCaching: [], // no runtime caching of API calls
      },
    }),
  ],
  resolve: {
    alias: {
      // Allows: import { something } from "@/components/..."
      // instead of: import { something } from "../../components/..."
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,  // bind to 0.0.0.0 so LAN devices can reach it
    // Fixed at 5174: another server on this machine (Kitchen Lights) owns 5173.
    // strictPort: fail if 5174 is taken instead of moving to another port, so the
    // address saved in bookmarks and the installed tablet/phone app stays valid.
    port: 5174,
    strictPort: true,
    https: tls ?? undefined,
    // Proxy API requests to the backend during development.
    // When the frontend calls /api/..., Vite forwards it to the API server.
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        secure: false, // mkcert CA isn't in Node's bundle; skip cert check on proxy
      },
      "/auth": {
        target: apiTarget,
        changeOrigin: true,
        secure: false,
      },
      "/health": {
        target: apiTarget,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
