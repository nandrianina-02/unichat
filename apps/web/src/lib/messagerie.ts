import {
  FERMETURE_SESSION,
  autreParticipant,
  conversationDirecte,
  type CarteProfil,
  type Entree,
  type MessageClient,
  type MessageServeur,
} from "@unichat/shared";
import { ErreurApi, api } from "./api";
import {
  ouvrirStockage,
  plageConversation,
  type ConversationLocale,
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
  /** Personne en train d'écrire → instant où l'indication s'éteint. */
  ecrit: Record<string, number>;
  presences: Record<string, Presence>;
  /** Incrémenté à chaque changement d'une discussion : la vue relit ses messages. */
  versions: Record<string, number>;
}

const RANG: Record<EtatMessage, number> = { echec: -1, attente: 0, envoye: 1, remis: 2, lu: 3 };
const plusAvance = (a: EtatMessage | undefined, b: EtatMessage): EtatMessage =>
  a && RANG[a] >= RANG[b] ? a : b;

const DUREE_ECRIT = 5000;
const INTERVALLE_PING = 25_000;

function trier(conversations: ConversationLocale[]): ConversationLocale[] {
  return [...conversations].sort((a, b) => (b.dernier?.le ?? 0) - (a.dernier?.le ?? 0));
}

/**
 * Messagerie de l'appareil : connexion temps réel, historique local et file
 * des envois. Tout passe par le stockage local d'abord ; le réseau ne fait
 * que synchroniser. Un message écrit hors connexion part au retour du réseau.
 */
export class Messagerie {
  private db!: Stockage;
  private ws: WebSocket | null = null;
  private seq: number | null = null;
  private tentative = 0;
  private arretee = false;
  private minuterieReconnexion: ReturnType<typeof setTimeout> | null = null;
  private minuterieAccuse: ReturnType<typeof setTimeout> | null = null;
  private minuteriePing: ReturnType<typeof setInterval> | null = null;
  private readonly auditeurs = new Set<() => void>();
  private readonly personnesDemandees = new Set<string>();
  private readonly dernierEcrit = new Map<string, number>();
  /** Accusés de lecture à envoyer, gardés tant que la connexion est coupée. */
  private readonly lusEnAttente = new Map<string, Set<string>>();
  private ouverte: string | null = null;
  /** Appelé quand on clique sur une notification. */
  surOuverture: ((autre: string) => void) | null = null;

  private etat: Instantane = {
    connexion: "connexion",
    conversations: [],
    personnes: {},
    ecrit: {},
    presences: {},
    versions: {},
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

  // --- Cycle de vie -----------------------------------------------------------------

  async demarrer(): Promise<void> {
    this.db = await ouvrirStockage(this.moi);
    this.seq = ((await this.db.get("reglages", "seq")) as number | undefined) ?? null;
    const [conversations, personnes] = await Promise.all([this.db.getAll("conversations"), this.db.getAll("personnes")]);
    this.publier({
      conversations: trier(conversations),
      personnes: Object.fromEntries(personnes.map((p) => [p.id, p])),
    });
    this.mettreAJourTitre();
    // Les profils en cache s'affichent tout de suite, puis sont rafraîchis.
    for (const c of conversations) void this.chargerPersonne(c.autre, true);
    window.addEventListener("online", this.surRetourReseau);
    this.connecter();
  }

  arreter(): void {
    this.arretee = true;
    window.removeEventListener("online", this.surRetourReseau);
    for (const m of [this.minuterieReconnexion, this.minuterieAccuse]) if (m) clearTimeout(m);
    if (this.minuteriePing) clearInterval(this.minuteriePing);
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
        await this.appliquer(m.entrees);
        if (!m.fin) {
          this.brut({ t: "bonjour", depuis: this.seq });
          return;
        }
        this.publier({ connexion: "connecte" });
        await this.renvoyerEnAttente();
        if (this.ouverte) this.demanderPresence(autreParticipant(this.ouverte, this.moi));
        return;
      case "entree":
        await this.appliquer([m.entree]);
        return;
      case "accepte":
        await this.modifierMessage(m.id, (msg) => ({ ...msg, etat: plusAvance(msg.etat, "envoye"), le: m.le, erreur: undefined }));
        return;
      case "refuse":
        if (m.id) await this.modifierMessage(m.id, (msg) => ({ ...msg, etat: "echec", erreur: m.message }));
        return;
      case "ecrit":
        this.publier({ ecrit: { ...this.etat.ecrit, [m.de]: Date.now() + DUREE_ECRIT } });
        setTimeout(() => {
          const fin = this.etat.ecrit[m.de];
          if (fin && fin <= Date.now()) {
            const { [m.de]: _, ...reste } = this.etat.ecrit;
            this.publier({ ecrit: reste });
          }
        }, DUREE_ECRIT + 50);
        return;
      case "presence":
        this.publier({ presences: { ...this.etat.presences, [m.de]: { enLigne: m.enLigne, vuLe: m.vuLe } } });
        return;
    }
  }

