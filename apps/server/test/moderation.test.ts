import { describe, expect, it } from "vitest";
import { conversationDirecte, type CarteProfil, type Entree, type MessageServeur, type Moi } from "@unichat/shared";
import { env } from "cloudflare:workers";
import { identite, preparer } from "./outils";

type Contexte = Awaited<ReturnType<typeof preparer>>;
type Appareil = Awaited<ReturnType<Contexte["connecter"]>>;

async function personne(t: Contexte, prefixe: string) {
  const appareil = await t.connecter(identite(prefixe));
  const moi = (await (await appareil.appel("/api/moi", {
    method: "PATCH",
    json: { pseudo: `${prefixe}_${crypto.randomUUID().slice(0, 8)}` },
  })).json()) as Moi;
  return { appareil, id: moi.id };
}

async function ouvrir(appareil: Appareil) {
  const ws = await appareil.tempsReel();
  if (ws.refus !== null) throw new Error(`refus ${ws.refus}`);
  ws.envoyer({ t: "bonjour", depuis: null });
  await ws.attendre((m): m is Extract<MessageServeur, { t: "lot" }> => m.t === "lot");
  return ws;
}

type Connexion = Awaited<ReturnType<typeof ouvrir>>;

const messageRecu = (id: string) => (m: MessageServeur): m is Extract<MessageServeur, { t: "entree" }> =>
  m.t === "entree" && m.entree.type === "message" && m.entree.message.id === id;

/** Le message n'arrive pas : on attend un peu, puis on vérifie qu'il manque. */
async function absent(ws: Connexion, id: string): Promise<boolean> {
  return ws.attendre(messageRecu(id), 400).then(
    () => false,
    () => true,
  );
}

function ecrire(ws: Connexion, a: string, texte = "Bonjour") {
  const id = crypto.randomUUID();
  ws.envoyer({ t: "envoyer", id, a, texte });
  return id;
}

describe("blocage", () => {
  it("coupe les messages, la présence et le profil, sans prévenir la personne bloquée", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    const wsAna = await ouvrir(ana.appareil);
    const wsBob = await ouvrir(bob.appareil);

    const reponse = await ana.appareil.appel("/api/blocages", { method: "POST", json: { id: bob.id } });
    expect(reponse.status).toBe(201);
    expect(((await reponse.json()) as CarteProfil).bloque).toBe(true);
    // Mes autres appareils l'apprennent par le journal.
    const annonce = await wsAna.attendre(
      (m): m is Extract<MessageServeur, { t: "entree" }> => m.t === "entree" && m.entree.type === "blocage",
    );
    expect(annonce.entree).toMatchObject({ type: "blocage", personne: bob.id, bloque: true, conversation: conversationDirecte(ana.id, bob.id) });

    // Bob écrit : accepté (une coche), jamais remis.
    const id = ecrire(wsBob, ana.id);
    const accepte = await wsBob.attendre((m): m is Extract<MessageServeur, { t: "accepte" }> => m.t === "accepte" && m.id === id);
    expect(accepte.destinataires).toBe(1);
    expect(await absent(wsAna, id)).toBe(true);

    // Ana ne peut plus écrire à Bob tant qu'elle ne l'a pas débloqué.
    const idAna = ecrire(wsAna, bob.id);
    const refus = await wsAna.attendre((m): m is Extract<MessageServeur, { t: "refuse" }> => m.t === "refuse" && m.id === idAna);
    expect(refus.message).toContain("bloqué");

    // Bob ne voit plus ni « en ligne » ni les infos d'Ana, et rien ne lui dit pourquoi.
    wsBob.envoyer({ t: "presence", de: ana.id });
    const presence = await wsBob.attendre((m): m is Extract<MessageServeur, { t: "presence" }> => m.t === "presence" && m.de === ana.id);
    expect(presence).toMatchObject({ enLigne: false, vuLe: null });
    const vueParBob = (await (await bob.appareil.appel(`/api/personnes/${ana.id}`)).json()) as CarteProfil;
    expect(vueParBob).toMatchObject({ infos: null, photo: null, bloque: false });

    const liste = (await (await ana.appareil.appel("/api/blocages")).json()) as { bloques: CarteProfil[] };
    expect(liste.bloques.map((c) => c.id)).toEqual([bob.id]);

    // Débloqué : effet immédiat, sans attendre les caches.
    const deblocage = await ana.appareil.appel(`/api/blocages/${bob.id}`, { method: "DELETE" });
    expect(((await deblocage.json()) as CarteProfil).bloque).toBe(false);
    const apres = ecrire(wsBob, ana.id, "Tu me reçois ?");
    await wsAna.attendre(messageRecu(apres));
  });

  it("n'ajoute pas à un groupe une personne qui m'a bloqué", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    await bob.appareil.appel("/api/contacts", { method: "POST", json: { id: ana.id } });
    await ana.appareil.appel("/api/blocages", { method: "POST", json: { id: bob.id } });
    const r = await bob.appareil.appel("/api/groupes", { method: "POST", json: { nom: "Sortie", membres: [ana.id] } });
    expect(r.status).toBe(403);
  });

  it("refuse de se bloquer soi-même", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const r = await ana.appareil.appel("/api/blocages", { method: "POST", json: { id: ana.id } });
    expect(r.status).toBe(400);
  });
});

