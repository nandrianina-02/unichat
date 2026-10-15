import { describe, expect, it } from "vitest";
import { conversationDirecte, type Entree, type MessageServeur, type Moi } from "@unichat/shared";
import { identite, preparer } from "./outils";

type Contexte = Awaited<ReturnType<typeof preparer>>;
type Appareil = Awaited<ReturnType<Contexte["connecter"]>>;

/** Une personne avec son nom d'utilisateur (sans lui, on ne peut pas lui écrire). */
async function personne(t: Contexte, prefixe: string) {
  const id = identite(prefixe);
  const appareil = await t.connecter(id);
  const moi = (await (await appareil.appel("/api/moi", {
    method: "PATCH",
    json: { pseudo: `${prefixe}_${crypto.randomUUID().slice(0, 8)}` },
  })).json()) as Moi;
  return { identite: id, appareil, id: moi.id };
}

async function ouvrir(appareil: Appareil, depuis: number | null = null) {
  const connexion = await appareil.tempsReel();
  if (connexion.refus !== null) throw new Error(`connexion refusée : ${connexion.refus}`);
  connexion.envoyer({ t: "bonjour", depuis });
  await connexion.attendre(estLot);
  return connexion;
}

const estLot = (m: MessageServeur): m is Extract<MessageServeur, { t: "lot" }> => m.t === "lot";
const estEntree =
  (type: Entree["type"], filtre: (e: Entree) => boolean = () => true) =>
  (m: MessageServeur): m is Extract<MessageServeur, { t: "entree" }> =>
    m.t === "entree" && m.entree.type === type && filtre(m.entree);

