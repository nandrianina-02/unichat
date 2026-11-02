import { describe, expect, it } from "vitest";
import {
  conversationDirecte,
  conversationGroupe,
  type Entree,
  type Groupe,
  type MessageServeur,
  type Moi,
} from "@unichat/shared";
import { inscrireCles, trameChiffree } from "./chiffre-outils";
import { identite, preparer } from "./outils";

type Contexte = Awaited<ReturnType<typeof preparer>>;

async function personne(t: Contexte, prefixe: string) {
  const id = identite(prefixe);
  const appareil = await t.connecter(id);
  const moi = (await (await appareil.appel("/api/moi", {
    method: "PATCH",
    json: { pseudo: `${prefixe}_${crypto.randomUUID().slice(0, 8)}` },
  })).json()) as Moi;
  await inscrireCles(appareil);
  return { identite: id, appareil, id: moi.id };
}

async function ouvrir(appareil: Awaited<ReturnType<Contexte["connecter"]>>) {
  const ws = await appareil.tempsReel();
  if (ws.refus !== null) throw new Error(`refus ${ws.refus}`);
  ws.envoyer({ t: "bonjour", depuis: null });
  await ws.attendre((m): m is Extract<MessageServeur, { t: "lot" }> => m.t === "lot");
  return ws;
}

const entree =
  <T extends Entree["type"]>(type: T, filtre: (e: Extract<Entree, { type: T }>) => boolean = () => true) =>
  (m: MessageServeur): m is Extract<MessageServeur, { t: "entree" }> =>
    m.t === "entree" && m.entree.type === type && filtre(m.entree as Extract<Entree, { type: T }>);

/** Ana, avec Bob et Lova dans ses contacts. */
async function trio() {
  const t = await preparer();
  const ana = await personne(t, "ana");
  const bob = await personne(t, "bob");
  const lova = await personne(t, "lova");
  for (const p of [bob, lova]) await ana.appareil.appel("/api/contacts", { method: "POST", json: { id: p.id } });
  return { t, ana, bob, lova };
}

async function creerGroupe(ana: Awaited<ReturnType<typeof personne>>, membres: string[], nom = "Famille") {
  const r = await ana.appareil.appel("/api/groupes", { method: "POST", json: { nom, membres } });
  expect(r.status).toBe(201);
  return (await r.json()) as Groupe;
}

