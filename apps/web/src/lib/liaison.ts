import { HISTORIQUE, type EtatHistorique, type EtatLiaison } from "@unichat/shared";
import type { IdentitePrivee, RoleLiaison } from "@unichat/chiffrement";
import { ErreurApi, api } from "./api";
import type { ArchiveHistorique, Messagerie } from "./messagerie";

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

/** Fin d'une liaison : l'autre appareil, et l'historique transmis (nombre de messages ; null s'il n'a pas pu passer). */
export interface FinLiaison {
  autre?: string;
  historique: number | null;
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

// --- Historique (lot 8) -------------------------------------------------------------

/** Nonce et étiquette AES-GCM de l'archive. */
const SURCOUT_ARCHIVE = 28;
const ARCHIVE_MAX = HISTORIQUE.morceau * HISTORIQUE.morceauxMax - SURCOUT_ARCHIVE;
/** Sans nouveau morceau pendant ce délai, l'autre appareil n'enverra plus rien. */
const ATTENTE_HISTORIQUE = 45_000;

const tampon = (o: Uint8Array) => o as Uint8Array<ArrayBuffer>;

async function compresser(texte: string): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([texte]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
}

async function decompresser(octets: Uint8Array): Promise<string> {
  return new Response(new Blob([tampon(octets)]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
}

/** L'archive vient de mon autre appareil, scellée : on ne vérifie que sa forme. */
function lireArchive(brut: unknown): ArchiveHistorique {
  const a = brut as Partial<ArchiveHistorique> | null;
  if (!a || a.v !== 1 || ![a.messages, a.conversations, a.personnes, a.groupes].every(Array.isArray)) {
    throw new Error("Historique illisible.");
  }
  return a as ArchiveHistorique;
}

const nombre = (n: number) => n.toLocaleString("fr-FR");

/**
 * Donneur : l'historique part chiffré, par morceaux. La clé de l'archive
 * n'est déposée que scellée sous la clé de la liaison : le serveur garde
 * l'archive sans pouvoir l'ouvrir. Trop lourde, elle perd ses plus anciens
 * messages jusqu'à tenir.
 */
async function envoyerHistorique(canal: string, cleLiaison: Uint8Array, messagerie: Messagerie, etape: (texte: string) => void): Promise<number> {
  const c = await bibliotheque();
  etape("Préparation de l'historique…");
  const archive = await messagerie.exporterHistorique();
  let messages = archive.messages;
  let compresse = await compresser(JSON.stringify({ ...archive, messages }));
  while (compresse.length > ARCHIVE_MAX && messages.length > 1) {
    messages = messages.slice(Math.floor(messages.length / 2));
    compresse = await compresser(JSON.stringify({ ...archive, messages }));
  }
  if (messages.length === 0 || compresse.length > ARCHIVE_MAX) {
    await api.finirHistorique(canal, { morceaux: 0 });
    return 0;
  }
  const { scelle, cle } = await c.chiffrerOctets(compresse);
  const morceaux = Math.ceil(scelle.length / HISTORIQUE.morceau);
  for (let i = 0; i < morceaux; i++) {
    etape(`Envoi de l'historique (${nombre(messages.length)} messages)… ${Math.round((i / morceaux) * 100)} %. Gardez cette fenêtre ouverte.`);
    await api.deposerMorceauHistorique(canal, i, c.versBase64(scelle.subarray(i * HISTORIQUE.morceau, (i + 1) * HISTORIQUE.morceau)));
  }
  await api.finirHistorique(canal, { morceaux, cle: c.versBase64(c.scellerCleHistorique(cleLiaison, canal, cle)) });
  return messages.length;
}

/** Receveur : attend l'archive du donneur, la télécharge, l'ouvre et la range. Null si rien n'arrive. */
async function recevoirHistorique(canal: string, cleLiaison: Uint8Array, messagerie: Messagerie, { etape, signal }: Suivi): Promise<number | null> {
  const c = await bibliotheque();
  etape("Cet appareil est relié. En attente de l'historique de l'autre appareil…");
  let etat: EtatHistorique = await api.etatHistorique(canal);
  let deposes = etat.deposes;
  let progres = Date.now();
  while (etat.etat === "attente") {
    if (Date.now() - progres > ATTENTE_HISTORIQUE) return null;
    await pause(INTERVALLE, signal);
    etat = await api.etatHistorique(canal);
    if (etat.deposes !== deposes) {
      deposes = etat.deposes;
      progres = Date.now();
      etape("Cet appareil est relié. L'autre appareil envoie l'historique…");
    }
  }
  if (!etat.morceaux || !etat.cle) return 0;
  const parties: Uint8Array[] = [];
  for (let i = 0; i < etat.morceaux; i++) {
    etape(`Téléchargement de l'historique… ${Math.round((i / etat.morceaux) * 100)} %`);
    parties.push(c.depuisBase64(await api.morceauHistorique(canal, i)));
  }
  const cle = c.ouvrirCleHistorique(cleLiaison, canal, c.depuisBase64(etat.cle));
  const archive = lireArchive(JSON.parse(await decompresser(await c.dechiffrerOctets(c.assembler(...parties), cle))));
  etape(`Rangement de ${nombre(archive.messages.length)} messages…`);
  await messagerie.importerHistorique(archive);
  await api.supprimerHistorique(canal).catch(() => undefined);
  // Le nombre transmis, comme l'annonce l'autre appareil (certains étaient peut-être déjà là).
  return archive.messages.length;
}

/** Les clés sont passées : un historique qui échoue ne défait pas la liaison. */
async function sansEchec(transfert: Promise<number | null>): Promise<number | null> {
  try {
    return await transfert;
  } catch (e) {
    if (estAnnulation(e)) throw e;
    return null;
  }
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

  async function poursuivre({ etape, signal }: Suivi): Promise<FinLiaison> {
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
      return { autre: lu.autre, historique: await sansEchec(recevoirHistorique(canal, cle, messagerie, { etape, signal })) };
    }
    etape(`Transmission des clés à ${lu.autre ?? "l'autre appareil"}…`);
    await api.deposerCles(canal, c.versBase64(c.scellerIdentite(cle, canal, await identiteADonner(messagerie))));
    etape("Clés transmises. L'autre appareil termine la liaison…");
    const { autre } = await attendre(canal, (e) => e.etat === "termine", signal);
    return { autre, historique: await sansEchec(envoyerHistorique(canal, cle, messagerie, etape)) };
  }

  return { texte: c.encoderCode(code), expireLe, poursuivre };
}

/** Cet appareil a lu (ou collé) le code affiché par l'autre. */
export async function lireCode(texte: string, role: RoleLiaison, messagerie: Messagerie, { etape, signal }: Suivi): Promise<FinLiaison> {
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
    const { autre } = await attendre(code.canal, (e) => e.etat === "termine", signal);
    return { autre, historique: await sansEchec(envoyerHistorique(code.canal, cle, messagerie, etape)) };
  }

  etape("Code lu. En attente des clés de l'autre appareil…");
  const premier = await api.repondreLiaison(code.canal, reponse);
  const avecCles = premier.cles ? premier : await attendre(code.canal, (e) => Boolean(e.cles), signal);
  etape("Clés reçues. Inscription de cet appareil…");
  const identite = c.ouvrirIdentite(cle, code.canal, c.depuisBase64(avecCles.cles!));
  await verifierCompte(identite);
  await messagerie.relier(code.canal, identite);
  return { autre: avecCles.autre, historique: await sansEchec(recevoirHistorique(code.canal, cle, messagerie, { etape, signal })) };
}
