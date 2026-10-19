import { CLE_SIGNEE, CLES_UNIQUES, type CleSigneeTransport, type EtatCles, type IdentiteCles, type InscriptionCles } from "@unichat/shared";
import type { CleSignee, CleUnique, IdentitePrivee } from "@unichat/chiffrement";
import { ErreurApi, api } from "./api";
import type { Stockage } from "./stockage";

/**
 * Clés de cet appareil (chiffrement de bout en bout, étape 3).
 *
 * - « pret » : l'appareil est inscrit dans l'annuaire avec ses clés.
 * - « a-relier » : le compte a déjà une identité, créée sur un autre
 *   appareil ; celui-ci devra lui être relié pour la recevoir.
 * - « indisponible » : l'annuaire n'a pas répondu, on réessaiera.
 */
export type EtatChiffrement = "preparation" | "pret" | "a-relier" | "indisponible";

/** L'appareil tel qu'il se connaît : son numéro (null tant que l'inscription n'a pas abouti) et son jeton de reprise. */
interface AppareilLocal {
  numero: number | null;
  jeton: Uint8Array;
}

// Chargé à la demande : le chiffrement ne retarde pas l'ouverture de l'application.
const bibliotheque = () => import("@unichat/chiffrement");

const versTransport = async (i: IdentitePrivee): Promise<IdentiteCles> => {
  const { versBase64 } = await bibliotheque();
  return { signature: versBase64(i.signature.publique), echange: versBase64(i.echange.publique), preuve: versBase64(i.preuve) };
};

async function signeeTransport(c: CleSignee): Promise<CleSigneeTransport> {
  const { versBase64 } = await bibliotheque();
  return { id: c.id, cle: versBase64(c.paire.publique), signature: versBase64(c.signature) };
}

async function memeIdentite(locale: IdentitePrivee, distante: IdentiteCles): Promise<boolean> {
  const t = await versTransport(locale);
  return t.signature === distante.signature && t.echange === distante.echange;
}

/**
 * Un seul onglet à la fois touche aux clés : deux onglets ouverts ensemble
 * créeraient chacun une identité, et l'un écraserait celle de l'autre.
 */
async function sousVerrou<T>(moi: string, tache: () => Promise<T>): Promise<T> {
  return navigator.locks ? await navigator.locks.request(`unichat-cles-${moi}`, tache) : tache();
}

export const preparerCles = (db: Stockage, moi: string) => sousVerrou(moi, () => preparer(db));

/** Identité du compte, pour la transmettre à un appareil qu'on relie. */
export const identiteLocale = async (db: Stockage) => (await db.get("cles", "identite")) as IdentitePrivee | undefined;

/** Appareil relié : il range l'identité reçue et s'inscrit au nom de la liaison. */
export function relierCles(db: Stockage, moi: string, canal: string, identite: IdentitePrivee): Promise<EtatChiffrement> {
  return sousVerrou(moi, async (): Promise<EtatChiffrement> => {
    const { appareil, jeton } = await ranger(db, identite);
    const etat = await api.relierAppareil(canal, appareil);
    await db.put("cles", { numero: etat.appareil!.numero, jeton } satisfies AppareilLocal, "appareil");
    return "pret";
  });
}

/** Plus d'autre appareil pour transmettre l'identité : celui-ci en crée une nouvelle. */
export function reinitialiserCles(db: Stockage, moi: string): Promise<EtatChiffrement> {
  return sousVerrou(moi, async (): Promise<EtatChiffrement> => {
    const identite = (await bibliotheque()).creerIdentite();
    const { appareil, jeton } = await ranger(db, identite);
    const etat = await api.reinitialiserCles({ identite: await versTransport(identite), appareil });
    await db.put("cles", { numero: etat.appareil!.numero, jeton } satisfies AppareilLocal, "appareil");
    return "pret";
  });
}

async function preparer(db: Stockage): Promise<EtatChiffrement> {
  let etat: EtatCles;
  try {
    etat = await api.etatCles();
  } catch (erreur) {
    if (erreur instanceof ErreurApi && erreur.statut === 401) throw erreur;
    return "indisponible";
  }
  const identite = (await db.get("cles", "identite")) as IdentitePrivee | undefined;
  const appareil = (await db.get("cles", "appareil")) as AppareilLocal | undefined;
  const reconnue = identite && etat.identite ? await memeIdentite(identite, etat.identite) : false;

  if (etat.appareil) {
    if (!identite || !appareil || !reconnue) return "a-relier";
    // Inscription dont la réponse s'était perdue : on reprend le numéro attribué.
    if (appareil.numero === null) await db.put("cles", { ...appareil, numero: etat.appareil.numero }, "appareil");
    else if (appareil.numero !== etat.appareil.numero) return "a-relier";
    await entretenir(db, identite, etat.appareil);
    return "pret";
  }

  if (!etat.identite) return inscrire(db, identite ?? (await bibliotheque()).creerIdentite());

  if (identite && reconnue && appareil?.numero) {
    const { versBase64 } = await bibliotheque();
    try {
      const reprise = await api.reprendreCles(appareil.numero, versBase64(appareil.jeton));
      if (reprise.appareil) await entretenir(db, identite, reprise.appareil);
      return "pret";
    } catch (erreur) {
      if (erreur instanceof ErreurApi && erreur.code === "appareil_inconnu") return "a-relier";
      if (erreur instanceof ErreurApi && erreur.statut === 401) throw erreur;
      return "indisponible";
    }
  }
  return "a-relier";
}

