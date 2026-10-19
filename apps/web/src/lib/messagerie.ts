import {
  DELAI_MODIFICATION,
  EPINGLES_MESSAGES_MAX,
  FERMETURE_SESSION,
  LIMITE_EXTRAIT,
  MESSAGES_SIGNALES,
  autreParticipant,
  estGroupe,
  idGroupe,
  type CarteProfil,
  type Citation,
  type ContenuAction,
  type ContenuMessage,
  type EnveloppeChiffree,
  type Entree,
  type Groupe,
  type MessageClient,
  type MessageServeur,
  type ApercuLien,
  type Position,
  type Preference,
  type Sondage,
  type Reaction,
} from "@unichat/shared";
import { ErreurApi, api } from "./api";
import { Chiffreur } from "./chiffrement";
import { identiteLocale, preparerCles, reinitialiserCles, relierCles, type EtatChiffrement } from "./cles";
import type { IdentitePrivee } from "@unichat/chiffrement";
import { retirerMedia, telechargerMedia, transfererMedia } from "./api-medias";
import { heureCourte, resumeMessage } from "./format";
import { activerPush, montrerNotification, pushActif } from "./notifications";
import { envoyerParMorceaux, type FichierPrepare } from "./medias";
import {
  ouvrirStockage,
  plageConversation,
  type ConversationLocale,
  type Epingle,
  type EtatMessage,
  type MessageLocal,
  type Stockage,
  type TransactionMessages,
} from "./stockage";

export type EtatConnexion = "connexion" | "connecte" | "hors-ligne";

export interface Presence {
  enLigne: boolean;
  vuLe: number | null;
}

export interface Instantane {
  connexion: EtatConnexion;
  conversations: ConversationLocale[];
  personnes: Record<string, CarteProfil>;
  groupes: Record<string, Groupe>;
  /** Discussion → qui écrit, et jusqu'à quand afficher l'indication. */
  ecrit: Record<string, { de: string; fin: number }>;
  presences: Record<string, Presence>;
  /** Incrémenté à chaque changement d'une discussion : la vue relit ses messages. */
  versions: Record<string, number>;
  /** Fichiers en cours d'envoi : message → part envoyée (0 à 1). */
  envois: Record<string, number>;
  /** Clés de chiffrement de cet appareil. */
  chiffrement: EtatChiffrement;
}

const RANG: Record<EtatMessage, number> = { echec: -1, attente: 0, envoye: 1, remis: 2, lu: 3 };
const plusAvance = (a: EtatMessage | undefined, b: EtatMessage): EtatMessage =>
  a && RANG[a] >= RANG[b] ? a : b;

const DUREE_ECRIT = 5000;
const INTERVALLE_PING = 25_000;

/**
 * Entrée prête à appliquer : les enveloppes chiffrées sont ouvertes (et
 * deviennent les entrées en clair qu'elles portaient), écartées, ou
 * marquées illisibles sur cet appareil.
 */
type EntreeLocale =
  | Exclude<Entree, { type: "chiffre" }>
  | { seq: number; type: "ignore" }
  | { seq: number; type: "illisible"; message: { id: string; conversation: string; de: string; a: string; le: number } };

/** Ce qui part chiffré d'un message : tout sauf l'enveloppe (identifiant, auteur, heure), que voit le serveur. */
function contenuMessage(m: MessageLocal): ContenuMessage {
  const f = m.media;
  return {
    v: 1,
    texte: m.texte,
    ...(f
      ? {
          media: {
            id: f.id,
            type: f.type,
            mime: f.mime,
            nom: f.nom,
            taille: f.taille,
            ...(f.largeur ? { largeur: f.largeur } : {}),
            ...(f.hauteur ? { hauteur: f.hauteur } : {}),
            ...(f.duree !== undefined ? { duree: f.duree } : {}),
            ...(f.apercu ? { apercu: f.apercu } : {}),
            ...(f.vocal ? { vocal: true } : {}),
            ...(f.vueUnique ? { vueUnique: true } : {}),
          },
        }
      : {}),
    ...(m.reponseA ? { reponseA: { id: m.reponseA.id, de: m.reponseA.de, extrait: m.reponseA.extrait } } : {}),
    ...(m.transfere ? { transfere: m.transfere } : {}),
    ...(m.lien ? { lien: m.lien } : {}),
    ...(m.ephemere ? { ephemere: m.ephemere } : {}),
    ...(m.position ? { position: m.position } : {}),
    ...(m.contact ? { contact: { id: m.contact.id, nom: m.contact.nom, pseudo: m.contact.pseudo } } : {}),
    ...(m.sondage ? { sondage: m.sondage } : {}),
  };
}

/** Une action déchiffrée redevient l'entrée qu'elle aurait été en clair : la suite la traite pareil. */
function versEntreeAction(seq: number, e: EnveloppeChiffree, a: ContenuAction): EntreeLocale {
  const commun = { seq, conversation: e.conversation, par: e.de, le: e.le };
  switch (a.action) {
    case "reaction":
      return { ...commun, type: "reaction", message: a.message, code: a.code };
    case "suppression":
      return { ...commun, type: "suppression", message: a.message };
    case "modification":
      return { ...commun, type: "modification", message: a.message, texte: a.texte.trim() };
    case "epingle":
      return { ...commun, type: "epingle", message: a.message, jusqua: a.jusqua };
    case "vote":
      return { ...commun, type: "vote", message: a.message, choix: [...new Set(a.choix)] };
    case "ephemere":
      return { ...commun, type: "ephemere", duree: a.duree };
    case "ouvert":
      return { ...commun, type: "ouvert", message: a.message };
  }
}

/** Les épinglées d'abord, puis la plus récente en haut. */
function trier(conversations: ConversationLocale[]): ConversationLocale[] {
  return [...conversations].sort(
    (a, b) =>
      Number(Boolean(b.reglages?.epingle)) - Number(Boolean(a.reglages?.epingle)) ||
      (b.dernier?.le ?? b.videeLe ?? 0) - (a.dernier?.le ?? a.videeLe ?? 0),
  );
}

export const estMuette = (c: ConversationLocale, maintenant = Date.now()) => (c.reglages?.muetJusqua ?? 0) > maintenant;

/** Épingles au plus, comme dans WhatsApp : au-delà, l'épingle ne distingue plus rien. */
export const EPINGLES_MAX = 3;

/**
 * Messagerie de l'appareil : connexion temps réel, historique local et file
 * des envois. Tout passe par le stockage local d'abord ; le réseau ne fait
 * que synchroniser. Un message écrit hors connexion part au retour du réseau.
 */
export class Messagerie {
  private db!: Stockage;
  private chiffreur!: Chiffreur;
  /** Envois chiffrés en attente de réponse : rechiffrés si la liste d'appareils a changé. */
  private readonly envoisChiffres = new Map<string, { tentatives: number; relancer: () => Promise<void> }>();
  private ws: WebSocket | null = null;
  private seq: number | null = null;
  private tentative = 0;
  private arretee = false;
  private minuterieReconnexion: ReturnType<typeof setTimeout> | null = null;
  private minuterieAccuse: ReturnType<typeof setTimeout> | null = null;
  private minuteriePing: ReturnType<typeof setInterval> | null = null;
  private minuterieEphemeres: ReturnType<typeof setInterval> | null = null;
  private readonly auditeurs = new Set<() => void>();
  private readonly personnesDemandees = new Set<string>();
  private readonly groupesDemandes = new Set<string>();
  private readonly dernierEcrit = new Map<string, number>();
  /** Accusés de lecture à envoyer, gardés tant que la connexion est coupée. */
  private readonly lusEnAttente = new Map<string, { conversation: string; auteur: string; ids: Set<string> }>();
  /** Réglages de discussion faits hors connexion, envoyés à mes autres appareils au retour du réseau. */
  private readonly preferencesEnAttente = new Map<string, Preference>();
  private ouverte: string | null = null;
  /** Appelé quand on clique sur une notification. */
  surOuverture: ((conversation: string) => void) | null = null;

