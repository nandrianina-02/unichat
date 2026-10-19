import type { EtatLiaison } from "@unichat/shared";
import type { IdentitePrivee, RoleLiaison } from "@unichat/chiffrement";
import { ErreurApi, api } from "./api";
import type { Messagerie } from "./messagerie";

/**
 * Déroulé d'une liaison, côté application. Le serveur ne fait que relayer ;
 * le QR code (canal, clé éphémère, secret) ne passe que par l'écran.
 * Voir packages/chiffrement/src/liaison.ts pour la cryptographie.
 */

const bibliotheque = () => import("@unichat/chiffrement");

/** Erreur expliquée à la personne ; toute autre erreur de la liaison est un échec de vérification. */
export class ErreurLiaison extends Error {}

export function messageLiaison(e: unknown): string {
  if (e instanceof ErreurLiaison || e instanceof ErreurApi) return e.message;
  return "Ce code n'a pas pu être vérifié. Recommencez avec un nouveau code.";
}

export const estAnnulation = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

export interface Suivi {
  etape: (texte: string) => void;
  signal: AbortSignal;
}

const INTERVALLE = 1500;

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resoudre, rejeter) => {
    const minuterie = setTimeout(resoudre, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(minuterie);
      rejeter(new DOMException("Liaison annulée", "AbortError"));
    });
  });
}

/** Interroge le serveur jusqu'à ce que l'autre appareil ait fait sa part. */
async function attendre(canal: string, condition: (e: EtatLiaison) => boolean, signal: AbortSignal): Promise<EtatLiaison> {
  for (;;) {
    if (signal.aborted) throw new DOMException("Liaison annulée", "AbortError");
    const etat = await api.liaison(canal);
    if (condition(etat)) return etat;
    await pause(INTERVALLE, signal);
  }
}

/** L'identité reçue doit être celle que l'annuaire publie pour ce compte. */
async function verifierCompte(identite: IdentitePrivee): Promise<void> {
  const { versBase64 } = await bibliotheque();
  const { identite: publiee } = await api.etatCles();
  if (!publiee || publiee.signature !== versBase64(identite.signature.publique) || publiee.echange !== versBase64(identite.echange.publique)) {
    throw new ErreurLiaison("Les clés reçues ne sont pas celles de votre compte.");
  }
}

async function identiteADonner(messagerie: Messagerie): Promise<IdentitePrivee> {
  const identite = await messagerie.identite();
  if (!identite) throw new ErreurLiaison("Cet appareil n'a pas les clés du compte : il ne peut pas les transmettre.");
  return identite;
}

/**
 * Cet appareil affiche un code. Rend le texte du QR code et de quoi mener
 * la liaison jusqu'au bout, une fois le code lu par l'autre appareil. La
 * valeur finale est le nom de l'autre appareil.
 */
export async function afficherCode(role: RoleLiaison, messagerie: Messagerie) {
  const c = await bibliotheque();
  const { canal, expireLe } = await api.creerLiaison(role);
  const { code, paire } = c.preparerCode(canal, role);

  async function poursuivre({ etape, signal }: Suivi): Promise<string | undefined> {
    const lu = await attendre(canal, (e) => e.etat !== "attente", signal);
    const autreCle = c.depuisBase64(lu.reponse!.cle);
    if (!c.verifierPreuve(code, autreCle, c.depuisBase64(lu.reponse!.preuve))) {
      throw new ErreurLiaison("La réponse reçue ne vient pas de l'appareil qui a lu ce code. Recommencez avec un nouveau code.");
    }
    const cle = c.cleCommune(code, paire, autreCle);
    if (role === "receveur") {
      etape("Clés reçues. Inscription de cet appareil…");
      const avecCles = lu.cles ? lu : await attendre(canal, (e) => Boolean(e.cles), signal);
      const identite = c.ouvrirIdentite(cle, canal, c.depuisBase64(avecCles.cles!));
      await verifierCompte(identite);
      await messagerie.relier(canal, identite);
      return lu.autre;
    }
    etape(`Transmission des clés à ${lu.autre ?? "l'autre appareil"}…`);
    await api.deposerCles(canal, c.versBase64(c.scellerIdentite(cle, canal, await identiteADonner(messagerie))));
    etape("Clés transmises. L'autre appareil termine la liaison…");
    return (await attendre(canal, (e) => e.etat === "termine", signal)).autre;
  }

  return { texte: c.encoderCode(code), expireLe, poursuivre };
}

/** Cet appareil a lu (ou collé) le code affiché par l'autre. */
export async function lireCode(texte: string, role: RoleLiaison, messagerie: Messagerie, { etape, signal }: Suivi): Promise<string | undefined> {
  const c = await bibliotheque();
  const code = c.lireCode(texte);
  if (!code) throw new ErreurLiaison("Ce n'est pas un code de liaison UniChat.");
  if (code.role === role) {
    throw new ErreurLiaison(
      role === "donneur"
        ? "Cet autre appareil a déjà les clés du compte : il n'y a rien à lui transmettre."
        : "Ce code vient d'un appareil qui n'a pas non plus les clés. Lisez le code d'un appareil déjà relié.",
    );
  }
  const paire = c.paireEchange();
  const cle = c.cleCommune(code, paire, code.cle);
  const reponse = { cle: c.versBase64(paire.publique), preuve: c.versBase64(c.preuveLiaison(code, paire.publique)) };

  if (role === "donneur") {
    etape("Transmission des clés…");
    const identite = await identiteADonner(messagerie);
    await api.repondreLiaison(code.canal, { ...reponse, cles: c.versBase64(c.scellerIdentite(cle, code.canal, identite)) });
    etape("Clés transmises. L'autre appareil termine la liaison…");
    return (await attendre(code.canal, (e) => e.etat === "termine", signal)).autre;
  }

  etape("Code lu. En attente des clés de l'autre appareil…");
  const premier = await api.repondreLiaison(code.canal, reponse);
  const avecCles = premier.cles ? premier : await attendre(code.canal, (e) => Boolean(e.cles), signal);
  etape("Clés reçues. Inscription de cet appareil…");
  const identite = c.ouvrirIdentite(cle, code.canal, c.depuisBase64(avecCles.cles!));
  await verifierCompte(identite);
  await messagerie.relier(code.canal, identite);
  return avecCles.autre;
}
