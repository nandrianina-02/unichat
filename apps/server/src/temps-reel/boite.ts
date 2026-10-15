import { DurableObject } from "cloudflare:workers";
import {
  FERMETURE_SESSION,
  LIMITES_GROUPE,
  conversationDirecte,
  conversationGroupe,
  estGroupe,
  idGroupe,
  schemaClient,
  type Entree,
  type Message,
  type MessageClient,
  type MessageServeur,
} from "@unichat/shared";
import { membresDe } from "../lib/groupes";
import type { Bindings } from "../types";

/** Ce que chaque connexion garde avec elle, même après une mise en veille de l'objet. */
export interface Attache {
  sessionId: string;
  utilisateurId: string;
  expire: number;
}

type SansSeq<T> = T extends unknown ? Omit<T, "seq"> : never;
export type NouvelleEntree = SansSeq<Entree>;

const TRENTE_JOURS = 30 * 24 * 60 * 60 * 1000;
const TAILLE_LOT = 500;
const ENVOIS_MAX = 20;
const FENETRE_ENVOIS = 10 * 1000;
/** Membres d'un groupe gardés en mémoire : « écrit… » ne relit pas la base à chaque frappe. */
const DUREE_CACHE_MEMBRES = 10 * 1000;
/** Accusés de remise envoyés par passage : on reste sous la limite de sous-requêtes. */
const ACCUSES_PAR_PASSAGE = 40;

function conversationDe(e: NouvelleEntree): string {
  if (e.type === "message") return e.message.conversation;
  if (e.type === "groupe") return e.evenement.conversation;
  return e.conversation;
}

/**
 * Boîte aux lettres d'un utilisateur : un Durable Object par personne.
 *
 * Elle tient les WebSocket de ses appareils et un journal numéroté (messages
 * reçus et envoyés, accusés, réactions, suppressions, événements de groupe).
 * Chaque appareil indique jusqu'où il a reçu ; ce que tous ont reçu est
 * effacé. Le serveur ne garde donc les messages que le temps de les remettre,
 * 30 jours au plus.
 *
 * Les connexions utilisent l'API d'hibernation : un appareil connecté mais
 * silencieux ne consomme rien.
 */