/**
 * Clés neuves de l'appareil pour une identité : clé signée, réserve de clés
 * uniques, jeton de reprise. Tout l'ancien contenu du trousseau part : il
 * appartenait à une autre identité, ou à un essai qui n'a pas abouti.
 * Rangé avant l'envoi : si la réponse se perd, l'appareil retrouvera sa place.
 */
async function ranger(db: Stockage, identite: IdentitePrivee): Promise<{ appareil: InscriptionCles["appareil"]; jeton: Uint8Array }> {
  const c = await bibliotheque();
  const signee = c.creerCleSignee(identite, 1, Date.now());
  const uniques = c.creerClesUniques(1, CLES_UNIQUES.lot);
  const jeton = c.aleatoire(32);
  const tx = db.transaction("cles", "readwrite");
  await tx.store.clear();
  await tx.store.put(identite, "identite");
  await tx.store.put({ numero: null, jeton } satisfies AppareilLocal, "appareil");
  await tx.store.put([signee], "signees");
  await tx.store.put(CLES_UNIQUES.lot + 1, "prochaine-unique");
  for (const u of uniques) await tx.store.put(u, `unique:${u.id}`);
  await tx.done;
  return {
    jeton,
    appareil: {
      cleSignee: await signeeTransport(signee),
      clesUniques: uniques.map((u) => ({ id: u.id, cle: c.versBase64(u.paire.publique) })),
      jeton: c.versBase64(jeton),
    },
  };
}

/** Premier appareil du compte : identité, clé signée, réserve de clés uniques. */
async function inscrire(db: Stockage, identite: IdentitePrivee): Promise<EtatChiffrement> {
  const { appareil, jeton } = await ranger(db, identite);
  try {
    const etat = await api.inscrireCles({ identite: await versTransport(identite), appareil });
    await db.put("cles", { numero: etat.appareil!.numero, jeton } satisfies AppareilLocal, "appareil");
    return "pret";
  } catch (erreur) {
    // Un autre appareil a créé l'identité du compte entre-temps.
    if (erreur instanceof ErreurApi && erreur.code === "identite_existante") return "a-relier";
    if (erreur instanceof ErreurApi && erreur.statut === 401) throw erreur;
    return "indisponible";
  }
}

/** Réserve de clés uniques refaite sous le seuil, clé signée renouvelée chaque mois. */
async function entretenir(db: Stockage, identite: IdentitePrivee, serveur: NonNullable<EtatCles["appareil"]>): Promise<void> {
  const c = await bibliotheque();
  try {
    if (serveur.clesUniques < CLES_UNIQUES.seuil) {
      const premier = ((await db.get("cles", "prochaine-unique")) as number | undefined) ?? 1;
      const uniques: CleUnique[] = c.creerClesUniques(premier, CLES_UNIQUES.lot);
      const tx = db.transaction("cles", "readwrite");
      for (const u of uniques) await tx.store.put(u, `unique:${u.id}`);
      await tx.store.put(premier + CLES_UNIQUES.lot, "prochaine-unique");
      await tx.done;
      await api.ajouterClesUniques(uniques.map((u) => ({ id: u.id, cle: c.versBase64(u.paire.publique) })));
    }

    const maintenant = Date.now();
    let signees = ((await db.get("cles", "signees")) as CleSignee[] | undefined) ?? [];
    let derniere = signees.at(-1);
    if (!derniere || maintenant - derniere.creeeLe > CLE_SIGNEE.renouvellement) {
      derniere = c.creerCleSignee(identite, (derniere?.id ?? 0) + 1, maintenant);
      signees = [...signees, derniere];
    }
    // Les anciennes restent le temps que les sessions ouvertes avec elles arrivent.
    signees = signees.filter((s, i) => i >= signees.length - 2 || maintenant - s.creeeLe < CLE_SIGNEE.conservation);
    await db.put("cles", signees, "signees");
    if (derniere.id > serveur.cleSigneeId) await api.publierCleSignee(await signeeTransport(derniere));
  } catch (erreur) {
    // Hors connexion : la réserve est encore suffisante, on refera au prochain démarrage.
    if (erreur instanceof ErreurApi && erreur.statut === 401) throw erreur;
  }
}
