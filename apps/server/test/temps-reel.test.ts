import { describe, expect, it } from "vitest";
import { TRAMES_RETIREES, conversationDirecte, type Entree, type MessageServeur, type Moi } from "@unichat/shared";
import { inscrireCles, trameChiffree } from "./chiffre-outils";
import { identite, preparer } from "./outils";

type Contexte = Awaited<ReturnType<typeof preparer>>;
type Appareil = Awaited<ReturnType<Contexte["connecter"]>>;

/** Une personne avec son nom d'utilisateur et ses clés (sans elles, elle ne peut pas écrire). */
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

    const trame = await trameChiffree(ana.appareil, ana.id, { a: bob.id, comptes: [bob.id] });
    wsAna.envoyer(trame);
    const accepte = await wsAna.attendre((m): m is Extract<MessageServeur, { t: "accepte" }> => m.t === "accepte");
    expect(accepte.id).toBe(trame.id);

    // Bob ne reçoit que la clé de son propre appareil ; le contenu lui arrive tel quel.
    const recu = await wsBob.attendre(estEntree("chiffre"));
    expect(recu.entree.type === "chiffre" && recu.entree.enveloppe).toMatchObject({
      id: trame.id,
      de: ana.id,
      a: bob.id,
      corps: trame.corps,
      cles: trame.cles[bob.id],
      conversation: conversationDirecte(ana.id, bob.id),
    });

    // L'appareil de Bob accuse réception : Ana voit « remis ».
    wsBob.envoyer({ t: "recu", jusqua: recu.entree.seq });
    const remis = await wsAna.attendre(estEntree("accuse", (e) => e.type === "accuse" && e.etat === "remis"));
    expect(remis.entree).toMatchObject({ ids: [trame.id], par: bob.id });

    // Bob ouvre la discussion : Ana voit « lu ».
    wsBob.envoyer({ t: "lu", conversation: conversationDirecte(ana.id, bob.id), auteur: ana.id, ids: [trame.id] });
    const lu = await wsAna.attendre(estEntree("accuse", (e) => e.type === "accuse" && e.etat === "lu"));
    expect(lu.entree).toMatchObject({ ids: [trame.id], par: bob.id });
  });

  it("remet à la connexion les messages envoyés pendant l'absence", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    const wsAna = await ouvrir(ana.appareil);
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const trame = await trameChiffree(ana.appareil, ana.id, { a: bob.id, comptes: [bob.id] });
      ids.push(trame.id);
      wsAna.envoyer(trame);
      await wsAna.attendre((m): m is MessageServeur => m.t === "accepte" && m.id === trame.id);
    }

    // Bob se connecte plus tard.
    const wsBob = await bob.appareil.tempsReel();
    if (wsBob.refus !== null) throw new Error("refus");
    wsBob.envoyer({ t: "bonjour", depuis: null });
    const lot = await wsBob.attendre(estLot);
    expect(lot.fin).toBe(true);
    expect(lot.entrees.filter((e) => e.type === "chiffre").map((e) => e.type === "chiffre" && e.enveloppe.id)).toEqual(ids);
  });

  it("efface du serveur ce que tous les appareils ont reçu", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    const wsAna = await ouvrir(ana.appareil);
    const wsBob = await ouvrir(bob.appareil);
    wsAna.envoyer(await trameChiffree(ana.appareil, ana.id, { a: bob.id, comptes: [bob.id] }));
    const recu = await wsBob.attendre(estEntree("chiffre"));
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
    const trame = await trameChiffree(ana.appareil, ana.id, { a: bob.id, comptes: [bob.id] });
    wsOrdi.envoyer(trame);
    const copie = await wsTel.attendre(estEntree("chiffre"));
    expect(copie.entree.type === "chiffre" && copie.entree.enveloppe).toMatchObject({ id: trame.id, de: ana.id });
  });

  it("ne redistribue pas un message renvoyé après une coupure", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    const wsAna = await ouvrir(ana.appareil);
    const wsBob = await ouvrir(bob.appareil);
    const trame = await trameChiffree(ana.appareil, ana.id, { a: bob.id, comptes: [bob.id] });
    wsAna.envoyer(trame);
    await wsBob.attendre(estEntree("chiffre"));
    wsAna.envoyer(trame);
    await new Promise((r) => setTimeout(r, 300));
    expect(wsAna.recus.filter((m) => m.t === "accepte" && m.id === trame.id)).toHaveLength(2);
    expect(wsBob.recus.filter((m) => m.t === "entree" && m.entree.type === "chiffre")).toHaveLength(1);
  });

  it("refuse les messages invalides avec une explication", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const wsAna = await ouvrir(ana.appareil);
    const estRefus = (id: string) => (m: MessageServeur): m is Extract<MessageServeur, { t: "refuse" }> => m.t === "refuse" && m.id === id;

    const inconnu = await trameChiffree(ana.appareil, ana.id, { a: crypto.randomUUID(), comptes: [] });
    wsAna.envoyer(inconnu);
    expect((await wsAna.attendre(estRefus(inconnu.id))).message).toContain("n'existe pas");

    const abime = { ...(await trameChiffree(ana.appareil, ana.id, { comptes: [] })), corps: "pas du base64 !" };
    wsAna.envoyer(abime);
    expect((await wsAna.attendre(estRefus(abime.id))).message).toBe("Données invalides.");
  });

  it("refuse les trames en clair : l'ancienne version est invitée à recharger", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    const wsAna = await ouvrir(ana.appareil);
    const wsBob = await ouvrir(bob.appareil);
    const conversation = conversationDirecte(ana.id, bob.id);
    for (const type of TRAMES_RETIREES) {
      const id = crypto.randomUUID();
      // Trame d'une ancienne version : le schéma actuel ne la connaît plus.
      wsAna.envoyer({ t: type, id, a: bob.id, texte: "en clair", conversation, message: id, code: null, duree: null, choix: [], auteur: bob.id } as never);
      const refus = await wsAna.attendre((m): m is Extract<MessageServeur, { t: "refuse" }> => m.t === "refuse" && m.id === id);
      expect(refus.code).toBe("version");
    }
    await new Promise((r) => setTimeout(r, 200));
    expect(wsBob.recus.filter((m) => m.t === "entree")).toEqual([]);
  });

  it("signale « en train d'écrire » et la présence", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    const wsAna = await ouvrir(ana.appareil);
    const wsBob = await ouvrir(bob.appareil);
    wsAna.envoyer({ t: "ecrit", conversation: conversationDirecte(ana.id, bob.id) });
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
