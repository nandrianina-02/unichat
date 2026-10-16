import { describe, expect, it } from "vitest";
import { conversationDirecte, type ApercuInvitation, type Groupe, type MessageServeur, type Moi } from "@unichat/shared";
import { WEBP, identite, preparer } from "./outils";

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

async function presence(ws: Connexion, de: string) {
  ws.recus.length = 0;
  ws.envoyer({ t: "presence", de });
  return ws.attendre((m): m is Extract<MessageServeur, { t: "presence" }> => m.t === "presence" && m.de === de);
}

const regler = (a: Appareil, json: Record<string, unknown>) => a.appel("/api/moi", { method: "PATCH", json });

function formulairePhoto(): FormData {
  const f = new FormData();
  f.append("grande", new File([WEBP], "grande"));
  f.append("petite", new File([WEBP], "petite"));
  return f;
}

describe("confidentialité de la présence", () => {
  it("suit le réglage de la dernière connexion, et qui cache la sienne ne voit plus celle des autres", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    const wsAna = await ouvrir(ana.appareil);
    const wsBob = await ouvrir(bob.appareil);
    expect((await presence(wsBob, ana.id)).enLigne).toBe(true);

    // Ana réserve sa dernière connexion et « en ligne » à ses contacts ; Bob n'en est pas.
    await regler(ana.appareil, { visibiliteVu: "contacts", enLigne: "comme_vu" });
    expect(await presence(wsBob, ana.id)).toMatchObject({ enLigne: false, vuLe: null });
    // Elle l'ajoute à ses contacts : il la voit de nouveau, tout de suite.
    await ana.appareil.appel("/api/contacts", { method: "POST", json: { id: bob.id } });
    expect((await presence(wsBob, ana.id)).enLigne).toBe(true);

    // Réciprocité : Bob cache la sienne, il ne voit plus celle d'Ana — mais « en ligne » reste.
    await regler(ana.appareil, { visibiliteVu: "tous", enLigne: "tous" });
    await regler(bob.appareil, { visibiliteVu: "personne" });
    const vue = await presence(wsBob, ana.id);
    expect(vue.vuLe).toBeNull();
    expect(vue.enLigne).toBe(true);
    wsAna.ws.close();
  });

  it("ne transmet plus « lu » quand l'un des deux a désactivé les confirmations", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    const [wsAna, wsBob] = await Promise.all([ouvrir(ana.appareil), ouvrir(bob.appareil)]);
    await regler(bob.appareil, { confirmationsLecture: false });
    const conversation = conversationDirecte(ana.id, bob.id);
    const id = crypto.randomUUID();
    wsAna.envoyer({ t: "envoyer", id, a: bob.id, texte: "Tu as lu ?" });
    await wsBob.attendre((m): m is Extract<MessageServeur, { t: "entree" }> => m.t === "entree" && m.entree.type === "message");
    wsBob.envoyer({ t: "lu", conversation, auteur: ana.id, ids: [id] });
    const lu = await wsAna
      .attendre(
        (m): m is Extract<MessageServeur, { t: "entree" }> => m.t === "entree" && m.entree.type === "accuse" && m.entree.etat === "lu",
        500,
      )
      .then(() => true, () => false);
    expect(lu).toBe(false);
  });

  it("« Mes contacts » : seules les personnes qu'elle a ajoutées peuvent l'ajouter à un groupe", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    await ana.appareil.appel("/api/contacts", { method: "POST", json: { id: bob.id } });
    await regler(bob.appareil, { ajoutGroupes: "contacts" });
    const refuse = await ana.appareil.appel("/api/groupes", { method: "POST", json: { nom: "Sortie", membres: [bob.id] } });
    expect(refuse.status).toBe(403);
    expect(((await refuse.json()) as { message: string }).message).toContain("lien du groupe");
    await bob.appareil.appel("/api/contacts", { method: "POST", json: { id: ana.id } });
    expect((await ana.appareil.appel("/api/groupes", { method: "POST", json: { nom: "Sortie", membres: [bob.id] } })).status).toBe(201);
  });
});

describe("photo et lien d'invitation d'un groupe", () => {
  async function groupe(t: Contexte) {
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    await ana.appareil.appel("/api/contacts", { method: "POST", json: { id: bob.id } });
    const g = (await (await ana.appareil.appel("/api/groupes", { method: "POST", json: { nom: "Club", membres: [bob.id] } })).json()) as Groupe;
    return { ana, bob, g };
  }

  it("photo posée par un administrateur, servie aux seuls membres", async () => {
    const t = await preparer();
    const { ana, bob, g } = await groupe(t);
    expect((await bob.appareil.appel(`/api/groupes/${g.id}/photo`, { method: "PUT", body: formulairePhoto() })).status).toBe(403);
    const r = await ana.appareil.appel(`/api/groupes/${g.id}/photo`, { method: "PUT", body: formulairePhoto() });
    expect(((await r.json()) as Groupe).photo).toMatch(/^[0-9a-f]{16}$/);
    expect((await bob.appareil.appel(`/api/groupes/${g.id}/photo`)).status).toBe(200);
    const intrus = await personne(t, "intrus");
    expect((await intrus.appareil.appel(`/api/groupes/${g.id}/photo`)).status).toBe(404);
  });

  it("le lien fait entrer qui le reçoit, et ne vaut plus rien une fois réinitialisé", async () => {
    const t = await preparer();
    const { ana, bob, g } = await groupe(t);
    expect((await bob.appareil.appel(`/api/groupes/${g.id}/invitation`)).status).toBe(403);
    const { code } = (await (await ana.appareil.appel(`/api/groupes/${g.id}/invitation`)).json()) as { code: string };
    expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const lova = await personne(t, "lova");
    const apercu = (await (await lova.appareil.appel(`/api/invitations/${code}`)).json()) as ApercuInvitation;
    expect(apercu).toMatchObject({ id: g.id, nom: "Club", membres: 2, dejaMembre: false });
    const wsAna = await ouvrir(ana.appareil);
    const rejoint = (await (await lova.appareil.appel(`/api/invitations/${code}`, { method: "POST" })).json()) as Groupe;
    expect(rejoint.moiMembre).toBe(true);
    const annonce = await wsAna.attendre(
      (m): m is Extract<MessageServeur, { t: "entree" }> => m.t === "entree" && m.entree.type === "groupe" && m.entree.evenement.action === "lien",
    );
    expect(annonce.entree).toMatchObject({ evenement: { par: lova.id } });

    await ana.appareil.appel(`/api/groupes/${g.id}/invitation`, { method: "POST" });
    const zoe = await personne(t, "zoe");
    expect((await zoe.appareil.appel(`/api/invitations/${code}`, { method: "POST" })).status).toBe(404);
  });
});
