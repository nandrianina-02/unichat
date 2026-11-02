import { z } from "zod";

/**
 * Connexion depuis l'application Android native. Google y est interrogé par
 * le système (Credential Manager), qui rend directement un jeton
 * d'identité : pas de redirection, donc pas de cookie. L'application
 * demande d'abord un nonce au serveur, le confie à Google, puis renvoie le
 * jeton avec l'état qui retrouve ce nonce.
 */
export const schemaConnexionNatif = z.object({
  etat: z.string().min(20).max(200),
  jeton: z.string().min(20).max(8000),
  /** Nom de l'appareil, montré dans la liste des appareils connectés. */
  appareil: z.string().trim().min(1).max(80),
});

export type ConnexionNatif = z.infer<typeof schemaConnexionNatif>;

export interface NonceNatif {
  etat: string;
  nonce: string;
}

export interface SessionNatif {
  jeton: string;
}