  private etat: Instantane = {
    connexion: "connexion",
    conversations: [],
    personnes: {},
    groupes: {},
    ecrit: {},
    presences: {},
    versions: {},
    envois: {},
    chiffrement: "preparation",
  };

  constructor(
    readonly moi: string,
    private readonly surSessionFermee: () => void,
  ) {}

  // --- Abonnement (useSyncExternalStore) --------------------------------------

  abonner = (auditeur: () => void) => {
    this.auditeurs.add(auditeur);
    return () => {
      this.auditeurs.delete(auditeur);
    };
  };

  instantane = () => this.etat;

  private publier(changement: Partial<Instantane>): void {
    this.etat = { ...this.etat, ...changement };
    for (const auditeur of this.auditeurs) auditeur();
  }

  get connecte(): boolean {
    return this.etat.connexion === "connecte";
  }

  // --- Cycle de vie -----------------------------------------------------------------

  async demarrer(): Promise<void> {
    this.db = await ouvrirStockage(this.moi);
    this.chiffreur = new Chiffreur(this.db, this.moi);
    this.seq = ((await this.db.get("reglages", "seq")) as number | undefined) ?? null;
    const [conversations, personnes, groupes] = await Promise.all([
      this.db.getAll("conversations"),
      this.db.getAll("personnes"),
      this.db.getAll("groupes"),
    ]);
    this.publier({
      conversations: trier(conversations),
      personnes: Object.fromEntries(personnes.map((p) => [p.id, p])),
      groupes: Object.fromEntries(groupes.map((g) => [g.id, g])),
    });
    this.mettreAJourTitre();
    await this.signalerEnvoisInterrompus();
    await this.effacerEphemeres();
    this.minuterieEphemeres = setInterval(() => void this.effacerEphemeres(), 5 * 60_000);
    // Les profils en cache s'affichent tout de suite, puis sont rafraîchis.
    for (const c of conversations) {
      if (estGroupe(c.id)) void this.chargerGroupe(c.autre, true);
      else void this.chargerPersonne(c.autre, true);
    }
    window.addEventListener("online", this.surRetourReseau);
    this.connecter();
    void activerPush();
    void this.preparerCles();
  }

  /** Clés de l'appareil : inscrites, reprises ou entretenues ; refait au retour du réseau si besoin. */
  private async preparerCles(): Promise<void> {
    try {
      const chiffrement = await preparerCles(this.db, this.moi);
      if (!this.arretee) this.publier({ chiffrement });
    } catch (erreur) {
      // Session perdue : la connexion temps réel la signale de son côté.
      if (!(erreur instanceof ErreurApi && erreur.statut === 401) && !this.arretee) this.publier({ chiffrement: "indisponible" });
    }
  }

  /** Identité du compte, quand cet appareil la détient (pour relier un autre appareil). */
  identite(): Promise<IdentitePrivee | undefined> {
    return identiteLocale(this.db);
  }

  /** Identité reçue d'un appareil relié : cet appareil s'inscrit avec elle. */
  async relier(canal: string, identite: IdentitePrivee): Promise<void> {
    this.publier({ chiffrement: await relierCles(this.db, this.moi, canal, identite) });
  }

  /** Nouvelles clés pour le compte : les autres appareils devront être reliés à celui-ci. */
  async reinitialiserCles(): Promise<void> {
    this.publier({ chiffrement: await reinitialiserCles(this.db, this.moi) });
  }

  arreter(): void {
    this.arretee = true;
    window.removeEventListener("online", this.surRetourReseau);
    for (const m of [this.minuterieReconnexion, this.minuterieAccuse]) if (m) clearTimeout(m);
    if (this.minuteriePing) clearInterval(this.minuteriePing);
    if (this.minuterieEphemeres) clearInterval(this.minuterieEphemeres);
    this.ws?.close(1000);
    this.ws = null;
    this.db?.close();
    document.title = "UniChat";
  }

  private surRetourReseau = () => {
    if (!this.ws) {
      this.tentative = 0;
      this.planifierReconnexion(0);
    }
  };

  // --- Connexion --------------------------------------------------------------------

