import { defineConfig } from "vite";

// Déchiffrement des notifications, chargé par le service worker
// (importScripts) : un seul fichier, sans module, sans nom versionné.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    copyPublicDir: false,
    lib: {
      entry: "src/sw/dechiffrement.ts",
      formats: ["iife"],
      name: "UniChatNotifications",
      fileName: () => "sw-dechiffrement.js",
    },
  },
});