export class Boite extends DurableObject<Bindings> {
  private readonly sql: SqlStorage;
  private readonly envoisRecents = new Map<string, number[]>();
  private readonly destinatairesConnus = new Set<string>();
  private readonly membresConnus = new Map<string, { ids: string[]; expire: number }>();

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.preparerTables();
    // Le maintien de connexion des applications ne réveille pas l'objet.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  private preparerTables(): void {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS journal (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      contenu TEXT NOT NULL,
      expediteur TEXT,
      message_id TEXT,
      conversation TEXT,
      remis_envoye INTEGER NOT NULL DEFAULT 0,
      cree_le INTEGER NOT NULL
    )`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS journal_message ON journal (message_id)");
    this.sql.exec(`CREATE TABLE IF NOT EXISTS appareils (
      session_id TEXT PRIMARY KEY,
      curseur INTEGER NOT NULL,
      vu_le INTEGER NOT NULL
    )`);
    this.sql.exec("CREATE TABLE IF NOT EXISTS etat (cle TEXT PRIMARY KEY, valeur TEXT NOT NULL)");
  }

  // --- Connexion -------------------------------------------------------------

  override async fetch(requete: Request): Promise<Response> {
    if (requete.headers.get("Upgrade") !== "websocket") return new Response("WebSocket attendu.", { status: 426 });
    const attache: Attache = {
      sessionId: requete.headers.get("X-UniChat-Session") ?? "",
      utilisateurId: requete.headers.get("X-UniChat-Utilisateur") ?? "",
      expire: Number(requete.headers.get("X-UniChat-Expire") ?? "0"),
    };
    if (!attache.sessionId || !attache.utilisateurId) return new Response("Session absente.", { status: 400 });
    const { 0: client, 1: serveur } = new WebSocketPair();
    // Étiquette = session : on retrouve les connexions d'un appareil pour les fermer.
    this.ctx.acceptWebSocket(serveur, [attache.sessionId]);
    serveur.serializeAttachment(attache);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, donnees: string | ArrayBuffer): Promise<void> {
    const attache = ws.deserializeAttachment() as Attache;
    if (Date.now() > attache.expire) {
      ws.close(FERMETURE_SESSION, "Session expirée");
      return;
    }
    let brut: unknown;
    try {
      brut = JSON.parse(typeof donnees === "string" ? donnees : new TextDecoder().decode(donnees));
    } catch {
      this.envoyer(ws, { t: "refuse", message: "Message illisible." });
      return;
    }
    const lecture = schemaClient.safeParse(brut);
    if (!lecture.success) {
      const id = typeof (brut as { id?: unknown })?.id === "string" ? (brut as { id: string }).id : undefined;
      this.envoyer(ws, { t: "refuse", id, message: lecture.error.issues[0]?.message ?? "Message invalide." });
      return;
    }
    await this.traiter(ws, attache, lecture.data);
  }

  override async webSocketClose(ws: WebSocket, code: number, raison: string): Promise<void> {
    try {
      ws.close(code, raison);
    } catch {
      // Déjà fermée.
    }
    if (this.ctx.getWebSockets().every((autre) => autre === ws)) this.noterVu(Date.now());
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    if (this.ctx.getWebSockets().every((autre) => autre === ws)) this.noterVu(Date.now());
  }

  private async traiter(ws: WebSocket, attache: Attache, m: MessageClient): Promise<void> {
    const moi = attache.utilisateurId;
    switch (m.t) {
      case "bonjour":
        return this.bonjour(ws, attache, m.depuis);
      case "recu":
        return this.recu(attache, m.jusqua);
      case "envoyer":
        return this.envoyerMessage(ws, attache, m);
      case "lu": {
        const maintenant = Date.now();
        // L'auteur ne fait confiance à cet accusé que pour ses propres messages
        // de cette discussion (vérifié par son application).
        if (m.auteur !== moi) {
          await this.boite(m.auteur).recevoir({
            type: "accuse",
            conversation: m.conversation,
            ids: m.ids,
            etat: "lu",
            par: moi,
            le: maintenant,
          });
        }
        this.ajouter({ type: "lu", conversation: m.conversation, ids: m.ids, le: maintenant });
        return;
      }
      case "ecrit": {
        const autres = await this.participants(m.conversation, moi);
        if (!autres) return;
        await Promise.allSettled(autres.map((id) => this.boite(id).signalerEcriture(moi, m.conversation)));
        return;
      }
      case "presence": {
        const etat = m.de === moi ? await this.presence() : await this.boite(m.de).presence();
        this.envoyer(ws, { t: "presence", de: m.de, ...etat });
        return;
      }
      case "reagir":
        return this.partager(ws, moi, m.conversation, {
          type: "reaction",
          conversation: m.conversation,
          message: m.message,
          par: moi,
          code: m.code,
          le: Date.now(),
        });
      case "supprimer":
        return this.partager(ws, moi, m.conversation, {
          type: "suppression",
          conversation: m.conversation,
          message: m.message,
          par: moi,
          le: Date.now(),
        });
    }
  }

  /** L'appareil indique où il en est ; on lui envoie la suite du journal. */
  private bonjour(ws: WebSocket, attache: Attache, depuis: number | null): void {
    const maintenant = Date.now();
    // Appareil neuf : il reçoit tout ce qui est encore en attente.
    const plusAncien = this.sql.exec<{ m: number | null }>("SELECT MIN(seq) - 1 AS m FROM journal").one().m;
    const curseur = depuis ?? Math.max(0, plusAncien ?? 0);
    this.sql.exec(
      "INSERT OR REPLACE INTO appareils (session_id, curseur, vu_le) VALUES (?, ?, ?)",
      attache.sessionId,
      curseur,
      maintenant,
    );
    const lignes = this.sql
      .exec<{ seq: number; contenu: string }>("SELECT seq, contenu FROM journal WHERE seq > ? ORDER BY seq LIMIT ?", curseur, TAILLE_LOT)
      .toArray();
    const entrees = lignes.map((l) => ({ ...(JSON.parse(l.contenu) as NouvelleEntree), seq: l.seq }) as Entree);
    this.envoyer(ws, { t: "lot", entrees, fin: entrees.length < TAILLE_LOT });
  }

  /** Accusé de l'appareil : il a tout reçu jusqu'à ce numéro. */
  private async recu(attache: Attache, jusqua: number): Promise<void> {
    const maintenant = Date.now();
    this.sql.exec(
      "UPDATE appareils SET curseur = MAX(curseur, ?), vu_le = ? WHERE session_id = ?",
      jusqua,
      maintenant,
      attache.sessionId,
    );

    // Premier appareil à recevoir un message : l'expéditeur voit « remis ».
    const aRemettre = this.sql
      .exec<{ seq: number; message_id: string; expediteur: string; conversation: string }>(
        `SELECT seq, message_id, expediteur, conversation FROM journal
         WHERE seq <= ? AND type = 'message' AND remis_envoye = 0 AND expediteur <> ?
         ORDER BY seq`,
        jusqua,
        attache.utilisateurId,
      )
      .toArray();
    const groupes = new Map<string, { expediteur: string; conversation: string; ids: string[]; seqs: number[] }>();
    for (const l of aRemettre) {
      const cle = `${l.expediteur}|${l.conversation}`;
      const groupe = groupes.get(cle) ?? { expediteur: l.expediteur, conversation: l.conversation, ids: [], seqs: [] };
      groupe.ids.push(l.message_id);
      groupe.seqs.push(l.seq);
      groupes.set(cle, groupe);
    }
    // Au-delà, les accusés partiront au passage suivant.
    for (const groupe of [...groupes.values()].slice(0, ACCUSES_PAR_PASSAGE)) {
      try {
        await this.boite(groupe.expediteur).recevoir({
          type: "accuse",
          conversation: groupe.conversation,
          ids: groupe.ids,
          etat: "remis",
          par: attache.utilisateurId,
          le: maintenant,
        });
        for (const seq of groupe.seqs) this.sql.exec("UPDATE journal SET remis_envoye = 1 WHERE seq = ?", seq);
      } catch (erreur) {
        console.warn("accusé de remise non transmis", String(erreur));
      }
    }
    // Mes propres messages n'appellent pas d'accusé.
    this.sql.exec("UPDATE journal SET remis_envoye = 1 WHERE seq <= ? AND type = 'message' AND expediteur = ?", jusqua, attache.utilisateurId);
    this.nettoyer(maintenant);
  }

  private async envoyerMessage(
    ws: WebSocket,
    attache: Attache,
    m: Extract<MessageClient, { t: "envoyer" }>,
  ): Promise<void> {
    const maintenant = Date.now();
    const moi = attache.utilisateurId;
    if (!this.autoriserEnvoi(attache.sessionId, maintenant)) {
      this.envoyer(ws, { t: "refuse", id: m.id, message: "Vous envoyez trop de messages. Patientez quelques secondes." });
      return;
    }

    let conversation: string;
    let destinataires: string[];
    if (m.groupe) {
      conversation = conversationGroupe(m.groupe);
      const autres = await this.participants(conversation, moi);
      if (!autres) {
        this.envoyer(ws, { t: "refuse", id: m.id, message: "Vous ne faites pas partie de ce groupe." });
        return;
      }
      destinataires = autres;
    } else {
      const a = m.a!;
      conversation = conversationDirecte(moi, a);
      if (a !== moi && !(await this.destinataireExiste(a))) {
        this.envoyer(ws, { t: "refuse", id: m.id, message: "Cette personne n'existe pas ou plus sur UniChat." });
        return;
      }
      destinataires = a === moi ? [] : [a];
    }

    // Renvoi après une coupure : déjà accepté, on confirme sans redistribuer.
    const deja = this.sql
      .exec<{ contenu: string }>("SELECT contenu FROM journal WHERE message_id = ? AND type = 'message' AND expediteur = ?", m.id, moi)
      .toArray()[0];
    if (deja) {
      const { message } = JSON.parse(deja.contenu) as { message: Message };
      this.envoyer(ws, { t: "accepte", id: m.id, le: message.le, destinataires: destinataires.length });
      return;
    }

    const message: Message = {
      id: m.id,
      conversation,
      de: moi,
      a: m.groupe ?? m.a!,
      texte: m.texte.trim(),
      le: maintenant,
      ...(m.reponseA ? { reponseA: m.reponseA } : {}),
    };
    await this.distribuer(destinataires, { type: "message", message });
    // Copie dans ma propre boîte : mes autres appareils voient ce que j'envoie.
    this.ajouter({ type: "message", message });
    this.envoyer(ws, { t: "accepte", id: m.id, le: maintenant, destinataires: destinataires.length });
  }

  /** Réaction ou suppression : transmise à chaque participant et à mes autres appareils. */
  private async partager(ws: WebSocket, moi: string, conversation: string, entree: NouvelleEntree): Promise<void> {
    const autres = await this.participants(conversation, moi);
    if (!autres) {
      this.envoyer(ws, { t: "refuse", message: "Vous ne faites pas partie de cette discussion." });
      return;
    }
    await this.distribuer(autres, entree);
    this.ajouter(entree);
  }

  /**
   * Les autres participants d'une discussion, ou null si je n'en fais pas
   * partie. Un groupe est vérifié dans la base : un ancien membre ne peut plus
   * y écrire.
   */
  private async participants(conversation: string, moi: string): Promise<string[] | null> {
    if (estGroupe(conversation)) {
      const groupeId = idGroupe(conversation);
      const connu = this.membresConnus.get(groupeId);
      let ids: string[];
      if (connu && connu.expire > Date.now()) ids = connu.ids;
      else {
        ids = (await membresDe(this.env.DB, groupeId)).map((membre) => membre.id);
        this.membresConnus.set(groupeId, { ids, expire: Date.now() + DUREE_CACHE_MEMBRES });
      }
      if (!ids.includes(moi)) return null;
      return ids.filter((id) => id !== moi).slice(0, LIMITES_GROUPE.membres);
    }
    const [, x, y] = conversation.split(":");
    if (x !== moi && y !== moi) return null;
    const autre = x === moi ? y! : x!;
    return autre === moi ? [] : [autre];
  }

  private async distribuer(destinataires: string[], entree: NouvelleEntree): Promise<void> {
    const resultats = await Promise.allSettled(destinataires.map((id) => this.boite(id).recevoir(entree)));
    for (const r of resultats) if (r.status === "rejected") console.warn("remise impossible", String(r.reason));
  }

  // --- Appels des autres boîtes et du serveur (RPC) -------------------------------

  async recevoir(entree: NouvelleEntree): Promise<void> {
    this.ajouter(entree);
  }

  async signalerEcriture(de: string, conversation: string): Promise<void> {
    this.diffuser({ t: "ecrit", de, conversation });
  }

  async presence(): Promise<{ enLigne: boolean; vuLe: number | null }> {
    const enLigne = this.ctx.getWebSockets().length > 0;
    const vu = this.sql.exec<{ valeur: string }>("SELECT valeur FROM etat WHERE cle = 'vu_le'").toArray()[0];
    return { enLigne, vuLe: vu ? Number(vu.valeur) : null };
  }

  /** Session fermée (déconnexion, révocation) : ses connexions sont coupées et elle ne retient plus le journal. */
  async fermerSession(sessionId: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets(sessionId)) {
      try {
        ws.close(FERMETURE_SESSION, "Session fermée");
      } catch {
        // Déjà fermée.
      }
    }
    this.sql.exec("DELETE FROM appareils WHERE session_id = ?", sessionId);
    this.nettoyer(Date.now());
  }

  /** Compte supprimé : connexions coupées, messages en attente et état effacés. */
  async toutEffacer(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(FERMETURE_SESSION, "Compte supprimé");
      } catch {
        // Déjà fermée.
      }
    }
    await this.ctx.storage.deleteAll();
    // Tables recréées vides : un message encore en route ne fait pas échouer l'expéditeur.
    this.preparerTables();
  }

  // --- Outils ----------------------------------------------------------------------

  private ajouter(e: NouvelleEntree): Entree {
    const message = e.type === "message" ? e.message : null;
    const { seq } = this.sql
      .exec<{ seq: number }>(
        `INSERT INTO journal (type, contenu, expediteur, message_id, conversation, cree_le)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING seq`,
        e.type,
        JSON.stringify(e),
        message?.de ?? null,
        message?.id ?? null,
        conversationDe(e),
        Date.now(),
      )
      .one();
    const entree = { ...e, seq } as Entree;
    this.diffuser({ t: "entree", entree });
    return entree;
  }

  /** On efface ce que tous les appareils ont reçu, et tout ce qui a plus de 30 jours. */
  private nettoyer(maintenant: number): void {
    this.sql.exec("DELETE FROM appareils WHERE vu_le < ?", maintenant - TRENTE_JOURS);
    const minimum = this.sql.exec<{ m: number | null }>("SELECT MIN(curseur) AS m FROM appareils").one().m;
    if (minimum !== null) this.sql.exec("DELETE FROM journal WHERE seq <= ?", minimum);
    this.sql.exec("DELETE FROM journal WHERE cree_le < ?", maintenant - TRENTE_JOURS);
  }

  private noterVu(maintenant: number): void {
    this.sql.exec("INSERT OR REPLACE INTO etat (cle, valeur) VALUES ('vu_le', ?)", String(maintenant));
  }

  private autoriserEnvoi(sessionId: string, maintenant: number): boolean {
    const recents = (this.envoisRecents.get(sessionId) ?? []).filter((t) => maintenant - t < FENETRE_ENVOIS);
    if (recents.length >= ENVOIS_MAX) return false;
    recents.push(maintenant);
    this.envoisRecents.set(sessionId, recents);
    return true;
  }

  private async destinataireExiste(id: string): Promise<boolean> {
    if (this.destinatairesConnus.has(id)) return true;
    const ligne = await this.env.DB.prepare("SELECT 1 AS ok FROM utilisateurs WHERE id = ?1 AND pseudo IS NOT NULL").bind(id).first();
    if (ligne) this.destinatairesConnus.add(id);
    return Boolean(ligne);
  }

  private boite(utilisateurId: string) {
    return this.env.BOITE.get(this.env.BOITE.idFromName(utilisateurId));
  }

  private envoyer(ws: WebSocket, m: MessageServeur): void {
    try {
      ws.send(JSON.stringify(m));
    } catch {
      // Connexion fermée entre-temps : l'appareil récupérera tout à son retour.
    }
  }

  private diffuser(m: MessageServeur): void {
    const texte = JSON.stringify(m);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(texte);
      } catch {
        // idem
      }
    }
  }
}