  private connecter(): void {
    if (this.arretee) return;
    this.publier({ connexion: "connexion" });
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/temps-reel`);
    this.ws = ws;
    ws.onopen = () => {
      this.tentative = 0;
      this.brut({ t: "bonjour", depuis: this.seq });
      if (this.minuteriePing) clearInterval(this.minuteriePing);
      // Maintien de connexion : le serveur répond sans se réveiller.
      this.minuteriePing = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('{"t":"ping"}'), INTERVALLE_PING);
    };
    ws.onmessage = (e) => {
      try {
        void this.recevoir(JSON.parse(String(e.data)) as MessageServeur);
      } catch {
        // Message illisible : ignoré.
      }
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.minuteriePing) clearInterval(this.minuteriePing);
      if (this.arretee) return;
      this.publier({ connexion: "hors-ligne" });
      if (e.code === FERMETURE_SESSION) {
        this.surSessionFermee();
        return;
      }
      const delai = Math.min(30_000, 1000 * 2 ** this.tentative) + Math.random() * 500;
      this.tentative += 1;
      this.planifierReconnexion(delai);
    };
  }

  private planifierReconnexion(delai: number): void {
    if (this.minuterieReconnexion) clearTimeout(this.minuterieReconnexion);
    this.minuterieReconnexion = setTimeout(async () => {
      // Un échec d'ouverture ne dit pas pourquoi : on vérifie d'abord la
      // session (ce qui renouvelle aussi le cookie si nécessaire).
      try {
        await api.moi();
      } catch (erreur) {
        if (erreur instanceof ErreurApi && erreur.statut === 401) {
          this.surSessionFermee();
          return;
        }
      }
      this.connecter();
    }, delai);
  }

  private brut(m: MessageClient): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(m));
    return true;
  }

  // --- Réception ---------------------------------------------------------------------

  private async recevoir(m: MessageServeur): Promise<void> {
    switch (m.t) {
      case "lot":
        await this.appliquer(await this.ouvrirEnveloppes(m.entrees));
        if (!m.fin) {
          this.brut({ t: "bonjour", depuis: this.seq });
          return;
        }
        this.publier({ connexion: "connecte" });
        if (this.etat.chiffrement === "indisponible") void this.preparerCles();
        await this.renvoyerEnAttente();
        if (this.ouverte && !estGroupe(this.ouverte)) this.demanderPresence(autreParticipant(this.ouverte, this.moi));
        return;
      case "entree":
        await this.appliquer(await this.ouvrirEnveloppes([m.entree]));
        return;
      case "accepte":
        this.envoisChiffres.delete(m.id);
        await this.modifierMessage(m.id, (msg) => {
          const accepte = { ...msg, le: m.le, attendus: m.destinataires, erreur: undefined };
          return { ...accepte, etat: plusAvance(msg.etat === "echec" ? "attente" : msg.etat, this.etatDeMonMessage(accepte)) };
        });
        return;
      case "refuse": {
        // Appareils de la discussion changés depuis la dernière liste : on rechiffre pour les bons.
        const envoi = m.id ? this.envoisChiffres.get(m.id) : undefined;
        if (envoi && m.code === "appareils" && envoi.tentatives < 2) {
          envoi.tentatives += 1;
          this.chiffreur.oublier(Object.keys(m.appareils ?? {}));
          void envoi.relancer();
          return;
        }
        if (m.id) this.envoisChiffres.delete(m.id);
        if (m.code === "non_relie") void this.preparerCles();
        if (m.id) await this.modifierMessage(m.id, (msg) => ({ ...msg, etat: "echec", erreur: m.message }));
        return;
      }
      case "ecrit":
        this.publier({ ecrit: { ...this.etat.ecrit, [m.conversation]: { de: m.de, fin: Date.now() + DUREE_ECRIT } } });
        setTimeout(() => {
          const indication = this.etat.ecrit[m.conversation];
          if (indication && indication.fin <= Date.now()) {
            const { [m.conversation]: _, ...reste } = this.etat.ecrit;
            this.publier({ ecrit: reste });
          }
        }, DUREE_ECRIT + 50);
        return;
      case "presence":
        this.publier({ presences: { ...this.etat.presences, [m.de]: { enLigne: m.enLigne, vuLe: m.vuLe } } });
        return;
    }
  }

  /** État d'un de mes messages : dans un groupe, « remis » et « lu » une fois tous les membres atteints. */
  private etatDeMonMessage(msg: MessageLocal): EtatMessage {
    if (!estGroupe(msg.conversation)) return "envoye";
    const groupe = this.etat.groupes[idGroupe(msg.conversation)];
    const attendus = msg.attendus ?? (groupe ? Math.max(0, groupe.membres.length - 1) : 0);
    if (attendus === 0) return "envoye";
    if ((msg.luPar?.length ?? 0) >= attendus) return "lu";
    if ((msg.remisPar?.length ?? 0) >= attendus) return "remis";
    return "envoye";
  }

  /**
   * Ouvre les enveloppes chiffrées d'un lot. Un message déjà lu sur cet
   * appareil (journal rejoué, autre onglet) n'est pas déchiffré deux fois :
   * sa clé de message n'existe plus.
   */
  private async ouvrirEnveloppes(entrees: Entree[]): Promise<EntreeLocale[]> {
    const enveloppes = entrees.flatMap((e) => (e.type === "chiffre" ? [e.enveloppe] : []));
    if (enveloppes.length === 0) return entrees as EntreeLocale[];
    const dejaLus = new Set<string>();
    for (const e of enveloppes) {
      if (e.genre !== "message") continue;
      const existant = await this.db.get("messages", e.id);
      if (existant && !existant.indechiffrable) dejaLus.add(e.id);
    }
    const resultats = await this.chiffreur.dechiffrerLot(enveloppes.filter((e) => !dejaLus.has(e.id)));
    return entrees.map((e): EntreeLocale => {
      if (e.type !== "chiffre") return e;
      const env = e.enveloppe;
      const r = dejaLus.has(env.id) ? undefined : resultats.get(env.id);
      if (!r || r.type === "ignore") return { seq: e.seq, type: "ignore" };
      if (r.type === "illisible") {
        return env.genre === "message"
          ? { seq: e.seq, type: "illisible", message: { id: env.id, conversation: env.conversation, de: env.de, a: env.a, le: env.le } }
          : { seq: e.seq, type: "ignore" };
      }
      if (r.type === "action") return versEntreeAction(e.seq, env, r.contenu);
      const c = r.contenu;
      return {
        seq: e.seq,
        type: "message",
        message: {
          id: env.id,
          conversation: env.conversation,
          de: env.de,
          a: env.a,
          texte: c.texte.trim(),
          le: env.le,
          ...(c.media ? { media: c.media } : {}),
          ...(c.reponseA ? { reponseA: c.reponseA } : {}),
          ...(c.transfere ? { transfere: c.transfere } : {}),
          ...(c.lien ? { lien: c.lien } : {}),
          ...(c.ephemere ? { ephemere: c.ephemere } : {}),
          ...(c.position ? { position: c.position } : {}),
          ...(c.contact ? { contact: c.contact } : {}),
          ...(c.sondage ? { sondage: c.sondage } : {}),
        },
      };
    });
  }

  private async appliquer(entrees: EntreeLocale[]): Promise<void> {
    if (entrees.length === 0) return;
    const tx = this.db.transaction(["messages", "conversations"], "readwrite");
    const messages = tx.objectStore("messages");
    const touchees = new Set<string>();
    const nouveaux: MessageLocal[] = [];
    const groupesAChanger = new Set<string>();
    const supprimes: string[] = [];
    const retirees = new Set<string>();
    const blocages: { personne: string; bloque: boolean }[] = [];

    for (const e of entrees) {
      if (e.type === "ignore") continue;
      if (e.type === "message") {
        const m = e.message;
        // Un message arrivé après la suppression de la discussion la fait revenir.
        retirees.delete(m.conversation);
        const existant = await messages.get(m.id);
        const expiration = m.ephemere ? { expireLe: m.le + m.ephemere } : {};
        if (m.de === this.moi) {
          const local: MessageLocal = { ...existant, ...m, ...expiration, type: "texte" };
          await messages.put({ ...local, etat: plusAvance(existant?.etat === "echec" ? "attente" : existant?.etat, this.etatDeMonMessage(local)) });
        } else if (!existant) {
          const local: MessageLocal = { ...m, ...expiration, type: "texte", lu: false };
          await messages.put(local);
          nouveaux.push(local);
        }
        touchees.add(m.conversation);
      } else if (e.type === "accuse") {
        for (const id of e.ids) {
          const msg = await messages.get(id);
          // Seuls mes messages de cette discussion peuvent changer d'état.
          if (!msg || msg.de !== this.moi || msg.conversation !== e.conversation) continue;
          if (estGroupe(msg.conversation)) {
            const remisPar = [...new Set([...(msg.remisPar ?? []), e.par])];
            const luPar = e.etat === "lu" ? [...new Set([...(msg.luPar ?? []), e.par])] : (msg.luPar ?? []);
            const suite = { ...msg, remisPar, luPar };
            await messages.put({ ...suite, etat: plusAvance(msg.etat, this.etatDeMonMessage(suite)) });
          } else {
            await messages.put({ ...msg, etat: plusAvance(msg.etat, e.etat) });
          }
        }
        touchees.add(e.conversation);
      } else if (e.type === "lu") {
        for (const id of e.ids) {
          const msg = await messages.get(id);
          if (msg && msg.de !== this.moi && !msg.lu) await messages.put({ ...msg, lu: true });
        }
        touchees.add(e.conversation);
      } else if (e.type === "reaction") {
        const msg = await messages.get(e.message);
        if (msg && msg.conversation === e.conversation && !msg.supprime) {
          const reactions = { ...msg.reactions };
          if (e.code) reactions[e.par] = e.code;
          else delete reactions[e.par];
          await messages.put({ ...msg, reactions });
          touchees.add(e.conversation);
        }
      } else if (e.type === "suppression") {
        const msg = await messages.get(e.message);
        // Seul l'auteur peut supprimer son message pour tout le monde.
        if (msg && msg.conversation === e.conversation && msg.de === e.par) {
          await messages.put({ ...msg, texte: "", supprime: true, reactions: {}, reponseA: undefined, media: undefined });
          supprimes.push(msg.id);
          touchees.add(e.conversation);
        }
      } else if (e.type === "modification") {
        const msg = await messages.get(e.message);
        // Seul l'auteur modifie, et seulement dans le délai : on ne fait pas confiance au seul serveur.
        if (msg && msg.conversation === e.conversation && msg.de === e.par && !msg.supprime && e.le - msg.le <= DELAI_MODIFICATION + 60_000) {
          await messages.put({ ...msg, texte: e.texte, modifieLe: e.le });
          touchees.add(e.conversation);
        }
      } else if (e.type === "epingle") {
        await this.appliquerEpingle(tx, e.conversation, { message: e.message, par: e.par, jusqua: e.jusqua, le: e.le });
        touchees.add(e.conversation);
      } else if (e.type === "important") {
        const msg = await messages.get(e.message);
        if (msg && msg.conversation === e.conversation) {
          await messages.put({ ...msg, importantLe: e.important ? e.le : undefined });
          touchees.add(e.conversation);
        }
      } else if (e.type === "ephemere") {
        const conversations = tx.objectStore("conversations");
        const existante = await conversations.get(e.conversation);
        if (existante) await conversations.put({ ...existante, ephemere: e.duree ?? undefined });
        const id = `ephemere:${e.par}:${e.le}`;
        if (!(await messages.get(id))) {
          await messages.put({
            id,
            conversation: e.conversation,
            de: e.par,
            a: "",
            texte: "",
            le: e.le,
            type: "systeme",
            systeme: { action: "ephemere", duree: e.duree },
            lu: true,
          });
        }
        touchees.add(e.conversation);
      } else if (e.type === "vote") {
        const msg = await messages.get(e.message);
        const s = msg?.sondage;
        // Un vote ne compte que s'il désigne des options du sondage, une seule s'il n'en admet qu'une.
        if (msg && s && msg.conversation === e.conversation && e.choix.every((i) => i < s.options.length) && (s.multiple || e.choix.length <= 1)) {
          const votes = { ...msg.votes };
          if (e.choix.length) votes[e.par] = e.choix;
          else delete votes[e.par];
          await messages.put({ ...msg, votes });
          touchees.add(e.conversation);
        }
      } else if (e.type === "ouvert") {
        const msg = await messages.get(e.message);
        if (msg && msg.conversation === e.conversation && msg.media?.vueUnique) {
          if (e.par === this.moi) {
            // Ouverte sur un autre de mes appareils : elle disparaît d'ici aussi.
            await messages.put({ ...msg, vueOuverte: true });
            supprimes.push(msg.id);
          } else if (msg.de === this.moi && !msg.ouvertPar?.includes(e.par)) {
            await messages.put({ ...msg, ouvertPar: [...(msg.ouvertPar ?? []), e.par] });
            // À deux, le fichier n'a plus personne à qui servir : il quitte le serveur.
            if (!estGroupe(msg.conversation) && msg.media.id) void retirerMedia(msg.media.id);
          }
          touchees.add(e.conversation);
        }
      } else if (e.type === "blocage") {
        blocages.push({ personne: e.personne, bloque: e.bloque });
      } else if (e.type === "preference") {
        const { effaces, retiree } = await this.appliquerPreference(tx, e.conversation, e.preference);
        supprimes.push(...effaces);
        if (retiree) retirees.add(e.conversation);
        touchees.add(e.conversation);
      } else if (e.type === "illisible") {
        // Pas de clé pour cet appareil (relié après l'envoi) : la place du message reste marquée.
        const m = e.message;
        retirees.delete(m.conversation);
        if (!(await messages.get(m.id))) {
          const mien = m.de === this.moi;
          const local: MessageLocal = { ...m, texte: "", type: "texte", indechiffrable: true, lu: mien, ...(mien ? { etat: "envoye" as const } : {}) };
          await messages.put(local);
          if (!mien) nouveaux.push(local);
        }
        touchees.add(m.conversation);
      } else {
        const ev = e.evenement;
        if (!(await messages.get(ev.id))) {
          await messages.put({
            id: ev.id,
            conversation: ev.conversation,
            de: ev.par,
            a: idGroupe(ev.conversation),
            texte: "",
            le: ev.le,
            type: "evenement",
            evenement: ev,
            lu: true,
          });
        }
        groupesAChanger.add(idGroupe(ev.conversation));
        touchees.add(ev.conversation);
      }
    }
    for (const c of touchees) {
      if (retirees.has(c)) await tx.objectStore("conversations").delete(c);
      else await this.recalculer(tx, c);
    }
    await tx.done;
    for (const id of supprimes) await this.db.delete("fichiers", id);
    for (const { personne, bloque } of blocages) {
      const connue = this.etat.personnes[personne];
      if (connue) this.retenirPersonne({ ...connue, bloque });
      else void this.chargerPersonne(personne, true);
    }

    this.seq = Math.max(this.seq ?? 0, ...entrees.map((e) => e.seq));
    await this.db.put("reglages", this.seq, "seq");
    this.planifierAccuse();
    // Le message est arrivé : son auteur n'est plus « en train d'écrire ».
    const ecrit = { ...this.etat.ecrit };
    let change = false;
    for (const m of nouveaux) {
      if (ecrit[m.conversation]?.de === m.de) {
        delete ecrit[m.conversation];
        change = true;
      }
    }
    if (change) this.publier({ ecrit });
    for (const g of groupesAChanger) void this.chargerGroupe(g, true);
    await this.publierConversations(touchees);
    this.notifier(nouveaux);
  }

  /** Accusé de réception groupé : une seule écriture côté serveur pour une rafale de messages. */
  private planifierAccuse(): void {
    if (this.minuterieAccuse) clearTimeout(this.minuterieAccuse);
    this.minuterieAccuse = setTimeout(() => {
      if (this.seq !== null) this.brut({ t: "recu", jusqua: this.seq });
    }, 250);
  }

  // --- Envoi --------------------------------------------------------------------------

  async envoyer(
    conversation: string,
    texte: string,
    reponseA?: MessageLocal,
    extras: { lien?: ApercuLien; mentions?: string[] } = {},
  ): Promise<void> {
    const propre = texte.trim();
    if (!propre) return;
    const groupe = estGroupe(conversation);
    const a = groupe ? idGroupe(conversation) : autreParticipant(conversation, this.moi);
    const citation: Citation | undefined =
      reponseA && !reponseA.supprime
        ? { id: reponseA.id, de: reponseA.de, extrait: resumeMessage(reponseA).slice(0, LIMITE_EXTRAIT) }
        : undefined;
    const message: MessageLocal = {
      id: crypto.randomUUID(),
      conversation,
      de: this.moi,
      a,
      texte: propre,
      le: Date.now(),
      type: "texte",
      etat: "attente",
      ...(citation ? { reponseA: citation } : {}),
      ...(extras.lien ? { lien: extras.lien } : {}),
      ...(groupe && extras.mentions?.length ? { mentions: extras.mentions } : {}),
      ...this.ephemereDe(conversation),
    };
    const tx = this.db.transaction(["messages", "conversations"], "readwrite");
    await tx.objectStore("messages").put(message);
    await this.recalculer(tx, conversation);
    await tx.done;
    await this.publierConversations(new Set([conversation]));
    this.envoyerMessage(message);
  }

  private envoyerMessage(m: MessageLocal): void {
    // Un fichier encore en route : le message partira à la fin de l'envoi.
    if (m.media && !m.media.id) return;
    void this.expedier(m);
  }

  /**
   * Discussion à deux : chiffré, si le destinataire a des clés. Une erreur
   * de chiffrement ne fait jamais partir le message en clair ; il reste à
   * renvoyer.
   */
  private async expedier(m: MessageLocal): Promise<void> {
    if (!estGroupe(m.conversation)) {
      if (!this.connecte) return;
      try {
        const enveloppe = await this.chiffreur.chiffrer(m.a, m.id, m.conversation, "message", contenuMessage(m));
        if (enveloppe) {
          this.envoisChiffres.set(m.id, { tentatives: this.envoisChiffres.get(m.id)?.tentatives ?? 0, relancer: () => this.expedier(m) });
          this.brut(enveloppe);
          return;
        }
      } catch {
        if (this.connecte) await this.modifierMessage(m.id, (x) => ({ ...x, etat: "echec", erreur: "Envoi impossible pour le moment. Réessayez." }));
        return;
      }
    }
    this.envoyerEnClair(m);
  }

  private envoyerEnClair(m: MessageLocal): void {
    const groupe = estGroupe(m.conversation);
    const media = m.media
      ? {
          id: m.media.id,
          ...(m.media.largeur ? { largeur: m.media.largeur } : {}),
          ...(m.media.hauteur ? { hauteur: m.media.hauteur } : {}),
          ...(m.media.duree !== undefined ? { duree: m.media.duree } : {}),
          ...(m.media.apercu ? { apercu: m.media.apercu } : {}),
          ...(m.media.vocal ? { vocal: true } : {}),
          ...(m.media.vueUnique ? { vueUnique: true } : {}),
        }
      : undefined;
    this.brut({
      t: "envoyer",
      id: m.id,
      ...(groupe ? { groupe: m.a } : { a: m.a }),
      texte: m.texte,
      ...(media ? { media } : {}),
      ...(m.reponseA ? { reponseA: m.reponseA } : {}),
      ...(m.transfere ? { transfere: m.transfere } : {}),
      ...(m.lien ? { lien: m.lien } : {}),
      ...(m.mentions?.length ? { mentions: m.mentions } : {}),
      ...(m.ephemere ? { ephemere: m.ephemere } : {}),
      ...(m.position ? { position: m.position } : {}),
      ...(m.contact ? { contact: { id: m.contact.id } } : {}),
      ...(m.sondage ? { sondage: m.sondage } : {}),
    });
  }

  /** Durée éphémère en vigueur : elle part avec chaque nouveau message. */
  private ephemereDe(conversation: string, le = Date.now()): { ephemere?: number; expireLe?: number } {
    const duree = this.etat.conversations.find((c) => c.id === conversation)?.ephemere;
    return duree ? { ephemere: duree, expireLe: le + duree } : {};
  }

  /** Position, fiche de contact ou sondage : un message sans texte, mais pas vide. */
  async envoyerContenu(
    conversation: string,
    contenu: { position: Position } | { contact: { id: string; nom: string; pseudo: string | null } } | { sondage: Sondage },
  ): Promise<void> {
    const groupe = estGroupe(conversation);
    const message: MessageLocal = {
      id: crypto.randomUUID(),
      conversation,
      de: this.moi,
      a: groupe ? idGroupe(conversation) : autreParticipant(conversation, this.moi),
      texte: "",
      le: Date.now(),
      type: "texte",
      etat: "attente",
      ...contenu,
      ...this.ephemereDe(conversation),
    };
    const tx = this.db.transaction(["messages", "conversations"], "readwrite");
    await tx.objectStore("messages").put(message);
    await this.recalculer(tx, conversation);
    await tx.done;
    await this.publierConversations(new Set([conversation]));
    this.envoyerMessage(message);
  }

  /**
   * Action sur une discussion (réaction, modification, suppression, épingle,
   * vote, éphémères, vue unique ouverte) : chiffrée dans une discussion à
   * deux, en clair dans un groupe (lot 4). Faux si la connexion manque.
   */
  private async agir(conversation: string, contenu: ContenuAction, enClair: MessageClient): Promise<boolean> {
    if (!this.connecte) return false;
    if (estGroupe(conversation)) return this.brut(enClair);
    const a = autreParticipant(conversation, this.moi);
    const id = crypto.randomUUID();
    const envoyer = async (): Promise<boolean> => {
      const enveloppe = await this.chiffreur.chiffrer(a, id, conversation, "action", contenu);
      if (!enveloppe) return this.brut(enClair);
      this.envoisChiffres.set(id, {
        tentatives: this.envoisChiffres.get(id)?.tentatives ?? 0,
        relancer: async () => {
          await envoyer().catch(() => false);
        },
      });
      return this.brut(enveloppe);
    };
    try {
      return await envoyer();
    } catch {
      return false;
    }
  }

  /** Messages éphémères : pour tous les participants, à partir des prochains messages. */
  reglerEphemere(conversation: string, duree: number | null): Promise<boolean> {
    return this.agir(conversation, { v: 1, action: "ephemere", duree }, { t: "ephemere", conversation, duree });
  }

  /** Voter (ou retirer son vote avec une liste vide). Affiché tout de suite, annulé si le réseau manque. */
  async voter(message: MessageLocal, choix: number[]): Promise<boolean> {
    if (!this.connecte || !message.sondage) return false;
    const avant = message.votes ?? {};
    const votes = { ...avant };
    if (choix.length) votes[this.moi] = choix;
    else delete votes[this.moi];
    await this.modifierMessage(message.id, (m) => ({ ...m, votes }));
    const choixUniques = [...new Set(choix)];
    if (
      !(await this.agir(
        message.conversation,
        { v: 1, action: "vote", message: message.id, choix: choixUniques },
        { t: "voter", conversation: message.conversation, message: message.id, choix },
      ))
    ) {
      await this.modifierMessage(message.id, (m) => ({ ...m, votes: avant }));
      return false;
    }
    return true;
  }

  /** Vue unique refermée : le fichier quitte l'appareil, l'auteur voit « Ouvert ». */
  async fermerVueUnique(message: MessageLocal): Promise<void> {
    await this.db.delete("fichiers", message.id);
    await this.modifierMessage(message.id, (m) => ({ ...m, vueOuverte: true }));
    await this.agir(
      message.conversation,
      { v: 1, action: "ouvert", message: message.id },
      { t: "ouvert", conversation: message.conversation, message: message.id, auteur: message.de },
    );
  }

  /** Messages éphémères arrivés à échéance : effacés de l'appareil (sauf ceux marqués importants). */
  private async effacerEphemeres(): Promise<void> {
    const echus = await this.db.getAllFromIndex("messages", "expire", IDBKeyRange.upperBound(Date.now()));
    const aEffacer = echus.filter((m) => !m.importantLe);
    if (aEffacer.length === 0) return;
    const tx = this.db.transaction(["messages", "conversations"], "readwrite");
    const touchees = new Set<string>();
    for (const m of aEffacer) {
      await tx.objectStore("messages").delete(m.id);
      touchees.add(m.conversation);
    }
    for (const c of touchees) await this.recalculer(tx, c);
    await tx.done;
    for (const m of aEffacer) await this.db.delete("fichiers", m.id);
    await this.publierConversations(touchees);
  }

  // --- Modifier, épingler, important, transférer ---------------------------------------

  /** Modifier un de mes messages, dans les 15 minutes. Les autres le voient « Modifié ». */
  async modifier(message: MessageLocal, texte: string): Promise<boolean> {
    const propre = texte.trim();
    if (!propre || message.de !== this.moi || message.supprime || Date.now() - message.le > DELAI_MODIFICATION) return false;
    const contenu: ContenuAction = { v: 1, action: "modification", message: message.id, texte: propre };
    if (!(await this.agir(message.conversation, contenu, { t: "modifier", conversation: message.conversation, message: message.id, texte: propre }))) return false;
    await this.modifierMessage(message.id, (m) => ({ ...m, texte: propre, modifieLe: Date.now() }));
    return true;
  }

  /** Épingler pour tous (ou désépingler avec null). Trois épingles au plus : la plus ancienne cède la place. */
  async epingler(message: MessageLocal, duree: number | null): Promise<boolean> {
    const jusqua = duree === null ? null : Date.now() + duree;
    if (
      !(await this.agir(
        message.conversation,
        { v: 1, action: "epingle", message: message.id, jusqua },
        { t: "epingler", conversation: message.conversation, message: message.id, jusqua },
      ))
    ) {
      return false;
    }
    const tx = this.db.transaction(["messages", "conversations"], "readwrite");
    await this.appliquerEpingle(tx, message.conversation, { message: message.id, par: this.moi, jusqua, le: Date.now() });
    await tx.done;
    await this.publierConversations(new Set([message.conversation]));
    return true;
  }

  private async appliquerEpingle(
    tx: TransactionMessages,
    conversation: string,
    e: { message: string; par: string; jusqua: number | null; le: number },
  ): Promise<void> {
    const conversations = tx.objectStore("conversations");
    const existante = await conversations.get(conversation);
    if (!existante) return;
    const restantes = (existante.epingles ?? []).filter((p) => p.message !== e.message && p.jusqua > Date.now());
    const epingles: Epingle[] = e.jusqua ? [...restantes, { message: e.message, par: e.par, jusqua: e.jusqua, le: e.le }] : restantes;
    await conversations.put({ ...existante, epingles: epingles.slice(-EPINGLES_MESSAGES_MAX) });
  }

  /** Important : une étoile sur le message, retrouvée dans « Messages importants » sur tous mes appareils. */
  async marquerImportant(message: MessageLocal, important: boolean): Promise<void> {
    await this.modifierMessage(message.id, (m) => ({ ...m, importantLe: important ? Date.now() : undefined }));
    this.brut({ t: "important", conversation: message.conversation, message: message.id, important });
  }

  async importants(): Promise<MessageLocal[]> {
    const tous = await this.db.getAllFromIndex("messages", "important");
    return tous.sort((a, b) => (b.importantLe ?? 0) - (a.importantLe ?? 0));
  }

  /**
   * Transférer des messages vers d'autres discussions. Un fichier n'est pas
   * renvoyé : le serveur fait pointer le nouveau message vers le même.
   * Renvoie le nombre de messages qui n'ont pas pu partir.
   */
  async transferer(sources: MessageLocal[], destinations: string[]): Promise<number> {
    let echecs = 0;
    for (const conversation of destinations) {
      const groupe = estGroupe(conversation);
      for (const source of [...sources].sort((a, b) => a.le - b.le)) {
        // Ni ligne système, ni vue unique, ni sondage (ses votes n'auraient pas de sens ailleurs).
        if (source.supprime || source.type === "evenement" || source.type === "systeme" || source.media?.vueUnique || source.sondage) continue;
        let media = source.media;
        if (media) {
          if (!media.id) {
            echecs += 1;
            continue;
          }
          try {
            media = { ...media, id: await transfererMedia(media.id, conversation) };
          } catch {
            echecs += 1;
            continue;
          }
        }
        const message: MessageLocal = {
          id: crypto.randomUUID(),
          conversation,
          de: this.moi,
          a: groupe ? idGroupe(conversation) : autreParticipant(conversation, this.moi),
          texte: source.texte,
          le: Date.now(),
          type: "texte",
          etat: "attente",
          transfere: (source.transfere ?? 0) + 1,
          ...(media ? { media } : {}),
          ...(source.position ? { position: source.position } : {}),
          ...(source.contact ? { contact: source.contact } : {}),
          ...this.ephemereDe(conversation),
        };
        const blob = media ? await this.fichierLocal(source.id) : undefined;
        if (blob) await this.db.put("fichiers", { id: message.id, blob });
        const tx = this.db.transaction(["messages", "conversations"], "readwrite");
        await tx.objectStore("messages").put(message);
        await this.recalculer(tx, conversation);
        await tx.done;
        this.envoyerMessage(message);
      }
    }
    await this.publierConversations(new Set(destinations));
    return echecs;
  }

  // --- Fichiers -------------------------------------------------------------------------

  /**
   * Envoi d'un fichier : il est gardé sur l'appareil et s'affiche tout de
   * suite ; il part par morceaux, puis le message est envoyé avec lui.
   */
  async envoyerFichier(conversation: string, f: FichierPrepare, legende: string, reponseA?: MessageLocal): Promise<void> {
    const groupe = estGroupe(conversation);
    const citation: Citation | undefined =
      reponseA && !reponseA.supprime
        ? { id: reponseA.id, de: reponseA.de, extrait: resumeMessage(reponseA).slice(0, LIMITE_EXTRAIT) }
        : undefined;
    const message: MessageLocal = {
      id: crypto.randomUUID(),
      conversation,
      de: this.moi,
      a: groupe ? idGroupe(conversation) : autreParticipant(conversation, this.moi),
      texte: legende.trim(),
      le: Date.now(),
      type: "texte",
      etat: "attente",
      media: {
        id: "",
        type: f.type,
        mime: f.mime,
        nom: f.nom,
        taille: f.blob.size,
        ...(f.largeur ? { largeur: f.largeur } : {}),
        ...(f.hauteur ? { hauteur: f.hauteur } : {}),
        ...(f.duree !== undefined ? { duree: f.duree } : {}),
        ...(f.apercu ? { apercu: f.apercu } : {}),
        ...(f.vocal ? { vocal: true } : {}),
        ...(f.vueUnique ? { vueUnique: true } : {}),
      },
      ...(citation ? { reponseA: citation } : {}),
      ...this.ephemereDe(conversation),
    };
    await this.db.put("fichiers", { id: message.id, blob: f.blob });
    const tx = this.db.transaction(["messages", "conversations"], "readwrite");
    await tx.objectStore("messages").put(message);
    await this.recalculer(tx, conversation);
    await tx.done;
    await this.publierConversations(new Set([conversation]));
    void this.televerser(message, f);
  }

  private async televerser(message: MessageLocal, f: FichierPrepare): Promise<void> {
    this.publier({ envois: { ...this.etat.envois, [message.id]: 0 } });
    try {
      const mediaId = await envoyerParMorceaux(message.conversation, f, (part) =>
        this.publier({ envois: { ...this.etat.envois, [message.id]: part } }),
      );
      await this.modifierMessage(message.id, (m) => ({ ...m, media: { ...m.media!, id: mediaId } }));
      const pret = await this.db.get("messages", message.id);
      if (pret) this.envoyerMessage(pret);
    } catch (erreur) {
      const texte = erreur instanceof ErreurApi ? erreur.message : "L'envoi du fichier a échoué.";
      await this.modifierMessage(message.id, (m) => ({ ...m, etat: "echec", erreur: texte }));
    } finally {
      const { [message.id]: _, ...reste } = this.etat.envois;
      this.publier({ envois: reste });
    }
  }

  /** Un envoi coupé par la fermeture de la page reprendra à la demande (« Réessayer »). */
  private async signalerEnvoisInterrompus(): Promise<void> {
    const enAttente = await this.db.getAllFromIndex("messages", "etat", "attente");
    for (const m of enAttente) {
      if (m.media && !m.media.id) {
        await this.modifierMessage(m.id, (x) => ({ ...x, etat: "echec", erreur: "Envoi interrompu" }));
      }
    }
  }

  /** Le fichier d'un message, s'il est déjà sur l'appareil. */
  async fichierLocal(messageId: string): Promise<Blob | undefined> {
    return (await this.db.get("fichiers", messageId))?.blob;
  }

  /** Télécharge le fichier d'un message et le garde sur l'appareil. */
  async recupererFichier(messageId: string, mediaId: string): Promise<Blob> {
    const local = await this.fichierLocal(messageId);
    if (local) return local;
    const blob = await telechargerMedia(mediaId);
    await this.db.put("fichiers", { id: messageId, blob });
    return blob;
  }

  async renvoyer(id: string): Promise<void> {
    const msg = await this.db.get("messages", id);
    if (!msg || msg.de !== this.moi || msg.etat !== "echec") return;
    await this.modifierMessage(id, (m) => ({ ...m, etat: "attente", erreur: undefined }));
    // Fichier jamais arrivé au serveur : on le renvoie depuis l'appareil.
    if (msg.media && !msg.media.id) {
      const blob = await this.fichierLocal(id);
      if (!blob) {
        await this.modifierMessage(id, (m) => ({ ...m, etat: "echec", erreur: "Fichier introuvable sur cet appareil." }));
        return;
      }
      void this.televerser(msg, { ...msg.media, blob });
      return;
    }
    this.envoyerMessage(msg);
  }

  private async renvoyerEnAttente(): Promise<void> {
    const enAttente = await this.db.getAllFromIndex("messages", "etat", "attente");
    for (const m of enAttente.sort((a, b) => a.le - b.le)) this.envoyerMessage(m);
    for (const [cle, lot] of this.lusEnAttente) {
      this.lusEnAttente.delete(cle);
      this.envoyerLus(lot.conversation, lot.auteur, [...lot.ids]);
    }
    for (const [conversation, preference] of this.preferencesEnAttente) {
      if (this.brut({ t: "preference", conversation, preference })) this.preferencesEnAttente.delete(conversation);
    }
  }

  // --- Réglages d'une discussion --------------------------------------------------------

  /**
   * Sourdine, favori, archive, épingle, effacement : appliqué ici tout de
   * suite, puis transmis à mes autres appareils (ou mis de côté hors connexion).
   */
  async regler(conversation: string, preference: Preference): Promise<void> {
    const tx = this.db.transaction(["messages", "conversations"], "readwrite");
    const { effaces, retiree } = await this.appliquerPreference(tx, conversation, preference);
    if (retiree) await tx.objectStore("conversations").delete(conversation);
    else await this.recalculer(tx, conversation);
    await tx.done;
    for (const id of effaces) await this.db.delete("fichiers", id);
    await this.publierConversations(new Set([conversation]));
    if (!this.brut({ t: "preference", conversation, preference })) {
      this.preferencesEnAttente.set(conversation, { ...this.preferencesEnAttente.get(conversation), ...preference });
    }
  }

  /** Effacer : les messages disparaissent, la discussion reste dans la liste. */
  async effacer(conversation: string): Promise<void> {
    await this.regler(conversation, { effaceAvant: await this.finDeDiscussion(conversation) });
  }

  /** Supprimer : messages effacés et discussion retirée, jusqu'au prochain message. */
  async supprimerDiscussion(conversation: string): Promise<void> {
    await this.regler(conversation, { effaceAvant: await this.finDeDiscussion(conversation), supprimee: true });
  }

  /** L'heure du dernier message, si elle dépasse l'heure locale (horloge de l'appareil en retard). */
  private async finDeDiscussion(conversation: string): Promise<number> {
    const tous = await this.messages(conversation);
    return Math.max(Date.now(), ...tous.map((m) => m.le));
  }

  private async appliquerPreference(
    tx: TransactionMessages,
    conversation: string,
    p: Preference,
  ): Promise<{ effaces: string[]; retiree: boolean }> {
    const effaces: string[] = [];
    if (p.effaceAvant !== undefined) {
      const tous = await tx.objectStore("messages").index("conversation").getAll(plageConversation(conversation));
      for (const m of tous) {
        // Un message pas encore parti n'a pas d'heure définitive : on le garde.
        if (m.le <= p.effaceAvant && m.etat !== "attente") {
          await tx.objectStore("messages").delete(m.id);
          effaces.push(m.id);
        }
      }
    }
    const conversations = tx.objectStore("conversations");
    const existante = await conversations.get(conversation);
    if (existante) {
      const reglages = { ...existante.reglages };
      if (p.muetJusqua !== undefined) reglages.muetJusqua = p.muetJusqua;
      if (p.favori !== undefined) reglages.favori = p.favori;
      if (p.archive !== undefined) reglages.archive = p.archive;
      if (p.epingle !== undefined) reglages.epingle = p.epingle;
      if (p.nonLu !== undefined) reglages.nonLu = p.nonLu;
      const videeLe = p.effaceAvant !== undefined && !p.supprimee ? p.effaceAvant : existante.videeLe;
      await conversations.put({ ...existante, reglages, ...(videeLe ? { videeLe } : {}) });
    }
    return { effaces, retiree: p.supprimee === true };
  }

  // --- Blocage et signalement ------------------------------------------------------------

  async bloquer(id: string, bloque: boolean): Promise<CarteProfil> {
    const carte = bloque ? await api.bloquer(id) : await api.debloquer(id);
    this.retenirPersonne(carte);
    return carte;
  }

  /**
   * Signalement : on joint les cinq derniers messages reçus de la personne
   * (ou des autres membres du groupe), jamais les siens.
   */
  async signaler(conversation: string, options: { bloquer: boolean }): Promise<void> {
    const groupe = estGroupe(conversation);
    const cible = groupe ? idGroupe(conversation) : autreParticipant(conversation, this.moi);
    const recus = (await this.messages(conversation))
      .filter((m) => m.type !== "evenement" && !m.supprime && m.de !== this.moi && (groupe || m.de === cible))
      .slice(-MESSAGES_SIGNALES)
      .map((m) => ({
        id: m.id,
        de: m.de,
        texte: m.texte,
        le: m.le,
        ...(m.media ? { media: { type: m.media.type, nom: m.media.nom.slice(0, 180) } } : {}),
      }));
    await api.signaler({ type: groupe ? "groupe" : "personne", cible, messages: recus, bloquer: !groupe && options.bloquer });
    if (!groupe && options.bloquer) {
      const connue = this.etat.personnes[cible];
      if (connue) this.retenirPersonne({ ...connue, bloque: true });
    }
  }

  /** Discussion en texte brut, comme l'export de WhatsApp : rien ne quitte l'appareil. */
  async exporter(conversation: string): Promise<string> {
    const jour = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
    const lignes: string[] = [];
    for (const m of await this.messages(conversation)) {
      const quand = `${jour.format(new Date(m.le))} ${heureCourte(m.le)}`;
      if (m.type === "evenement" || m.type === "systeme") continue;
      const contenu = m.supprime
        ? "Ce message a été supprimé"
        : m.media
          ? [`<${resumeMessage({ texte: "", media: m.media })} non inclus>`, m.texte].filter(Boolean).join(" ")
          : m.position
            ? `Position : https://www.openstreetmap.org/?mlat=${m.position.lat}&mlon=${m.position.lon}`
            : resumeMessage(m);
      lignes.push(`${quand} - ${this.nom(m.de, conversation)} : ${contenu}`);
    }
    return lignes.join("\n") + "\n";
  }

  // --- Réactions et suppression ---------------------------------------------------------

  /** Réagir (ou retirer sa réaction avec null). Affichée tout de suite, annulée si le réseau manque. */
  async reagir(message: MessageLocal, code: Reaction | null): Promise<boolean> {
    if (!this.connecte) return false;
    const avant = message.reactions ?? {};
    const reactions = { ...avant };
    if (code) reactions[this.moi] = code;
    else delete reactions[this.moi];
    await this.modifierMessage(message.id, (m) => ({ ...m, reactions }));
    if (
      !(await this.agir(
        message.conversation,
        { v: 1, action: "reaction", message: message.id, code },
        { t: "reagir", conversation: message.conversation, message: message.id, code },
      ))
    ) {
      await this.modifierMessage(message.id, (m) => ({ ...m, reactions: avant }));
      return false;
    }
    return true;
  }

  /** Supprimer pour tout le monde : réservé à l'auteur, et seulement en ligne (les autres doivent être prévenus). */
  async supprimerPourTous(message: MessageLocal): Promise<boolean> {
    if (message.de !== this.moi || !this.connecte) return false;
    if (
      !(await this.agir(
        message.conversation,
        { v: 1, action: "suppression", message: message.id },
        { t: "supprimer", conversation: message.conversation, message: message.id },
      ))
    ) {
      return false;
    }
    // Le fichier cesse d'être servi tout de suite, et disparaît d'ici aussi.
    if (message.media?.id) void retirerMedia(message.media.id);
    await this.db.delete("fichiers", message.id);
    await this.modifierMessage(message.id, (m) => ({ ...m, texte: "", supprime: true, reactions: {}, reponseA: undefined, media: undefined }));
    return true;
  }

  async supprimerPourMoi(message: MessageLocal): Promise<void> {
    await this.db.delete("fichiers", message.id);
    const tx = this.db.transaction(["messages", "conversations"], "readwrite");
    await tx.objectStore("messages").delete(message.id);
    await this.recalculer(tx, message.conversation);
    await tx.done;
    await this.publierConversations(new Set([message.conversation]));
  }

  // --- Lecture ---------------------------------------------------------------------------

  /** La discussion est affichée : ses messages sont lus, chaque auteur le voit. */
  async marquerLu(conversation: string): Promise<void> {
    const tous = await this.db.getAllFromIndex("messages", "conversation", plageConversation(conversation));
    const aLire = tous.filter((m) => m.de !== this.moi && !m.lu);
    if (aLire.length === 0) return;
    const tx = this.db.transaction(["messages", "conversations"], "readwrite");
    for (const m of aLire) await tx.objectStore("messages").put({ ...m, lu: true });
    await this.recalculer(tx, conversation);
    await tx.done;
    await this.publierConversations(new Set([conversation]));
    const parAuteur = new Map<string, string[]>();
    for (const m of aLire) if (m.type !== "evenement") parAuteur.set(m.de, [...(parAuteur.get(m.de) ?? []), m.id]);
    for (const [auteur, ids] of parAuteur) this.envoyerLus(conversation, auteur, ids);
  }

  private envoyerLus(conversation: string, auteur: string, ids: string[]): void {
    for (let i = 0; i < ids.length; i += 500) {
      const lot = ids.slice(i, i + 500);
      if (!this.brut({ t: "lu", conversation, auteur, ids: lot })) {
        const cle = `${conversation}|${auteur}`;
        const enAttente = this.lusEnAttente.get(cle) ?? { conversation, auteur, ids: new Set<string>() };
        for (const id of lot) enAttente.ids.add(id);
        this.lusEnAttente.set(cle, enAttente);
      }
    }
  }

  ouvrir(conversation: string | null): void {
    this.ouverte = conversation;
    // Ouverte : « non lu » n'a plus lieu d'être, sur tous mes appareils.
    if (conversation && this.etat.conversations.find((c) => c.id === conversation)?.reglages?.nonLu) {
      void this.regler(conversation, { nonLu: false });
    }
    if (conversation && !estGroupe(conversation)) this.demanderPresence(autreParticipant(conversation, this.moi));
  }

  async messages(conversation: string): Promise<MessageLocal[]> {
    return this.db.getAllFromIndex("messages", "conversation", plageConversation(conversation));
  }

  // --- Présence, écriture --------------------------------------------------------------

  /** « En train d'écrire » : un signal au plus toutes les 3 s (5 s dans un groupe, relayé à chacun). */
  signalerEcriture(conversation: string): void {
    const maintenant = Date.now();
    const intervalle = estGroupe(conversation) ? 5000 : 3000;
    if (maintenant - (this.dernierEcrit.get(conversation) ?? 0) < intervalle) return;
    this.dernierEcrit.set(conversation, maintenant);
    this.brut({ t: "ecrit", conversation });
  }

  demanderPresence(autre: string): void {
    this.brut({ t: "presence", de: autre });
  }

  // --- Profils et groupes -----------------------------------------------------------------

  async chargerPersonne(id: string, forcer = false): Promise<void> {
    if (id === this.moi || (this.personnesDemandees.has(id) && !forcer)) return;
    this.personnesDemandees.add(id);
    try {
      const carte = await api.personne(id);
      await this.db.put("personnes", { ...carte, maj: Date.now() });
      this.publier({ personnes: { ...this.etat.personnes, [id]: carte } });
    } catch {
      // Hors connexion : la version en cache reste affichée.
    }
  }

  /** Profil connu par ailleurs (recherche, fiche) : on évite une requête. */
  retenirPersonne(carte: CarteProfil): void {
    void this.db.put("personnes", { ...carte, maj: Date.now() });
    this.publier({ personnes: { ...this.etat.personnes, [carte.id]: carte } });
  }

  async chargerGroupe(id: string, forcer = false): Promise<void> {
    if (this.groupesDemandes.has(id) && !forcer) return;
    this.groupesDemandes.add(id);
    try {
      this.retenirGroupe(await api.groupe(id));
    } catch (erreur) {
      // Groupe quitté ou supprimé : on garde son nom, sans les membres.
      if (erreur instanceof ErreurApi && erreur.statut === 404) {
        const connu = this.etat.groupes[id];
        if (connu) this.retenirGroupe({ ...connu, membres: [], moiMembre: false, moiAdmin: false, photo: null });
      }
    }
  }

  retenirGroupe(groupe: Groupe): void {
    void this.db.put("groupes", { ...groupe, maj: Date.now() });
    this.publier({ groupes: { ...this.etat.groupes, [groupe.id]: groupe } });
  }

  /** Nom à afficher pour une personne (moi : « Vous »). */
  nom(id: string, conversation?: string): string {
    if (id === this.moi) return "Vous";
    const personne = this.etat.personnes[id];
    if (personne) return personne.nom;
    if (conversation && estGroupe(conversation)) {
      const membre = this.etat.groupes[idGroupe(conversation)]?.membres.find((m) => m.id === id);
      if (membre) return membre.nom;
    }
    void this.chargerPersonne(id);
    return "Quelqu'un";
  }

  // --- Outils ---------------------------------------------------------------------------

  private async modifierMessage(id: string, modifier: (m: MessageLocal) => MessageLocal): Promise<void> {
    const tx = this.db.transaction(["messages", "conversations"], "readwrite");
    const msg = await tx.objectStore("messages").get(id);
    if (!msg) {
      await tx.done;
      return;
    }
    await tx.objectStore("messages").put(modifier(msg));
    await this.recalculer(tx, msg.conversation);
    await tx.done;
    await this.publierConversations(new Set([msg.conversation]));
  }

  private async recalculer(tx: TransactionMessages, conversation: string): Promise<void> {
    const tous = await tx.objectStore("messages").index("conversation").getAll(plageConversation(conversation));
    const dernier = tous[tous.length - 1];
    const existante = await tx.objectStore("conversations").get(conversation);
    const resume: ConversationLocale = {
      ...(existante?.reglages ? { reglages: existante.reglages } : {}),
      ...(existante?.videeLe ? { videeLe: existante.videeLe } : {}),
      ...(existante?.epingles?.length ? { epingles: existante.epingles } : {}),
      ...(existante?.ephemere ? { ephemere: existante.ephemere } : {}),
      id: conversation,
      autre: estGroupe(conversation) ? idGroupe(conversation) : autreParticipant(conversation, this.moi),
      dernier: dernier
        ? {
            id: dernier.id,
            texte: dernier.texte,
            le: dernier.le,
            de: dernier.de,
            deMoi: dernier.de === this.moi,
            etat: dernier.etat,
            supprime: dernier.supprime,
            ...(dernier.indechiffrable ? { indechiffrable: true } : {}),
            evenement: dernier.evenement,
            ...(dernier.media
              ? { media: { type: dernier.media.type, nom: dernier.media.nom, duree: dernier.media.duree, vocal: dernier.media.vocal, vueUnique: dernier.media.vueUnique } }
              : {}),
            ...(dernier.position || dernier.contact || dernier.sondage
              ? { special: dernier.position ? "position" : dernier.contact ? "contact" : "sondage", texte: resumeMessage(dernier) }
              : {}),
          }
        : null,
      nonLus: tous.filter((m) => m.de !== this.moi && !m.lu && m.type !== "evenement" && m.type !== "systeme").length,
      mention: tous.some((m) => m.de !== this.moi && !m.lu && m.mentions?.includes(this.moi)),
    };
    await tx.objectStore("conversations").put(resume);
  }

  private async publierConversations(touchees: Set<string>): Promise<void> {
    const conversations = trier(await this.db.getAll("conversations"));
    const versions = { ...this.etat.versions };
    for (const c of touchees) versions[c] = (versions[c] ?? 0) + 1;
    this.publier({ conversations, versions });
    this.mettreAJourTitre();
    for (const c of conversations) {
      if (estGroupe(c.id)) {
        if (!this.etat.groupes[c.autre]) void this.chargerGroupe(c.autre);
      } else if (!this.etat.personnes[c.autre]) void this.chargerPersonne(c.autre);
    }
  }

  private mettreAJourTitre(): void {
    const maintenant = Date.now();
    const total = this.etat.conversations.reduce((n, c) => n + (estMuette(c, maintenant) ? 0 : c.nonLus), 0);
    document.title = total > 0 ? `(${total}) UniChat` : "UniChat";
  }

  /** Notification du système, seulement si la page n'est pas sous les yeux. */
  private notifier(nouveaux: MessageLocal[]): void {
    // Web Push actif sur cet appareil : c'est le service worker qui notifie, une seule fois.
    if (!("Notification" in window) || Notification.permission !== "granted" || !document.hidden || pushActif()) return;
    for (const m of nouveaux) {
      const discussion = this.etat.conversations.find((c) => c.id === m.conversation);
      // En sourdine, seule une mention fait encore sonner, comme dans WhatsApp.
      if (discussion && estMuette(discussion) && !m.mentions?.includes(this.moi)) continue;
      const groupe = estGroupe(m.conversation) ? this.etat.groupes[idGroupe(m.conversation)] : null;
      const auteur = this.nom(m.de, m.conversation);
      const titre = groupe ? groupe.nom : auteur;
      const corps = groupe ? `${auteur} : ${resumeMessage(m)}` : resumeMessage(m);
      void montrerNotification(titre, { corps: corps.slice(0, 200), conversation: m.conversation }, (c) => this.surOuverture?.(c)).catch(() => {});
    }
  }
}
