import { DurableObject } from "cloudflare:workers";
import {
  FERMETURE_SESSION,
  conversationDirecte,
  schemaClient,
  type Entree,
  type Message,
  type MessageClient,
  type MessageServeur,
} from "@unichat/shared";
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

/**
 * Boîte aux lettres d'un utilisateur : un Durable Object par personne.
 *
 * Elle tient les WebSocket de ses appareils et un journal numéroté (messages
 * reçus et envoyés, accusés de remise et de lecture). Chaque appareil indique
 * jusqu'où il a reçu ; ce que tous ont reçu est effacé. Le serveur ne garde
 * donc les messages que le temps de les remettre, 30 jours au plus.
 *
 * Les connexions utilisent l'API d'hibernation : un appareil connecté mais
 * silencieux ne consomme rien.
 */
export class Boite extends DurableObject<Bindings> {
  private readonly sql: SqlStorage;
  private readonly envoisRecents = new Map<string, number[]>();
  private readonly destinatairesConnus = new Set<string>();

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
    switch (m.t) {
      case "bonjour":
        return this.bonjour(ws, attache, m.depuis);
      case "recu":
        return this.recu(attache, m.jusqua);
      case "envoyer":
        return this.envoyerMessage(ws, attache, m);
      case "lu": {
        const maintenant = Date.now();
        const conversation = conversationDirecte(attache.utilisateurId, m.avec);
        if (m.avec !== attache.utilisateurId) {
          await this.boite(m.avec).recevoir({ type: "accuse", conversation, ids: m.ids, etat: "lu", par: attache.utilisateurId, le: maintenant });
        }
        this.ajouter({ type: "lu", conversation, ids: m.ids, le: maintenant });
        return;
      }
      case "ecrit":
        if (m.a !== attache.utilisateurId) await this.boite(m.a).signalerEcriture(attache.utilisateurId);
        return;
      case "presence": {
        const etat = m.de === attache.utilisateurId ? await this.presence() : await this.boite(m.de).presence();
        this.envoyer(ws, { t: "presence", de: m.de, ...etat });
        return;
      }
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
      .exec<{ message_id: string; expediteur: string; conversation: string }>(
        `SELECT message_id, expediteur, conversation FROM journal
         WHERE seq <= ? AND type = 'message' AND remis_envoye = 0 AND expediteur <> ?`,
        jusqua,
        attache.utilisateurId,
      )
      .toArray();
    this.sql.exec("UPDATE journal SET remis_envoye = 1 WHERE seq <= ? AND type = 'message' AND remis_envoye = 0", jusqua);
    const parExpediteur = new Map<string, { conversation: string; ids: string[] }>();
    for (const l of aRemettre) {
      const groupe = parExpediteur.get(l.expediteur) ?? { conversation: l.conversation, ids: [] };
      groupe.ids.push(l.message_id);
      parExpediteur.set(l.expediteur, groupe);
    }
    for (const [expediteur, groupe] of parExpediteur) {
      try {
        await this.boite(expediteur).recevoir({ type: "accuse", ...groupe, etat: "remis", par: attache.utilisateurId, le: maintenant });
      } catch (erreur) {
        console.warn("accusé de remise non transmis", String(erreur));
      }
    }
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
    // Renvoi après une coupure : déjà accepté, on confirme sans redistribuer.
    const deja = this.sql
      .exec<{ contenu: string }>("SELECT contenu FROM journal WHERE message_id = ? AND type = 'message' AND expediteur = ?", m.id, moi)
      .toArray()[0];
    if (deja) {
      const { message } = JSON.parse(deja.contenu) as { message: Message };
      this.envoyer(ws, { t: "accepte", id: m.id, le: message.le });
      return;
    }
    if (m.a !== moi && !(await this.destinataireExiste(m.a))) {
      this.envoyer(ws, { t: "refuse", id: m.id, message: "Cette personne n'existe pas ou plus sur UniChat." });
      return;
    }
    const message: Message = {
      id: m.id,
      conversation: conversationDirecte(moi, m.a),
      de: moi,
      a: m.a,
      texte: m.texte.trim(),
      le: maintenant,
    };
    if (m.a !== moi) await this.boite(m.a).recevoir({ type: "message", message });
    // Copie dans ma propre boîte : mes autres appareils voient ce que j'envoie.
    this.ajouter({ type: "message", message });
    this.envoyer(ws, { t: "accepte", id: m.id, le: maintenant });
  }

  // --- Appels des autres boîtes (RPC) -----------------------------------------

  async recevoir(entree: NouvelleEntree): Promise<void> {
    this.ajouter(entree);
  }

  async signalerEcriture(de: string): Promise<void> {
    this.diffuser({ t: "ecrit", de });
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
        e.type === "message" ? e.message.conversation : e.conversation,
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