describe("signalement", () => {
  it("garde les derniers messages de la personne signalée et peut la bloquer dans la foulée", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    const message = { id: crypto.randomUUID(), de: bob.id, texte: "Achète mes cryptos", le: Date.now() };

    // Un message d'un tiers (ici, d'Ana elle-même) ne peut pas être joint.
    const mauvais = await ana.appareil.appel("/api/signalements", {
      method: "POST",
      json: { type: "personne", cible: bob.id, messages: [{ ...message, de: ana.id }] },
    });
    expect(mauvais.status).toBe(400);

    const r = await ana.appareil.appel("/api/signalements", {
      method: "POST",
      json: { type: "personne", cible: bob.id, messages: [message], bloquer: true },
    });
    expect(r.status).toBe(201);
    const ligne = await env.DB.prepare("SELECT type, messages FROM signalements WHERE auteur_id = ?1 AND cible_id = ?2")
      .bind(ana.id, bob.id)
      .first<{ type: string; messages: string }>();
    expect(ligne?.type).toBe("personne");
    expect((JSON.parse(ligne!.messages) as Entree[]).length).toBe(1);
    const liste = (await (await ana.appareil.appel("/api/blocages")).json()) as { bloques: CarteProfil[] };
    expect(liste.bloques.map((c) => c.id)).toEqual([bob.id]);
  });

  it("refuse plus de cinq messages", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    const messages = Array.from({ length: 6 }, () => ({ id: crypto.randomUUID(), de: bob.id, texte: "x", le: 1 }));
    const r = await ana.appareil.appel("/api/signalements", { method: "POST", json: { type: "personne", cible: bob.id, messages } });
    expect(r.status).toBe(400);
  });
});

describe("réglages d'une discussion", () => {
  it("passent par ma boîte, jusqu'à mes autres appareils, et seulement eux", async () => {
    const t = await preparer();
    const identiteAna = identite("ana");
    const ana = await t.connecter(identiteAna);
    const moi = (await (await ana.appel("/api/moi", { method: "PATCH", json: { pseudo: `ana_${crypto.randomUUID().slice(0, 8)}` } })).json()) as Moi;
    const autreAppareil = await t.connecter(identiteAna);
    const bob = await personne(t, "bob");
    const wsAna = await ouvrir(ana);
    const wsAutre = await ouvrir(autreAppareil);
    const wsBob = await ouvrir(bob.appareil);

    const conversation = conversationDirecte(moi.id, bob.id);
    wsAna.envoyer({ t: "preference", conversation, preference: { favori: true, muetJusqua: Date.now() + 8 * 3600_000 } });
    const recu = await wsAutre.attendre(
      (m): m is Extract<MessageServeur, { t: "entree" }> => m.t === "entree" && m.entree.type === "preference",
    );
    expect(recu.entree).toMatchObject({ conversation, preference: { favori: true } });
    const chezBob = await wsBob
      .attendre((m): m is Extract<MessageServeur, { t: "entree" }> => m.t === "entree" && m.entree.type === "preference", 400)
      .then(() => true, () => false);
    expect(chezBob).toBe(false);

    // Une discussion dont je ne fais pas partie est refusée.
    const etrangere = conversationDirecte(bob.id, crypto.randomUUID());
    wsAna.envoyer({ t: "preference", conversation: etrangere, preference: { archive: true } });
    await wsAna.attendre((m): m is Extract<MessageServeur, { t: "refuse" }> => m.t === "refuse");
  });
});
