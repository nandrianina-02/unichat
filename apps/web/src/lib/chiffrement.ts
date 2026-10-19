import {
  associeContenu,
  schemaContenuAction,
  schemaContenuMessage,
  type AppareilsCompte,
  type ContenuAction,
  type ContenuMessage,
  type EnveloppeChiffree,
  type MessageClient,
  type PaquetsCompte,
} from "@unichat/shared";
import type { CleSignee, CleUnique, Correspondant, IdentitePrivee, IdentitePublique, Paquet } from "@unichat/chiffrement";
import { api } from "./api";
import { sousVerrou } from "./cles";
import type { Stockage } from "./stockage";

/**
 * Chiffrement des discussions à deux (étape 3, lot 3).
 *
 * Un contenu est scellé une fois sous une clé aléatoire ; cette clé (suivie
 * de l'identifiant du message, pour la lier à lui) part vers chaque appareil
 * du destinataire et vers mes autres appareils, par la session Double
 * Ratchet de chacun. Tout passe sous le verrou des clés : deux onglets ne
 * font jamais avancer la même session en même temps.
 */

const bibliotheque = () => import("@unichat/chiffrement");

/** Liste des appareils d'un compte : relue au plus toutes les 5 minutes, ou aussitôt après un refus du serveur. */
const FRAICHEUR = 5 * 60 * 1000;

interface Fiche {
  identite: AppareilsCompte["identite"] | null;
  appareils: number[];
  le: number;
}

interface AppareilLocal {
  numero: number | null;
}

export type Dechiffrement =
  | { type: "message"; contenu: ContenuMessage }
  | { type: "action"; contenu: ContenuAction }
  /** Pas de clé pour cet appareil (relié après l'envoi), ou session rompue. */
  | { type: "illisible" }
  /** Envoyé par cet appareil même : il a déjà le contenu. */
  | { type: "ignore" };

export type EnveloppeSortante = Extract<MessageClient, { t: "chiffre" }>;

/** À qui chiffrer : l'autre personne d'une discussion à deux, ou les membres d'un groupe. */
export interface Destination {
  conversation: string;
  /** Discussion à deux : l'autre personne (ou moi, discussion avec soi-même). */
  a?: string;
  groupe?: string;
  /** Comptes visés, moi exclu : mes autres appareils sont ajoutés d'office. */
  comptes: string[];
  /** Action de groupe réservée à un membre (vue unique ouverte). */
  pour?: string;
  /** Membres mentionnés (groupe) : en clair dans l'enveloppe, pour la sourdine. */
  mentions?: string[];
}

const cleCorrespondant = (compte: string, numero: number) => `correspondant:${compte}:${numero}`;

export class Chiffreur {
  private readonly annuaire = new Map<string, Fiche>();

  constructor(
    private readonly db: Stockage,
    private readonly moi: string,
  ) {}

  /** Le serveur a refusé une liste d'appareils : on la relira avant de rechiffrer. */
  oublier(comptes: string[]): void {
    for (const id of comptes) this.annuaire.delete(id);
  }

  private async local(): Promise<{ identite: IdentitePrivee; numero: number; signees: CleSignee[] } | null> {
    const [identite, appareil, signees] = await Promise.all([
      this.db.get("cles", "identite") as Promise<IdentitePrivee | undefined>,
      this.db.get("cles", "appareil") as Promise<AppareilLocal | undefined>,
      this.db.get("cles", "signees") as Promise<CleSignee[] | undefined>,
    ]);
    if (!identite || !appareil?.numero) return null;
    return { identite, numero: appareil.numero, signees: signees ?? [] };
  }

  private async fiches(comptes: string[]): Promise<Map<string, Fiche>> {
    const maintenant = Date.now();
    const aLire = comptes.filter((id) => (this.annuaire.get(id)?.le ?? 0) < maintenant - FRAICHEUR);
    if (aLire.length) {
      const { comptes: lus } = await api.appareilsCles(aLire);
      for (const id of aLire) {
        const c = lus.find((x) => x.id === id);
        this.annuaire.set(id, { identite: c?.identite ?? null, appareils: c?.appareils ?? [], le: maintenant });
      }
    }
    return new Map(comptes.map((id) => [id, this.annuaire.get(id)!]));
  }