describe("groupes", () => {
  it("crée un groupe avec des contacts et l'annonce à chacun", async () => {
    const { ana, bob, lova } = await trio();
    const wsBob = await ouvrir(bob.appareil);
    const groupe = await creerGroupe(ana, [bob.id, lova.id]);
    expect(groupe.moiAdmin).toBe(true);
    expect(groupe.membres.map((m) => m.id).sort()).toEqual([ana.id, bob.id, lova.id].sort());
    expect(groupe.membres.find((m) => m.id === ana.id)?.role).toBe("admin");

    const annonce = await wsBob.attendre(entree("groupe"));
    expect(annonce.entree.type === "groupe" && annonce.entree.evenement).toMatchObject({
      action: "creation",
      par: ana.id,
      nom: "Famille",
      conversation: conversationGroupe(groupe.id),
    });
  });

  it("refuse d'ajouter quelqu'un qui n'est pas un contact", async () => {
    const { t, ana } = await trio();
    const inconnu = await personne(t, "inconnu");
    const r = await ana.appareil.appel("/api/groupes", { method: "POST", json: { nom: "Club", membres: [inconnu.id] } });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ message: "Vous ne pouvez ajouter que des personnes de vos contacts." });
  });

  it("distribue les messages à chaque membre, avec accusés par personne", async () => {
    const { ana, bob, lova } = await trio();
    const groupe = await creerGroupe(ana, [bob.id, lova.id]);
    const [wsAna, wsBob, wsLova] = await Promise.all([ouvrir(ana.appareil), ouvrir(bob.appareil), ouvrir(lova.appareil)]);

    const trame = await trameChiffree(ana.appareil, ana.id, { groupe: groupe.id, comptes: [bob.id, lova.id] });
    const id = trame.id;
    wsAna.envoyer(trame);
    const accepte = await wsAna.attendre((m): m is Extract<MessageServeur, { t: "accepte" }> => m.t === "accepte" && m.id === id);
    expect(accepte.destinataires).toBe(2);

    for (const [ws, membre] of [[wsBob, bob.id], [wsLova, lova.id]] as const) {
      const recu = await ws.attendre(entree("chiffre", (e) => e.enveloppe.id === id));
      // Chaque membre ne reçoit que les clés de ses propres appareils.
      expect(recu.entree.type === "chiffre" && recu.entree.enveloppe).toMatchObject({ de: ana.id, a: groupe.id, cles: trame.cles[membre] });
      ws.envoyer({ t: "recu", jusqua: recu.entree.seq });
    }
    // Un accusé de remise par membre : l'application d'Ana en déduit « remis à tous ».
    await wsAna.attendre(entree("accuse", (e) => e.etat === "remis" && e.par === bob.id));
    await wsAna.attendre(entree("accuse", (e) => e.etat === "remis" && e.par === lova.id));

    wsLova.envoyer({ t: "lu", conversation: conversationGroupe(groupe.id), auteur: ana.id, ids: [id] });
    const lu = await wsAna.attendre(entree("accuse", (e) => e.etat === "lu"));
    expect(lu.entree).toMatchObject({ par: lova.id, ids: [id], conversation: conversationGroupe(groupe.id) });
  });

  it("un membre retiré ne peut plus écrire ni voir le groupe", async () => {
    const { ana, bob, lova } = await trio();
    const groupe = await creerGroupe(ana, [bob.id, lova.id]);
    const wsBob = await ouvrir(bob.appareil);
    expect((await ana.appareil.appel(`/api/groupes/${groupe.id}/membres/${bob.id}`, { method: "DELETE" })).status).toBe(204);
    const retrait = await wsBob.attendre(entree("groupe", (e) => e.evenement.action === "retrait"));
    expect(retrait.entree.type === "groupe" && retrait.entree.evenement.cibles).toEqual([bob.id]);

    const trame = await trameChiffree(bob.appareil, bob.id, { groupe: groupe.id, comptes: [ana.id, lova.id] });
    wsBob.envoyer(trame);
    const refus = await wsBob.attendre((m): m is Extract<MessageServeur, { t: "refuse" }> => m.t === "refuse" && m.id === trame.id, 15000);
    expect(refus.message).toBe("Vous ne faites pas partie de ce groupe.");
    expect((await bob.appareil.appel(`/api/groupes/${groupe.id}`)).status).toBe(404);
  });

  it("réserve les modifications aux administrateurs et en désigne un si le dernier part", async () => {
    const { ana, bob, lova } = await trio();
    const groupe = await creerGroupe(ana, [bob.id, lova.id]);
    expect((await bob.appareil.appel(`/api/groupes/${groupe.id}`, { method: "PATCH", json: { nom: "Pirate" } })).status).toBe(403);
    const renomme = (await (await ana.appareil.appel(`/api/groupes/${groupe.id}`, { method: "PATCH", json: { nom: "Famille Rakoto" } })).json()) as Groupe;
    expect(renomme.nom).toBe("Famille Rakoto");

    // Ana (seule administratrice) part : Bob, membre le plus ancien après elle, prend le relais.
    expect((await ana.appareil.appel(`/api/groupes/${groupe.id}/membres/${ana.id}`, { method: "DELETE" })).status).toBe(204);
    const vuParBob = (await (await bob.appareil.appel(`/api/groupes/${groupe.id}`)).json()) as Groupe;
    expect(vuParBob.membres).toHaveLength(2);
    expect(vuParBob.moiAdmin || vuParBob.membres.find((m) => m.id === lova.id)?.role === "admin").toBe(true);
  });

  it("limite le nombre de membres", async () => {
    const { ana, bob } = await trio();
    const trop = Array.from({ length: 41 }, () => crypto.randomUUID());
    const r = await ana.appareil.appel("/api/groupes", { method: "POST", json: { nom: "Foule", membres: [bob.id, ...trop] } });
    expect(r.status).toBe(400);
  });
});

describe("réactions et suppression", () => {
  it("transmet une réaction et la suppression d'un message, chiffrées, à l'autre personne", async () => {
    const { ana, bob } = await trio();
    const [wsAna, wsBob] = await Promise.all([ouvrir(ana.appareil), ouvrir(bob.appareil)]);
    const message = await trameChiffree(ana.appareil, ana.id, { a: bob.id, comptes: [bob.id] });
    wsAna.envoyer(message);
    await wsBob.attendre(entree("chiffre"));

    const reaction = await trameChiffree(bob.appareil, bob.id, { a: ana.id, comptes: [ana.id], genre: "action" });
    wsBob.envoyer(reaction);
    const recue = await wsAna.attendre(entree("chiffre", (e) => e.enveloppe.id === reaction.id));
    expect(recue.entree.type === "chiffre" && recue.entree.enveloppe).toMatchObject({ de: bob.id, genre: "action", conversation: conversationDirecte(ana.id, bob.id) });

    const suppression = await trameChiffree(ana.appareil, ana.id, { a: bob.id, comptes: [bob.id], genre: "action" });
    wsAna.envoyer(suppression);
    const recu = await wsBob.attendre(entree("chiffre", (e) => e.enveloppe.id === suppression.id));
    expect(recu.entree.type === "chiffre" && recu.entree.enveloppe.genre).toBe("action");
  });

  it("une action ne traverse pas un blocage", async () => {
    const { ana, bob } = await trio();
    const [wsAna, wsBob] = await Promise.all([ouvrir(ana.appareil), ouvrir(bob.appareil)]);
    expect((await bob.appareil.appel("/api/blocages", { method: "POST", json: { id: ana.id } })).status).toBe(201);
    const reaction = await trameChiffree(ana.appareil, ana.id, { a: bob.id, comptes: [bob.id], genre: "action" });
    wsAna.envoyer(reaction);
    await wsAna.attendre((m): m is Extract<MessageServeur, { t: "accepte" }> => m.t === "accepte" && m.id === reaction.id);
    expect(await wsBob.attendre(entree("chiffre"), 400).then(() => true, () => false)).toBe(false);
  });
});