  private async appliquer(entrees: Entree[]): Promise<void> {
    if (entrees.length === 0) return;
    const tx = this.db.transaction(["messages", "conversations"], "readwrite");
    const messages = tx.objectStore("messages");
    const touchees = new Set<string>();
    const nouveaux: MessageLocal[] = [];

    for (const e of entrees) {
      if (e.type === "message") {
        const m = e.message;
        const existant = await messages.get(m.id);
        if (m.de === this.moi) {
          await messages.put({ ...m, etat: plusAvance(existant?.etat, "envoye") });
        } else if (!existant) {
          const local: MessageLocal = { ...m, lu: false };
          await messages.put(local);
          nouveaux.push(local);
        }
        touchees.add(m.conversation);
      } else if (e.type === "accuse") {
        for (const id of e.ids) {
          const msg = await messages.get(id);
          // Seuls mes messages de cette discussion peuvent changer d'état.
          if (msg && msg.de === this.moi && msg.conversation === e.conversation) {
            await messages.put({ ...msg, etat: plusAvance(msg.etat, e.etat) });
          }
        }
        touchees.add(e.conversation);
      } else {
        for (const id of e.ids) {
          const msg = await messages.get(id);
          if (msg && msg.de !== this.moi && !msg.lu) await messages.put({ ...msg, lu: true });
        }
        touchees.add(e.conversation);
      }
    }
    for (const c of touchees) await this.recalculer(tx, c);
    await tx.done;

    this.seq = Math.max(this.seq ?? 0, ...entrees.map((e) => e.seq));
    await this.db.put("reglages", this.seq, "seq");
    this.planifierAccuse();
    // Le message est arrivé : son auteur n'est plus « en train d'écrire ».
    if (nouveaux.some((m) => this.etat.ecrit[m.de])) {
      const ecrit = { ...this.etat.ecrit };
      for (const m of nouveaux) delete ecrit[m.de];
      this.publier({ ecrit });
    }
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

  async envoyer(autre: string, texte: string): Promise<void> {
    const propre = texte.trim();
    if (!propre) return;
    const message: MessageLocal = {
      id: crypto.randomUUID(),
      conversation: conversationDirecte(this.moi, autre),
      de: this.moi,
      a: autre,
      texte: propre,
      le: Date.now(),
      etat: "attente",
    };
    const tx = this.db.transaction(["messages", "conversations"], "readwrite");
    await tx.objectStore("messages").put(message);
    await this.recalculer(tx, message.conversation);
    await tx.done;
    await this.publierConversations(new Set([message.conversation]));
    this.brut({ t: "envoyer", id: message.id, a: autre, texte: propre });
  }

  async renvoyer(id: string): Promise<void> {
    const msg = await this.db.get("messages", id);
    if (!msg || msg.de !== this.moi || msg.etat !== "echec") return;
    await this.modifierMessage(id, (m) => ({ ...m, etat: "attente", erreur: undefined }));
    this.brut({ t: "envoyer", id, a: msg.a, texte: msg.texte });
  }

  private async renvoyerEnAttente(): Promise<void> {
    const enAttente = await this.db.getAllFromIndex("messages", "etat", "attente");
    for (const m of enAttente.sort((a, b) => a.le - b.le)) this.brut({ t: "envoyer", id: m.id, a: m.a, texte: m.texte });
    for (const [autre, ids] of this.lusEnAttente) this.envoyerLus(autre, [...ids]);
  }

  // --- Lecture ---------------------------------------------------------------------------

  /** La discussion est affichée : ses messages sont lus, l'expéditeur le voit. */
  async marquerLu(conversation: string): Promise<void> {
    const tous = await this.db.getAllFromIndex("messages", "conversation", plageConversation(conversation));
    const aLire = tous.filter((m) => m.de !== this.moi && !m.lu);
    if (aLire.length === 0) return;
    const tx = this.db.transaction(["messages", "conversations"], "readwrite");
    for (const m of aLire) await tx.objectStore("messages").put({ ...m, lu: true });
    await this.recalculer(tx, conversation);
    await tx.done;
    await this.publierConversations(new Set([conversation]));
    this.envoyerLus(
      autreParticipant(conversation, this.moi),
      aLire.map((m) => m.id),
    );
  }

  private envoyerLus(autre: string, ids: string[]): void {
    const enAttente = this.lusEnAttente.get(autre) ?? new Set<string>();
    for (const id of ids) enAttente.add(id);
    const tous = [...enAttente];
    let envoyes = true;
    for (let i = 0; i < tous.length; i += 500) envoyes = this.brut({ t: "lu", avec: autre, ids: tous.slice(i, i + 500) }) && envoyes;
    if (envoyes) this.lusEnAttente.delete(autre);
    else this.lusEnAttente.set(autre, enAttente);
  }

  ouvrir(conversation: string | null): void {
    this.ouverte = conversation;
    if (conversation) this.demanderPresence(autreParticipant(conversation, this.moi));
  }

  async messages(conversation: string): Promise<MessageLocal[]> {
    return this.db.getAllFromIndex("messages", "conversation", plageConversation(conversation));
  }

  // --- Présence, écriture --------------------------------------------------------------

  /** « En train d'écrire » : au plus un signal toutes les trois secondes. */
  signalerEcriture(autre: string): void {
    const maintenant = Date.now();
    if (maintenant - (this.dernierEcrit.get(autre) ?? 0) < 3000) return;
    this.dernierEcrit.set(autre, maintenant);
    this.brut({ t: "ecrit", a: autre });
  }

  demanderPresence(autre: string): void {
    this.brut({ t: "presence", de: autre });
  }

  // --- Profils ---------------------------------------------------------------------------

  async chargerPersonne(id: string, forcer = false): Promise<void> {
    if (this.personnesDemandees.has(id) && !forcer) return;
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
    const resume: ConversationLocale = {
      id: conversation,
      autre: autreParticipant(conversation, this.moi),
      dernier: dernier
        ? { id: dernier.id, texte: dernier.texte, le: dernier.le, deMoi: dernier.de === this.moi, etat: dernier.etat }
        : null,
      nonLus: tous.filter((m) => m.de !== this.moi && !m.lu).length,
    };
    await tx.objectStore("conversations").put(resume);
  }

  private async publierConversations(touchees: Set<string>): Promise<void> {
    const conversations = trier(await this.db.getAll("conversations"));
    const versions = { ...this.etat.versions };
    for (const c of touchees) versions[c] = (versions[c] ?? 0) + 1;
    this.publier({ conversations, versions });
    this.mettreAJourTitre();
    for (const c of conversations) if (!this.etat.personnes[c.autre]) void this.chargerPersonne(c.autre);
  }

  private mettreAJourTitre(): void {
    const total = this.etat.conversations.reduce((n, c) => n + c.nonLus, 0);
    document.title = total > 0 ? `(${total}) UniChat` : "UniChat";
  }

  /** Notification du système, seulement si la page n'est pas sous les yeux. */
  private notifier(nouveaux: MessageLocal[]): void {
    if (!("Notification" in window) || Notification.permission !== "granted" || !document.hidden) return;
    for (const m of nouveaux) {
      const nom = this.etat.personnes[m.de]?.nom ?? "Nouveau message";
      const notification = new Notification(nom, { body: m.texte.slice(0, 200), tag: m.conversation, icon: "/icone.svg" });
      notification.onclick = () => {
        window.focus();
        this.surOuverture?.(m.de);
        notification.close();
      };
    }
  }
}
