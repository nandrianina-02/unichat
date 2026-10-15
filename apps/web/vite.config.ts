import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      // Pages publiques en HTML statique : lisibles sans JavaScript, par les
      // visiteurs comme par Google, qui les exige pour publier la connexion.
      // Chemins relatifs au dossier de l'application web.
      input: {
        application: "index.html",
        confidentialite: "confidentialite.html",
        conditions: "conditions.html",
      },
    },
  },
});