  /**
   * Identité d'un correspondant, épinglée au premier contact. Si elle change
   * (clés refaites), la nouvelle est retenue et le changement noté : le
   * lot 7 l'affichera dans la discussion.
   */
  private async epingler(compte: string, identite: IdentitePublique): Promise<void> {
    const { versBase64 } = await bibliotheque();
    const empreinte = `${versBase64(identite.signature)}.${versBase64(identite.echange)}`;
    const connue = (await this.db.get("cles", `identite:${compte}`)) as string | undefined;
    if (connue === empreinte) return;
    await this.db.put("cles", empreinte, `identite:${compte}`);
    if (connue) await this.db.put("cles", Date.now(), `changement:${compte}`);
  }

  /**
   * Enveloppe chiffrée, ou null si un destinataire n'a pas encore de clés
   * (ou si cet appareil n'est pas relié) : le message part alors en clair,
   * le temps de la transition.
   */
  chiffrer(d: Destination, id: string, genre: "message" | "action", contenu: ContenuMessage | ContenuAction): Promise<EnveloppeSortante | null> {
    return sousVerrou(this.moi, async () => {
      const c = await bibliotheque();
      const local = await this.local();
      if (!local) return null;
      const { conversation } = d;
      const comptes = [...new Set([...d.comptes.filter((x) => x !== this.moi), this.moi])];
      const fiches = await this.fiches(comptes);
      if (comptes.some((x) => x !== this.moi && !fiches.get(x)?.identite)) return null;

      // Appareils visés, et ceux avec qui aucune session n'est encore ouverte.
      const cibles: { compte: string; numero: number; correspondant?: Correspondant }[] = [];
      for (const compte of comptes) {
        for (const numero of fiches.get(compte)!.appareils) {
          if (compte === this.moi && numero === local.numero) continue;
          const correspondant = (await this.db.get("cles", cleCorrespondant(compte, numero))) as Correspondant | undefined;
          cibles.push({ compte, numero, correspondant });
        }
      }
      const sansSession = cibles.filter((x) => !x.correspondant?.sessions[0]?.ratchet.cks);
      const paquets = new Map<string, Paquet>();
      if (sansSession.length) {
        const demande = comptes
          .map((id) => ({ id, appareils: sansSession.filter((x) => x.compte === id).map((x) => x.numero) }))
          .filter((d) => d.appareils.length);
        const { comptes: recus } = await api.paquets(demande);
        for (const compte of recus) {
          for (const p of versPaquets(c, compte)) {
            // Un paquet mal signé, ou d'une autre identité que la mienne pour mes appareils, est écarté.
            if (!c.verifierPaquet(p.paquet)) continue;
            if (compte.id === this.moi && !c.memeIdentite(p.paquet.identite, c.identitePublique(local.identite))) continue;
            paquets.set(`${compte.id}:${p.numero}`, p.paquet);
          }
          const premier = paquets.get(`${compte.id}:${compte.appareils[0]?.numero}`);
          if (premier) await this.epingler(compte.id, premier.identite);
        }
      }

      const cle = c.aleatoire(32);
      const corps = c.sceller(cle, c.texteVersOctets(JSON.stringify(contenu)), c.texteVersOctets(associeContenu(id, conversation, this.moi)));
      const charge = c.assembler(cle, c.texteVersOctets(id));
      const cles: Record<string, Record<string, string>> = Object.fromEntries(comptes.map((compte) => [compte, {}]));
      for (const x of cibles) {
        const paquet = paquets.get(`${x.compte}:${x.numero}`);
        // Appareil disparu entre-temps : le serveur renverra la bonne liste.
        if (!x.correspondant?.sessions[0]?.ratchet.cks && !paquet) continue;
        const { correspondant, message } = c.chiffrer(x.correspondant, local.identite, charge, paquet);
        // Rangé avant que le message parte : une clé de message ne doit jamais servir deux fois.
        await this.db.put("cles", correspondant, cleCorrespondant(x.compte, x.numero));
        cles[x.compte]![String(x.numero)] = c.versBase64(message);
      }
      return {
        t: "chiffre",
        id,
        ...(d.groupe ? { groupe: d.groupe } : { a: d.a ?? this.moi }),
        ...(d.pour ? { pour: d.pour } : {}),
        ...(d.mentions?.length ? { mentions: d.mentions } : {}),
        genre,
        corps: c.versBase64(corps),
        cles,
      };
    });
  }

