import { aleatoire, creerCleSignee, creerClesUniques, creerIdentite, identitePublique, versBase64 } from "@unichat/chiffrement";
import type { AppareilsCompte, EtatCles, InscriptionCles, MessageClient } from "@unichat/shared";

/**
 * Outils des tests qui font circuler des messages : depuis la fin des
 * messages en clair (lot 8), tout passe par des trames chiffrées. Le
 * serveur ne lit pas le contenu ; il vérifie seulement que la clé part vers
 * chaque appareil inscrit des destinataires. Le contenu est donc factice.
 */

interface Appareil {
  appel(chemin: string, init?: RequestInit & { json?: unknown }): Promise<Response>;
}

export type TrameChiffree = Extract<MessageClient, { t: "chiffre" }>;

/** Premier appareil d'un compte : il crée l'identité et s'inscrit (sans cela, le serveur refuse ses envois). */
export async function inscrireCles(appareil: Appareil): Promise<void> {
  const identite = creerIdentite();
  const pub = identitePublique(identite);
  const signee = creerCleSignee(identite, 1, Date.now());
  const inscription: InscriptionCles = {
    identite: { signature: versBase64(pub.signature), echange: versBase64(pub.echange), preuve: versBase64(pub.preuve) },
    appareil: {
      cleSignee: { id: 1, cle: versBase64(signee.paire.publique), signature: versBase64(signee.signature) },
      clesUniques: creerClesUniques(1, 5).map((u) => ({ id: u.id, cle: versBase64(u.paire.publique) })),
      jeton: versBase64(aleatoire(32)),
    },
  };
  const reponse = await appareil.appel("/api/cles/identite", { method: "POST", json: inscription });
  if (reponse.status !== 201) throw new Error(`inscription des clés refusée : ${reponse.status}`);
}

/**
 * Trame chiffrée telle que l'application l'enverrait : la liste des
 * appareils vient de l'annuaire, l'appareil qui envoie en est retiré.
 */
export async function trameChiffree(
  appareil: Appareil,
  moi: string,
  d: { id?: string; a?: string; groupe?: string; comptes: string[]; genre?: "message" | "action"; mentions?: string[]; pour?: string },
): Promise<TrameChiffree> {
  const etat = (await (await appareil.appel("/api/cles")).json()) as EtatCles;
  const comptes = [...new Set([...d.comptes, moi])];
  const { comptes: annuaire } = (await (await appareil.appel("/api/cles/appareils", { method: "POST", json: { comptes } })).json()) as {
    comptes: AppareilsCompte[];
  };
  const cles = Object.fromEntries(
    comptes.map((compte) => {
      const numeros = annuaire.find((x) => x.id === compte)?.appareils ?? [];
      const vises = numeros.filter((n) => !(compte === moi && n === etat.appareil?.numero));
      return [compte, Object.fromEntries(vises.map((n) => [String(n), "Q2xlRmFjdGljZQ"]))];
    }),
  );
  return {
    t: "chiffre",
    id: d.id ?? crypto.randomUUID(),
    ...(d.groupe ? { groupe: d.groupe } : { a: d.a ?? moi }),
    ...(d.pour ? { pour: d.pour } : {}),
    ...(d.mentions ? { mentions: d.mentions } : {}),
    genre: d.genre ?? "message",
    corps: "Q29udGVudUZhY3RpY2U",
    cles,
  };
}
