import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Refus d'une requête, avec un code stable (lu par les applications) et un
 * message rédigé pour la personne.
 */
export class Refus extends Error {
  constructor(
    public readonly statut: ContentfulStatusCode,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const refus = {
  requete: (message: string) => new Refus(400, "requete_invalide", message),
  nonConnecte: () => new Refus(401, "non_connecte", "Connectez-vous pour continuer."),
  interdit: (message = "Action non autorisée.") => new Refus(403, "interdit", message),
  introuvable: (message = "Introuvable.") => new Refus(404, "introuvable", message),
  conflit: (message: string) => new Refus(409, "conflit", message),
  tropDeDemandes: (secondes: number) =>
    new Refus(429, "trop_de_demandes", `Trop de demandes. Réessayez dans ${Math.max(1, secondes)} s.`),
};
