import {
  FERMETURE_SESSION,
  LIMITE_EXTRAIT,
  autreParticipant,
  estGroupe,
  idGroupe,
  type CarteProfil,
  type Citation,
  type Entree,
  type Groupe,
  type MessageClient,
  type MessageServeur,
  type Reaction,
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
  groupes: Record<string, Groupe>;
  /** Discussion → qui écrit, et jusqu'à quand afficher l'indication. */
  ecrit: Record<string, { de: string; fin: number }>;
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
  private readonly groupesDemandes = new Set<string>();
  private readonly dernierEcrit = new Map<string, number>();
  /** Accusés de lecture à envoyer, gardés tant que la connexion est coupée. */
  private readonly lusEnAttente = new Map<string, { conversation: string; auteur: string; ids: Set<string> }>();
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
    // Les profils en cache s'affichent tout de suite, puis sont rafraîchis.
    for (const c of conversations) {
      if (estGroupe(c.id)) void this.chargerGroupe(c.autre, true);
      else void this.chargerPersonne(c.autre, true);
    }
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
        if (this.ouverte && !estGroupe(this.ouverte)) this.demanderPresence(autreParticipant(this.ouverte, this.moi));
        return;
      case "entree":
        await this.appliquer([m.entree]);
        return;
      case "accepte":
        await this.modifierMessage(m.id, (msg) => {
          const accepte = { ...msg, le: m.le, attendus: m.destinataires, erreur: undefined };
          return { ...accepte, etat: plusAvance(msg.etat === "echec" ? "attente" : msg.etat, this.etatDeMonMessage(accepte)) };
        });
        return;
      case "refuse":
        if (m.id) await this.modifierMessage(m.id, (msg) => ({ ...msg, etat: "echec", erreur: m.message }));
        return;
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

  private async appliquer(entrees: Entree[]): Promise<void> {
    if (entrees.length === 0) return;
    const tx = this.db.transaction(["messages", "conversations"], "readwrite");
    const messages = tx.objectStore("messages");
    const touchees = new Set<string>();
    const nouveaux: MessageLocal[] = [];
    const groupesAChanger = new Set<string>();

    for (const e of entrees) {
      if (e.type === "message") {
        const m = e.message;
        const existant = await messages.get(m.id);
        if (m.de === this.moi) {
          const local: MessageLocal = { ...existant, ...m, type: "texte" };
          await messages.put({ ...local, etat: plusAvance(existant?.etat === "echec" ? "attente" : existant?.etat, this.etatDeMonMessage(local)) });
        } else if (!existant) {
          const local: MessageLocal = { ...m, type: "texte", lu: false };
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
          await messages.put({ ...msg, texte: "", supprime: true, reactions: {}, reponseA: undefined });
          touchees.add(e.conversation);
        }
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
    for (const c of touchees) await this.recalculer(tx, c);
    await tx.done;

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

  async envoyer(conversation: string, texte: string, reponseA?: MessageLocal): Promise<void> {
    const propre = texte.trim();
    if (!propre) return;
    const groupe = estGroupe(conversation);
    const a = groupe ? idGroupe(conversation) : autreParticipant(conversation, this.moi);
    const citation: Citation | undefined =
      reponseA && !reponseA.supprime
        ? { id: reponseA.id, de: reponseA.de, extrait: reponseA.texte.slice(0, LIMITE_EXTRAIT) }
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
    };
    const tx = this.db.transaction(["messages", "conversations"], "readwrite");
    await tx.objectStore("messages").put(message);
    await this.recalculer(tx, conversation);
    await tx.done;
    await this.publierConversations(new Set([conversation]));
    this.envoyerMessage(message);
  }

  private envoyerMessage(m: MessageLocal): void {
    const groupe = estGroupe(m.conversation);
    this.brut({
      t: "envoyer",
      id: m.id,
      ...(groupe ? { groupe: m.a } : { a: m.a }),
      texte: m.texte,
      ...(m.reponseA ? { reponseA: m.reponseA } : {}),
    });
  }

  async renvoyer(id: string): Promise<void> {
    const msg = await this.db.get("messages", id);
    if (!msg || msg.de !== this.moi || msg.etat !== "echec") return;
    await this.modifierMessage(id, (m) => ({ ...m, etat: "attente", erreur: undefined }));
    this.envoyerMessage(msg);
  }

  private async renvoyerEnAttente(): Promise<void> {
    const enAttente = await this.db.getAllFromIndex("messages", "etat", "attente");
    for (const m of enAttente.sort((a, b) => a.le - b.le)) this.envoyerMessage(m);
    for (const [cle, lot] of this.lusEnAttente) {
      this.lusEnAttente.delete(cle);
      this.envoyerLus(lot.conversation, lot.auteur, [...lot.ids]);
    }
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
    if (!this.brut({ t: "reagir", conversation: message.conversation, message: message.id, code })) {
      await this.modifierMessage(message.id, (m) => ({ ...m, reactions: avant }));
      return false;
    }
    return true;
  }

  /** Supprimer pour tout le monde : réservé à l'auteur, et seulement en ligne (les autres doivent être prévenus). */
  async supprimerPourTous(message: MessageLocal): Promise<boolean> {
    if (message.de !== this.moi || !this.connecte) return false;
    if (!this.brut({ t: "supprimer", conversation: message.conversation, message: message.id })) return false;
    await this.modifierMessage(message.id, (m) => ({ ...m, texte: "", supprime: true, reactions: {}, reponseA: undefined }));
    return true;
  }

  async supprimerPourMoi(message: MessageLocal): Promise<void> {
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
        if (connu) this.retenirGroupe({ ...connu, membres: [], moiMembre: false, moiAdmin: false });
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
    const resume: ConversationLocale = {
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
            evenement: dernier.evenement,
          }
        : null,
      nonLus: tous.filter((m) => m.de !== this.moi && !m.lu && m.type !== "evenement").length,
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
    const total = this.etat.conversations.reduce((n, c) => n + c.nonLus, 0);
    document.title = total > 0 ? `(${total}) UniChat` : "UniChat";
  }

  /** Notification du système, seulement si la page n'est pas sous les yeux. */
  private notifier(nouveaux: MessageLocal[]): void {
    if (!("Notification" in window) || Notification.permission !== "granted" || !document.hidden) return;
    for (const m of nouveaux) {
      const groupe = estGroupe(m.conversation) ? this.etat.groupes[idGroupe(m.conversation)] : null;
      const auteur = this.nom(m.de, m.conversation);
      const titre = groupe ? groupe.nom : auteur;
      const corps = groupe ? `${auteur} : ${m.texte}` : m.texte;
      const notification = new Notification(titre, { body: corps.slice(0, 200), tag: m.conversation, icon: "/icone.svg" });
      notification.onclick = () => {
        window.focus();
        this.surOuverture?.(m.conversation);
        notification.close();
      };
    }
  }
}
