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
  type MediaMessage,
  type Message,
  type MessageClient,
  type MessageServeur,
  type Preference,
} from "@unichat/shared";
import { blocageEntre } from "../lib/blocages";
import { pousser, resumer } from "../lib/push";
import { vapid } from "../routes/push";
import { visibilites, type Visibilites } from "../lib/confidentialite";
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
/** Blocages gardés en mémoire, pour la même raison que les membres. */
const DUREE_CACHE_BLOCAGES = 10 * 1000;
const AUCUN_BLOCAGE = { jeBloque: false, ilBloque: false };

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
  private readonly blocagesConnus = new Map<string, { jeBloque: boolean; ilBloque: boolean; expire: number }>();

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
        // Discussion à deux : ni blocage, et les deux ont gardé les confirmations
        // de lecture. Dans un groupe, la lecture est toujours confirmée.
        const direct = !estGroupe(m.conversation) && m.auteur !== moi;
        const retenu = direct && (this.bloqueDansUnSens(await this.blocage(moi, m.auteur)) || !(await this.visibilite(moi, m.auteur)).lectures);
        if (m.auteur !== moi && !retenu) {
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
        const autres = await this.destinatairesPermis(m.conversation, moi);
        if (!autres) return;
        await Promise.allSettled(autres.map((id) => this.boite(id).signalerEcriture(moi, m.conversation)));
        return;
      }
      case "presence": {
        // Bloqué dans un sens ou dans l'autre : ni « en ligne » ni « vu à ».
        if (m.de !== moi && this.bloqueDansUnSens(await this.blocage(moi, m.de))) {
          this.envoyer(ws, { t: "presence", de: m.de, enLigne: false, vuLe: null });
          return;
        }
        if (m.de === moi) {
          this.envoyer(ws, { t: "presence", de: m.de, ...(await this.presence()) });
          return;
        }
        const permis = await this.visibilite(moi, m.de);
        if (!permis.vu && !permis.enLigne) {
          this.envoyer(ws, { t: "presence", de: m.de, enLigne: false, vuLe: null });
          return;
        }
        const etat = await this.boite(m.de).presence();
        this.envoyer(ws, { t: "presence", de: m.de, enLigne: permis.enLigne && etat.enLigne, vuLe: permis.vu ? etat.vuLe : null });
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
      case "preference":
        return this.preference(ws, moi, m.conversation, m.preference);
      case "modifier":
        return this.partager(ws, moi, m.conversation, {
          type: "modification",
          conversation: m.conversation,
          message: m.message,
          par: moi,
          texte: m.texte,
          le: Date.now(),
        });
      case "epingler":
        return this.partager(ws, moi, m.conversation, {
          type: "epingle",
          conversation: m.conversation,
          message: m.message,
          par: moi,
          jusqua: m.jusqua,
          le: Date.now(),
        });
      case "ephemere":
        return this.partager(ws, moi, m.conversation, {
          type: "ephemere",
          conversation: m.conversation,
          par: moi,
          duree: m.duree,
          le: Date.now(),
        });
      case "voter":
        return this.partager(ws, moi, m.conversation, {
          type: "vote",
          conversation: m.conversation,
          message: m.message,
          par: moi,
          choix: [...new Set(m.choix)],
          le: Date.now(),
        });
      case "ouvert": {
        if ((await this.participants(m.conversation, moi)) === null) return;
        const entree: NouvelleEntree = { type: "ouvert", conversation: m.conversation, message: m.message, par: moi, le: Date.now() };
        if (m.auteur !== moi) await this.distribuer([m.auteur], entree);
        this.ajouter(entree);
        return;
      }
      case "important": {
        // Comme les réglages : une affaire entre moi et mes appareils.
        if ((await this.participants(m.conversation, moi)) === null && !estGroupe(m.conversation)) {
          this.envoyer(ws, { t: "refuse", message: "Vous ne faites pas partie de cette discussion." });
          return;
        }
        this.ajouter({ type: "important", conversation: m.conversation, message: m.message, important: m.important, le: Date.now() });
        return;
      }
    }
  }

  /** Réglage d'une discussion : il ne concerne que moi, il ne va que dans ma boîte. */
  private preference(ws: WebSocket, moi: string, conversation: string, preference: Preference): void {
    if (!estGroupe(conversation)) {
      const [, x, y] = conversation.split(":");
      if (x !== moi && y !== moi) {
        this.envoyer(ws, { t: "refuse", message: "Vous ne faites pas partie de cette discussion." });
        return;
      }
    }
    this.ajouter({ type: "preference", conversation, preference, le: Date.now() });
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
      if (a !== moi) {
        const relation = await this.blocage(moi, a);
        if (relation.jeBloque) {
          this.envoyer(ws, { t: "refuse", id: m.id, message: "Vous avez bloqué ce contact. Débloquez-le pour lui écrire." });
          return;
        }
        // Bloqué par le destinataire : le message est accepté mais ne lui parvient
        // jamais. L'expéditeur reste sur une coche, sans être averti du blocage.
        if (relation.ilBloque) destinataires = [];
      }
    }
    // Discussion à deux : on annonce toujours un destinataire, même bloqué (sauf à soi-même).
    const annonces = m.groupe || m.a === moi ? destinataires.length : 1;

    // Renvoi après une coupure : déjà accepté, on confirme sans redistribuer.
    const deja = this.sql
      .exec<{ contenu: string }>("SELECT contenu FROM journal WHERE message_id = ? AND type = 'message' AND expediteur = ?", m.id, moi)
      .toArray()[0];
    if (deja) {
      const { message } = JSON.parse(deja.contenu) as { message: Message };
      this.envoyer(ws, { t: "accepte", id: m.id, le: message.le, destinataires: annonces });
      return;
    }

    let media: MediaMessage | undefined;
    if (m.media) {
      // Un message ne peut joindre qu'un fichier que son auteur a envoyé,
      // entièrement, pour cette discussion.
      const ligne = await this.env.DB.prepare(
        `SELECT id, type, mime, nom, taille FROM medias
         WHERE id = ?1 AND proprietaire = ?2 AND conversation = ?3 AND fichier_id IS NOT NULL AND expire_le > ?4`,
      )
        .bind(m.media.id, moi, conversation, maintenant)
        .first<Pick<MediaMessage, "id" | "type" | "mime" | "nom" | "taille">>();
      if (!ligne) {
        this.envoyer(ws, { t: "refuse", id: m.id, message: "Le fichier n'est pas arrivé jusqu'au serveur. Réessayez." });
        return;
      }
      const { id: _, ...declare } = m.media;
      media = { ...ligne, ...declare };
    }

    // Fiche de contact : le nom et le pseudo viennent de la base, pas de l'expéditeur.
    let contact: Message["contact"];
    if (m.contact) {
      const fiche = await this.env.DB.prepare("SELECT id, nom, pseudo FROM utilisateurs WHERE id = ?1 AND pseudo IS NOT NULL")
        .bind(m.contact.id)
        .first<{ id: string; nom: string; pseudo: string }>();
      if (!fiche) {
        this.envoyer(ws, { t: "refuse", id: m.id, message: "Cette personne n'existe pas ou plus sur UniChat." });
        return;
      }
      contact = fiche;
    }

    const message: Message = {
      id: m.id,
      conversation,
      de: moi,
      a: m.groupe ?? m.a!,
      texte: m.texte.trim(),
      le: maintenant,
      ...(media ? { media } : {}),
      ...(m.reponseA ? { reponseA: m.reponseA } : {}),
      ...(m.transfere ? { transfere: m.transfere } : {}),
      ...(m.lien ? { lien: m.lien } : {}),
      // Les mentions n'ont de sens que dans un groupe.
      ...(m.groupe && m.mentions?.length ? { mentions: [...new Set(m.mentions)] } : {}),
      ...(m.ephemere ? { ephemere: m.ephemere } : {}),
      ...(m.position ? { position: m.position } : {}),
      ...(contact ? { contact } : {}),
      ...(m.sondage ? { sondage: m.sondage } : {}),
    };
    await this.distribuer(destinataires, { type: "message", message });
    // Copie dans ma propre boîte : mes autres appareils voient ce que j'envoie.
    this.ajouter({ type: "message", message });
    this.envoyer(ws, { t: "accepte", id: m.id, le: maintenant, destinataires: annonces });
  }

  /** Réaction ou suppression : transmise à chaque participant et à mes autres appareils. */
  private async partager(ws: WebSocket, moi: string, conversation: string, entree: NouvelleEntree): Promise<void> {
    const autres = await this.destinatairesPermis(conversation, moi);
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

  /**
   * Participants à qui transmettre réactions, suppressions et « écrit… » :
   * dans une discussion à deux, personne si un blocage existe dans un sens ou
   * dans l'autre. Les groupes ne sont pas concernés, comme dans WhatsApp.
   */
  private async destinatairesPermis(conversation: string, moi: string): Promise<string[] | null> {
    const autres = await this.participants(conversation, moi);
    if (!autres || estGroupe(conversation) || autres.length === 0) return autres;
    return this.bloqueDansUnSens(await this.blocage(moi, autres[0]!)) ? [] : autres;
  }

  private async blocage(moi: string, autre: string): Promise<{ jeBloque: boolean; ilBloque: boolean }> {
    if (autre === moi) return AUCUN_BLOCAGE;
    // Une boîte n'appartient qu'à une personne : l'autre suffit comme clé.
    const connu = this.blocagesConnus.get(autre);
    if (connu && connu.expire > Date.now()) return connu;
    const relation = await blocageEntre(this.env.DB, moi, autre);
    this.blocagesConnus.set(autre, { ...relation, expire: Date.now() + DUREE_CACHE_BLOCAGES });
    return relation;
  }

  /**
   * Relu à chaque fois, sans cache : quand quelqu'un cache sa présence, cela
   * doit valoir tout de suite pour tous. Une lecture D1 par demande de
   * présence (toutes les 30 s par discussion ouverte) reste peu de chose.
   */
  private visibilite(moi: string, autre: string): Promise<Visibilites> {
    return visibilites(this.env.DB, moi, autre);
  }

  private bloqueDansUnSens(r: { jeBloque: boolean; ilBloque: boolean }): boolean {
    return r.jeBloque || r.ilBloque;
  }

  private async distribuer(destinataires: string[], entree: NouvelleEntree): Promise<void> {
    const resultats = await Promise.allSettled(destinataires.map((id) => this.boite(id).recevoir(entree, id)));
    for (const r of resultats) if (r.status === "rejected") console.warn("remise impossible", String(r.reason));
  }

  // --- Appels des autres boîtes et du serveur (RPC) -------------------------------

  /** `proprietaire` : à qui appartient cette boîte (elle ne connaît pas son propre nom). */
  async recevoir(entree: NouvelleEntree, proprietaire?: string): Promise<void> {
    if (entree.type === "blocage") this.blocagesConnus.delete(entree.personne);
    this.ajouter(entree);
    // La notification part sans retarder l'expéditeur.
    if (entree.type === "message" && proprietaire && entree.message.de !== proprietaire) {
      this.ctx.waitUntil(this.notifier(proprietaire, entree.message).catch((e) => console.warn("notification non envoyée", String(e))));
    }
  }

  /**
   * Notification Web Push vers chaque appareil abonné (session encore valable).
   * Discussion en sourdine : rien, sauf si l'on m'y mentionne. L'application
   * n'affiche rien quand elle est déjà sous les yeux (service worker).
   */
  private async notifier(moi: string, message: Message): Promise<void> {
    const cles = vapid(this.env);
    if (!cles) return;
    const maintenant = Date.now();
    const sourdine = this.sql
      .exec<{ valeur: string }>("SELECT valeur FROM etat WHERE cle = ?", `muet:${message.conversation}`)
      .toArray()[0];
    if (sourdine && Number(sourdine.valeur) > maintenant && !message.mentions?.includes(moi)) return;

    const { results: abonnements } = await this.env.DB.prepare(
      `SELECT a.endpoint, a.p256dh, a.auth FROM abonnements_push a JOIN sessions s ON s.id = a.session_id
       WHERE a.utilisateur_id = ?1 AND s.revoquee_le IS NULL AND s.expire_le > ?2 LIMIT 10`,
    )
      .bind(moi, maintenant)
      .all<{ endpoint: string; p256dh: string; auth: string }>();
    if (abonnements.length === 0) return;

    const auteur = await this.env.DB.prepare("SELECT nom FROM utilisateurs WHERE id = ?1").bind(message.de).first<{ nom: string }>();
    const groupe = estGroupe(message.conversation)
      ? await this.env.DB.prepare("SELECT nom FROM groupes WHERE id = ?1").bind(idGroupe(message.conversation)).first<{ nom: string }>()
      : null;
    const nom = auteur?.nom ?? "Quelqu'un";
    const resume = resumer(message);
    const notification = {
      titre: groupe ? groupe.nom : nom,
      corps: groupe ? `${nom} : ${resume}` : resume,
      conversation: message.conversation,
    };
    await Promise.allSettled(
      abonnements.map(async (a) => {
        const statut = await pousser((entree, init) => fetch(entree, init), a, notification, cles, maintenant);
        // Abonnement disparu (application désinstallée, permission retirée) : on l'oublie.
        if (statut === 404 || statut === 410) await this.env.DB.prepare("DELETE FROM abonnements_push WHERE endpoint = ?1").bind(a.endpoint).run();
      }),
    );
  }

  /** Blocage posé ou levé par quelqu'un : il s'applique tout de suite, sans attendre le cache. */
  async oublierBlocage(autre: string): Promise<void> {
    this.blocagesConnus.delete(autre);
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
    if (e.type === "preference" && e.preference.muetJusqua !== undefined) {
      if (e.preference.muetJusqua) {
        this.sql.exec("INSERT OR REPLACE INTO etat (cle, valeur) VALUES (?, ?)", `muet:${e.conversation}`, String(e.preference.muetJusqua));
      } else this.sql.exec("DELETE FROM etat WHERE cle = ?", `muet:${e.conversation}`);
    }
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
    const ligne = await this.env.DB.prepare("SELECT 1 AS ok FROM utilisateurs WHERE id = ?1 AND pseudo IS NOT NULL AND suspendu_le IS NULL").bind(id).first();
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
