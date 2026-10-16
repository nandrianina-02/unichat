import { describe, expect, it } from "vitest";
import { conversationDirecte, type Entree, type MessageServeur, type Moi } from "@unichat/shared";
import { env } from "cloudflare:workers";
import { nettoyerMedias } from "../src/lib/nettoyage";
import { identite, preparer } from "./outils";

type Contexte = Awaited<ReturnType<typeof preparer>>;

async function personne(t: Contexte, prefixe: string) {
  const appareil = await t.connecter(identite(prefixe));
  const moi = (await (await appareil.appel("/api/moi", {
    method: "PATCH",
    json: { pseudo: `${prefixe}_${crypto.randomUUID().slice(0, 8)}` },
  })).json()) as Moi;
  return { appareil, id: moi.id };
}

async function ouvrir(appareil: Awaited<ReturnType<Contexte["connecter"]>>) {
  const ws = await appareil.tempsReel();
  if (ws.refus !== null) throw new Error(`refus ${ws.refus}`);
  ws.envoyer({ t: "bonjour", depuis: null });
  await ws.attendre((m): m is Extract<MessageServeur, { t: "lot" }> => m.t === "lot");
  return ws;
}

// Début d'un JPEG, puis du contenu : 10 octets envoyés en deux morceaux.
const CONTENU = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]);

async function envoyerFichier(
  appareil: Awaited<ReturnType<Contexte["connecter"]>>,
  conversation: string,
  options: { nom?: string; mime?: string } = {},
) {
  const r = await appareil.appel("/api/medias", {
    method: "POST",
    json: { conversation, nom: options.nom ?? "photo.jpg", mime: options.mime ?? "image/jpeg", taille: CONTENU.length },
  });
  expect(r.status).toBe(201);
  const { id } = (await r.json()) as { id: string };
  const premier = await appareil.appel(`/api/medias/${id}`, {
    method: "PUT",
    headers: { "Content-Range": `bytes 0-5/${CONTENU.length}` },
    body: CONTENU.slice(0, 6),
  });
  expect(await premier.json()).toEqual({ recu: 6, termine: false });
  const second = await appareil.appel(`/api/medias/${id}`, {
    method: "PUT",
    headers: { "Content-Range": `bytes 6-9/${CONTENU.length}` },
    body: CONTENU.slice(6),
  });
  expect(await second.json()).toEqual({ recu: CONTENU.length, termine: true });
  return id;
}

describe("fichiers joints", () => {
  it("envoie un fichier par morceaux, le joint à un message et le sert au destinataire", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    const conversation = conversationDirecte(ana.id, bob.id);
    const mediaId = await envoyerFichier(ana.appareil, conversation, { nom: "vacances/plage.jpg" });

    const [wsAna, wsBob] = await Promise.all([ouvrir(ana.appareil), ouvrir(bob.appareil)]);
    const id = crypto.randomUUID();
    wsAna.envoyer({ t: "envoyer", id, a: bob.id, texte: "La plage", media: { id: mediaId, largeur: 800, hauteur: 600 } });
    const recu = await wsBob.attendre(
      (m): m is Extract<MessageServeur, { t: "entree" }> => m.t === "entree" && m.entree.type === "message",
    );
    const message = (recu.entree as Extract<Entree, { type: "message" }>).message;
    // Type, nom et taille viennent du serveur, pas de la déclaration de l'application.
    expect(message.media).toEqual({
      id: mediaId,
      type: "image",
      mime: "image/jpeg",
      nom: "vacancesplage.jpg",
      taille: CONTENU.length,
      largeur: 800,
      hauteur: 600,
    });

    const telechargement = await bob.appareil.appel(`/api/medias/${mediaId}`);
    expect(telechargement.status).toBe(200);
    expect(telechargement.headers.get("Content-Type")).toBe("image/jpeg");
    expect(telechargement.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(new Uint8Array(await telechargement.arrayBuffer())).toEqual(CONTENU);
  });

  it("ne sert un fichier qu'aux participants de la discussion", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    const intrus = await personne(t, "intrus");
    const mediaId = await envoyerFichier(ana.appareil, conversationDirecte(ana.id, bob.id));
    expect((await intrus.appareil.appel(`/api/medias/${mediaId}`)).status).toBe(404);
    // Ni envoyer un fichier dans une discussion dont on ne fait pas partie.
    const r = await intrus.appareil.appel("/api/medias", {
      method: "POST",
      json: { conversation: conversationDirecte(ana.id, bob.id), nom: "x.jpg", mime: "image/jpeg", taille: 10 },
    });
    expect(r.status).toBe(403);
  });

  it("refuse les types non pris en charge et les fichiers trop lourds", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    const conversation = conversationDirecte(ana.id, bob.id);
    for (const corps of [
      { conversation, nom: "logo.svg", mime: "image/svg+xml", taille: 100 },
      { conversation, nom: "outil.exe", mime: "application/octet-stream", taille: 100 },
      { conversation, nom: "film.mp4", mime: "video/mp4", taille: 65 * 1024 * 1024 },
    ]) {
      expect((await ana.appareil.appel("/api/medias", { method: "POST", json: corps })).status, corps.nom).toBe(400);
    }
  });

  it("refuse de joindre le fichier d'un autre, ou un fichier incomplet", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    const conversation = conversationDirecte(ana.id, bob.id);
    const fichierDeBob = await envoyerFichier(bob.appareil, conversation);
    const incomplet = (await (await ana.appareil.appel("/api/medias", {
      method: "POST",
      json: { conversation, nom: "x.jpg", mime: "image/jpeg", taille: 10 },
    })).json()) as { id: string };

    const ws = await ouvrir(ana.appareil);
    for (const mediaId of [fichierDeBob, incomplet.id]) {
      const id = crypto.randomUUID();
      ws.envoyer({ t: "envoyer", id, a: bob.id, texte: "", media: { id: mediaId } });
      const refus = await ws.attendre((m): m is Extract<MessageServeur, { t: "refuse" }> => m.t === "refuse" && m.id === id);
      expect(refus.message).toContain("fichier");
    }
  });

  it("retire un fichier à la demande de son auteur, puis l'efface du stockage", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    const mediaId = await envoyerFichier(ana.appareil, conversationDirecte(ana.id, bob.id));
    expect((await bob.appareil.appel(`/api/medias/${mediaId}`, { method: "DELETE" })).status).toBe(404);
    expect((await ana.appareil.appel(`/api/medias/${mediaId}`, { method: "DELETE" })).status).toBe(204);
    expect((await bob.appareil.appel(`/api/medias/${mediaId}`)).status).toBe(404);

    const fichiersAvant = t.karaks.fichiers.size;
    expect(await nettoyerMedias(t.environnement, Date.now(), t.recuperer)).toBeGreaterThanOrEqual(1);
    expect(t.karaks.fichiers.size).toBeLessThan(fichiersAvant);
    const reste = await env.DB.prepare("SELECT COUNT(*) AS n FROM medias WHERE id = ?1").bind(mediaId).first<{ n: number }>();
    expect(reste?.n).toBe(0);
  });

  it("explique quand le stockage n'est pas configuré", async () => {
    const t = await preparer({ stockage: false });
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    const r = await ana.appareil.appel("/api/medias", {
      method: "POST",
      json: { conversation: conversationDirecte(ana.id, bob.id), nom: "x.jpg", mime: "image/jpeg", taille: 10 },
    });
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ erreur: "stockage_indisponible" });
  });
});
