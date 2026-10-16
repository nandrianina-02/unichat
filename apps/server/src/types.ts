import type { LigneSession } from "./lib/sessions";
import type { Boite } from "./temps-reel/boite";

export interface Bindings {
  DB: D1Database;
  BOITE: DurableObjectNamespace<Boite>;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Stockage des fichiers joints (Karaks Storage) : adresse publique, et clé secrète. */
  KARAKS_STORAGE_URL?: string;
  KARAKS_STORAGE_CLE?: string;
  /** Web Push : clé privée VAPID (JWK, secret) et contact annoncé aux services de notification. */
  VAPID_PRIVEE?: string;
  VAPID_CONTACT?: string;
  /** Application Android : identifiant et empreintes SHA-256 de ses clés de signature (séparées par des virgules). */
  ANDROID_PAQUET?: string;
  ANDROID_EMPREINTES?: string;
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