describe("temps réel", () => {
  it("message direct : accepté, reçu, remis puis lu", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    const wsAna = await ouvrir(ana.appareil);
    const wsBob = await ouvrir(bob.appareil);

    const id = crypto.randomUUID();
    wsAna.envoyer({ t: "envoyer", id, a: bob.id, texte: "  Salut Bob  " });
    const accepte = await wsAna.attendre((m): m is Extract<MessageServeur, { t: "accepte" }> => m.t === "accepte");
    expect(accepte.id).toBe(id);

    const recu = await wsBob.attendre(estEntree("message"));
    expect(recu.entree.type === "message" && recu.entree.message).toMatchObject({
      id,
      de: ana.id,
      a: bob.id,
      texte: "Salut Bob",
      conversation: conversationDirecte(ana.id, bob.id),
    });

    // L'appareil de Bob accuse réception : Ana voit « remis ».
    wsBob.envoyer({ t: "recu", jusqua: recu.entree.seq });
    const remis = await wsAna.attendre(estEntree("accuse", (e) => e.type === "accuse" && e.etat === "remis"));
    expect(remis.entree).toMatchObject({ ids: [id], par: bob.id });

    // Bob ouvre la discussion : Ana voit « lu ».
    wsBob.envoyer({ t: "lu", avec: ana.id, ids: [id] });
    const lu = await wsAna.attendre(estEntree("accuse", (e) => e.type === "accuse" && e.etat === "lu"));
    expect(lu.entree).toMatchObject({ ids: [id], par: bob.id });
  });

  it("remet à la connexion les messages envoyés pendant l'absence", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    const wsAna = await ouvrir(ana.appareil);
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    for (const id of ids) {
      wsAna.envoyer({ t: "envoyer", id, a: bob.id, texte: `message ${id}` });
      await wsAna.attendre((m): m is MessageServeur => m.t === "accepte" && m.id === id);
    }

    // Bob se connecte plus tard, sur un appareil neuf.
    const wsBob = await bob.appareil.tempsReel();
    if (wsBob.refus !== null) throw new Error("refus");
    wsBob.envoyer({ t: "bonjour", depuis: null });
    const lot = await wsBob.attendre(estLot);
    expect(lot.fin).toBe(true);
    expect(lot.entrees.filter((e) => e.type === "message").map((e) => e.type === "message" && e.message.id)).toEqual(ids);
  });

  it("efface du serveur ce que tous les appareils ont reçu", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    const wsAna = await ouvrir(ana.appareil);
    const wsBob = await ouvrir(bob.appareil);
    wsAna.envoyer({ t: "envoyer", id: crypto.randomUUID(), a: bob.id, texte: "éphémère" });
    const recu = await wsBob.attendre(estEntree("message"));
    wsBob.envoyer({ t: "recu", jusqua: recu.entree.seq });
    await wsAna.attendre(estEntree("accuse"));

    // Un nouvel appareil de Bob ne trouve plus rien : le message a été remis puis effacé.
    const autre = await t.connecter(bob.identite);
    const wsAutre = await autre.tempsReel();
    if (wsAutre.refus !== null) throw new Error("refus");
    wsAutre.envoyer({ t: "bonjour", depuis: null });
    expect((await wsAutre.attendre(estLot)).entrees).toEqual([]);
  });

  it("transmet mes messages envoyés à mes autres appareils", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    const telephone = await t.connecter(ana.identite);
    const wsOrdi = await ouvrir(ana.appareil);
    const wsTel = await ouvrir(telephone);
    const id = crypto.randomUUID();
    wsOrdi.envoyer({ t: "envoyer", id, a: bob.id, texte: "depuis l'ordinateur" });
    const copie = await wsTel.attendre(estEntree("message"));
    expect(copie.entree.type === "message" && copie.entree.message).toMatchObject({ id, de: ana.id });
  });

  it("ne redistribue pas un message renvoyé après une coupure", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    const wsAna = await ouvrir(ana.appareil);
    const wsBob = await ouvrir(bob.appareil);
    const id = crypto.randomUUID();
    wsAna.envoyer({ t: "envoyer", id, a: bob.id, texte: "une seule fois" });
    await wsBob.attendre(estEntree("message"));
    wsAna.envoyer({ t: "envoyer", id, a: bob.id, texte: "une seule fois" });
    await new Promise((r) => setTimeout(r, 300));
    expect(wsAna.recus.filter((m) => m.t === "accepte" && m.id === id)).toHaveLength(2);
    expect(wsBob.recus.filter((m) => m.t === "entree" && m.entree.type === "message")).toHaveLength(1);
  });

  it("refuse les messages invalides avec une explication", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const wsAna = await ouvrir(ana.appareil);
    const estRefus = (id: string) => (m: MessageServeur): m is Extract<MessageServeur, { t: "refuse" }> => m.t === "refuse" && m.id === id;

    const vide = crypto.randomUUID();
    wsAna.envoyer({ t: "envoyer", id: vide, a: crypto.randomUUID(), texte: "   " });
    expect((await wsAna.attendre(estRefus(vide))).message).toBe("Message vide.");

    const inconnu = crypto.randomUUID();
    wsAna.envoyer({ t: "envoyer", id: inconnu, a: crypto.randomUUID(), texte: "Allô ?" });
    expect((await wsAna.attendre(estRefus(inconnu))).message).toContain("n'existe pas");

    const long = crypto.randomUUID();
    wsAna.envoyer({ t: "envoyer", id: long, a: crypto.randomUUID(), texte: "x".repeat(4097) });
    expect((await wsAna.attendre(estRefus(long))).message).toContain("4096");
  });

  it("signale « en train d'écrire » et la présence", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    const wsAna = await ouvrir(ana.appareil);
    const wsBob = await ouvrir(bob.appareil);
    wsAna.envoyer({ t: "ecrit", a: bob.id });
    const ecrit = await wsBob.attendre((m): m is Extract<MessageServeur, { t: "ecrit" }> => m.t === "ecrit");
    expect(ecrit.de).toBe(ana.id);

    wsAna.envoyer({ t: "presence", de: bob.id });
    const presence = await wsAna.attendre((m): m is Extract<MessageServeur, { t: "presence" }> => m.t === "presence");
    expect(presence).toMatchObject({ de: bob.id, enLigne: true });

    // Sa propre présence (discussion avec soi-même) passe par sa propre boîte.
    wsAna.envoyer({ t: "presence", de: ana.id });
    const soi = await wsAna.attendre(
      (m): m is Extract<MessageServeur, { t: "presence" }> => m.t === "presence" && m.de === ana.id,
    );
    expect(soi.enLigne).toBe(true);
  });

  it("refuse une connexion ouverte depuis un autre site, ou sans session", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    expect((await ana.appareil.tempsReel("https://site-malveillant.example")).refus).toBe(403);
    const anonyme = await t.requete("/api/temps-reel", { headers: { Upgrade: "websocket", Origin: "http://localhost" } });
    expect(anonyme.status).toBe(401);
  });

  it("coupe la connexion d'un appareil déconnecté à distance", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const telephone = await t.connecter(ana.identite, "Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36");
    const wsTel = await ouvrir(telephone);
    const { appareils } = (await (await ana.appareil.appel("/api/sessions")).json()) as { appareils: { id: string; actuel: boolean }[] };
    const idTel = appareils.find((a) => !a.actuel)!.id;
    await ana.appareil.appel(`/api/sessions/${idTel}`, { method: "DELETE" });
    expect(await wsTel.fermeture).toBe(4001);
  });
});
