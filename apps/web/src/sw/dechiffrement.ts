import {
  dechiffrer,
  depuisBase64,
  exigencesOuverture,
  octetsVersTexte,
  ouvrir,
  texteVersOctets,
  type CleSignee,
  type CleUnique,
  type Correspondant,
  type IdentitePrivee,
} from "@unichat/chiffrement";
import { associeContenu, schemaContenuMessage, type ContenuNotification } from "@unichat/shared";
import { resumeMessage } from "../lib/format";

/**
 * Déchiffrement d'une notification par le service worker (étape 3, lot 6),
 * construit à part (vite.sw.config.ts) et chargé par public/sw.js.
 *
 * Lecture seule : l'état des sessions est lu, jamais réécrit. Quand la page
 * s'ouvrira, elle déchiffrera le même message depuis le même état ; rien ne
 * se désynchronise, même si elle ne s'ouvre jamais.
 */

function ouvrirBase(nom: string): Promise<IDBDatabase | null> {
  return new Promise((resoudre) => {
    const demande = indexedDB.open(nom);
    // Base absente : on n'en crée surtout pas une vide, l'application la créera elle-même.
    demande.onupgradeneeded = () => demande.transaction?.abort();
    demande.onsuccess = () => resoudre(demande.result);
    demande.onerror = () => resoudre(null);
    demande.onblocked = () => resoudre(null);
  });
}

function lire<T>(db: IDBDatabase, magasin: string, cle: string): Promise<T | undefined> {
  return new Promise((resoudre) => {
    try {
      const demande = db.transaction(magasin, "readonly").objectStore(magasin).get(cle);
      demande.onsuccess = () => resoudre(demande.result as T | undefined);
      demande.onerror = () => resoudre(undefined);
    } catch {
      resoudre(undefined);
    }
  });
}

type Range = Parameters<typeof resumeMessage>[0];

async function texteDuMessage(donnees: ContenuNotification): Promise<string | null> {
  const c = donnees.chiffre;
  if (!c || !donnees.pour) return null;
  const db = await ouvrirBase(`unichat-${donnees.pour}`);
  if (!db) return null;
  try {
    // La page l'a déjà ouvert : son texte est rangé.
    const range = await lire<Range>(db, "messages", c.id);
    if (range && !range.indechiffrable) return resumeMessage(range);

    const [identite, appareil, signees] = await Promise.all([
      lire<IdentitePrivee>(db, "cles", "identite"),
      lire<{ numero: number | null }>(db, "cles", "appareil"),
      lire<CleSignee[]>(db, "cles", "signees"),
    ]);
    if (!identite || !appareil?.numero) return null;
    const message = depuisBase64(c.cle);
    const exigences = exigencesOuverture(message);
    const unique = exigences?.cleUniqueId ? await lire<CleUnique>(db, "cles", `unique:${exigences.cleUniqueId}`) : undefined;
    const correspondant = await lire<Correspondant>(db, "cles", `correspondant:${c.de}:${c.deAppareil}`);
    // Le nouvel état de la session est laissé de côté : la page le recalculera.
    const { clair } = dechiffrer(correspondant, message, {
      identite,
      cleSignee: (id) => signees?.find((s) => s.id === id),
      cleUnique: (id) => (unique?.id === id ? unique : undefined),
    });
    if (octetsVersTexte(clair.slice(32)) !== c.id) return null;
    const ouvert = ouvrir(clair.slice(0, 32), depuisBase64(c.corps), texteVersOctets(associeContenu(c.id, c.conversation, c.de)));
    const contenu = schemaContenuMessage.safeParse(JSON.parse(octetsVersTexte(ouvert)));
    return contenu.success ? resumeMessage(contenu.data) : null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/** Texte d'un message chiffré joint à une notification, ou null : la notification garde alors son texte générique. */
async function dechiffrerNotification(donnees: ContenuNotification): Promise<string | null> {
  const tache = () => texteDuMessage(donnees);
  // Lecture partagée : on attend qu'un onglet ait fini de faire avancer une session.
  return navigator.locks && donnees.pour ? await navigator.locks.request(`unichat-cles-${donnees.pour}`, { mode: "shared" }, tache) : tache();
}

(globalThis as unknown as { dechiffrerNotification: typeof dechiffrerNotification }).dechiffrerNotification = dechiffrerNotification;
