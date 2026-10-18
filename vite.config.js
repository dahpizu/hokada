import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/hokada/",
  plugins: [
    react(),
    VitePWA({
      manifest: false,
      registerType: "autoUpdate",
      includeAssets: [
        "hokada-icon.svg",
        "hokada-rider-icon.svg",
        "hokada-rider-icon-180.png",
        "hokada-rider-icon-192.png",
        "hokada-rider-icon-512.png"
      ]
    })
  ]
});