  /**
   * La discussion part-elle chiffrée ? Sert à chiffrer un fichier avant son
   * envoi, avant même que le message existe : même règle que chiffrer().
   */
  async peutChiffrer(d: Destination): Promise<boolean> {
    if (!(await this.local())) return false;
    const comptes = [...new Set([...d.comptes.filter((x) => x !== this.moi), this.moi])];
    const fiches = await this.fiches(comptes);
    return comptes.every((x) => x === this.moi || Boolean(fiches.get(x)?.identite));
  }

  /** Déchiffre un lot d'enveloppes, dans l'ordre du journal ; le résultat est indexé par identifiant. */
  dechiffrerLot(enveloppes: EnveloppeChiffree[]): Promise<Map<string, Dechiffrement>> {
    return sousVerrou(this.moi, async () => {
      const resultats = new Map<string, Dechiffrement>();
      if (enveloppes.length === 0) return resultats;
      const c = await bibliotheque();
      const local = await this.local();
      for (const e of enveloppes) {
        if (!local) {
          resultats.set(e.id, { type: "illisible" });
          continue;
        }
        if (e.de === this.moi && e.deAppareil === local.numero) {
          resultats.set(e.id, { type: "ignore" });
          continue;
        }
        resultats.set(e.id, await this.dechiffrerUne(c, local, e));
      }
      return resultats;
    });
  }

  private async dechiffrerUne(
    c: Awaited<ReturnType<typeof bibliotheque>>,
    local: { identite: IdentitePrivee; numero: number; signees: CleSignee[] },
    e: EnveloppeChiffree,
  ): Promise<Dechiffrement> {
    const brut = e.cles[String(local.numero)];
    if (!brut) return { type: "illisible" };
    let message: Uint8Array;
    try {
      message = c.depuisBase64(brut);
    } catch {
      return { type: "illisible" };
    }
    const exigences = c.exigencesOuverture(message);
    const unique = exigences?.cleUniqueId ? ((await this.db.get("cles", `unique:${exigences.cleUniqueId}`)) as CleUnique | undefined) : undefined;
    const cle = cleCorrespondant(e.de, e.deAppareil);
    const correspondant = (await this.db.get("cles", cle)) as Correspondant | undefined;

    let resultat;
    try {
      resultat = c.dechiffrer(correspondant, message, {
        identite: local.identite,
        cleSignee: (id) => local.signees.find((s) => s.id === id),
        cleUnique: (id) => (unique?.id === id ? unique : undefined),
      });
    } catch {
      return { type: "illisible" };
    }
    // La session a avancé : on la range, quoi qu'il advienne du contenu.
    await this.db.put("cles", resultat.correspondant, cle);
    if (resultat.cleUniqueUtilisee) await this.db.delete("cles", `unique:${resultat.cleUniqueUtilisee}`);
    if (resultat.nouvelleSession) await this.epingler(e.de, resultat.identite);

    if (resultat.clair.length < 33 || c.octetsVersTexte(resultat.clair.slice(32)) !== e.id) return { type: "illisible" };
    try {
      const ouvert = c.ouvrir(resultat.clair.slice(0, 32), c.depuisBase64(e.corps), c.texteVersOctets(associeContenu(e.id, e.conversation, e.de)));
      const brutContenu = JSON.parse(c.octetsVersTexte(ouvert)) as unknown;
      if (e.genre === "message") {
        const lu = schemaContenuMessage.safeParse(brutContenu);
        return lu.success ? { type: "message", contenu: lu.data } : { type: "illisible" };
      }
      const lu = schemaContenuAction.safeParse(brutContenu);
      return lu.success ? { type: "action", contenu: lu.data } : { type: "illisible" };
    } catch {
      return { type: "illisible" };
    }
  }
}

function versPaquets(c: Awaited<ReturnType<typeof bibliotheque>>, compte: PaquetsCompte): { numero: number; paquet: Paquet }[] {
  const identite = { signature: c.depuisBase64(compte.identite.signature), echange: c.depuisBase64(compte.identite.echange), preuve: c.depuisBase64(compte.identite.preuve) };
  return compte.appareils.map((a) => ({
    numero: a.numero,
    paquet: {
      identite,
      cleSignee: { id: a.cleSignee.id, cle: c.depuisBase64(a.cleSignee.cle), signature: c.depuisBase64(a.cleSignee.signature) },
      ...(a.cleUnique ? { cleUnique: { id: a.cleUnique.id, cle: c.depuisBase64(a.cleUnique.cle) } } : {}),
    },
  }));
}
