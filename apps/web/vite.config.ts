import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * version.json : le script d'entrée de cette construction. L'application
 * ouverte le compare au sien pour savoir qu'une nouvelle version est en
 * ligne (src/lib/version.ts).
 */
function version(): Plugin {
  return {
    name: "unichat-version",
    apply: "build",
    generateBundle(_, fichiers) {
      const entree = Object.values(fichiers).find((f) => f.type === "chunk" && f.isEntry && f.name === "application");
      if (entree) this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ script: `/${entree.fileName}` }) });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), version()],
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
