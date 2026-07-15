import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",           // спрашиваем перед обновлением
      strategies: "injectManifest",     // кастомный SW (нужен для push)
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,png,svg,ico,woff2}"],
        globIgnores: ["**/logo.mp4", "**/splash.mp4"],
      },
      // Manifest синхронизирован с public/manifest.json
      manifest: {
        name: "Reps — Тренер",
        short_name: "Reps",
        description: "Инструмент персонального тренера",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#04030F",
        theme_color: "#09090b",
        lang: "ru",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
      devOptions: {
        enabled: true,
        type: "module",
      },
    }),
  ],
});
