import { describe, expect, it } from "vitest";
import {
  conversationDirecte,
  conversationGroupe,
  type Entree,
  type Groupe,
  type MessageServeur,
  type Moi,
} from "@unichat/shared";
import { identite, preparer } from "./outils";

type Contexte = Awaited<ReturnType<typeof preparer>>;

async function personne(t: Contexte, prefixe: string) {
  const id = identite(prefixe);
  const appareil = await t.connecter(id);
  const moi = (await (await appareil.appel("/api/moi", {
    method: "PATCH",
    json: { pseudo: `${prefixe}_${crypto.randomUUID().slice(0, 8)}` },
  })).json()) as Moi;
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

    const id = crypto.randomUUID();
    wsAna.envoyer({ t: "envoyer", id, groupe: groupe.id, texte: "Bonjour à tous" });
    const accepte = await wsAna.attendre((m): m is Extract<MessageServeur, { t: "accepte" }> => m.t === "accepte" && m.id === id);
    expect(accepte.destinataires).toBe(2);

    for (const ws of [wsBob, wsLova]) {
      const recu = await ws.attendre(entree("message", (e) => e.message.id === id));
      expect(recu.entree.type === "message" && recu.entree.message).toMatchObject({ de: ana.id, a: groupe.id, texte: "Bonjour à tous" });
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

    const id = crypto.randomUUID();
    wsBob.envoyer({ t: "envoyer", id, groupe: groupe.id, texte: "Encore là ?" });
    const refus = await wsBob.attendre((m): m is Extract<MessageServeur, { t: "refuse" }> => m.t === "refuse" && m.id === id, 15000);
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
  it("transmet une réaction et la suppression d'un message à l'autre personne", async () => {
    const { ana, bob } = await trio();
    const [wsAna, wsBob] = await Promise.all([ouvrir(ana.appareil), ouvrir(bob.appareil)]);
    const conversation = conversationDirecte(ana.id, bob.id);
    const id = crypto.randomUUID();
    wsAna.envoyer({ t: "envoyer", id, a: bob.id, texte: "À supprimer" });
    await wsBob.attendre(entree("message"));

    wsBob.envoyer({ t: "reagir", conversation, message: id, code: "coeur" });
    const reaction = await wsAna.attendre(entree("reaction"));
    expect(reaction.entree).toMatchObject({ message: id, par: bob.id, code: "coeur" });

    wsAna.envoyer({ t: "supprimer", conversation, message: id });
    const suppression = await wsBob.attendre(entree("suppression"));
    expect(suppression.entree).toMatchObject({ message: id, par: ana.id });
  });

  it("refuse d'agir dans une discussion dont on ne fait pas partie", async () => {
    const { t, ana, bob } = await trio();
    const intrus = await personne(t, "intrus");
    const ws = await ouvrir(intrus.appareil);
    ws.envoyer({ t: "reagir", conversation: conversationDirecte(ana.id, bob.id), message: crypto.randomUUID(), code: "pouce" });
    const refus = await ws.attendre((m): m is Extract<MessageServeur, { t: "refuse" }> => m.t === "refuse");
    expect(refus.message).toBe("Vous ne faites pas partie de cette discussion.");
  });

  it("refuse une réaction inconnue", async () => {
    const { ana, bob } = await trio();
    const ws = await ouvrir(ana.appareil);
    ws.envoyer({ t: "reagir", conversation: conversationDirecte(ana.id, bob.id), message: crypto.randomUUID(), code: "licorne" } as never);
    const refus = await ws.attendre((m): m is Extract<MessageServeur, { t: "refuse" }> => m.t === "refuse");
    expect(refus.message).toBeTruthy();
  });
});
