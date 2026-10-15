import type { LigneSession } from "./lib/sessions";

export interface Bindings {
  DB: D1Database;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

/**
 * Ce qui vient de l'extérieur, injecté pour que les tests remplacent Google
 * et l'horloge sans aucun interrupteur « mode test » dans le code livré.
 */
export interface Dependances {
  recuperer: typeof fetch;
  maintenant: () => number;
}

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    deps: Dependances;
    session: LigneSession;
  };
};
