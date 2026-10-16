import { describe, expect, it } from "vitest";
import { conversationDirecte, type MessageServeur, type Moi } from "@unichat/shared";
import { identite, preparer } from "./outils";

type Contexte = Awaited<ReturnType<typeof preparer>>;
type Appareil = Awaited<ReturnType<Contexte["connecter"]>>;

async function personne(t: Contexte, prefixe: string) {
  const identiteFausse = identite(prefixe);
  const appareil = await t.connecter(identiteFausse);
  const moi = (await (await appareil.appel("/api/moi", {
    method: "PATCH",
    json: { pseudo: `${prefixe}_${crypto.randomUUID().slice(0, 8)}` },
  })).json()) as Moi;
  return { appareil, id: moi.id, identite: identiteFausse };
}

async function ouvrir(appareil: Appareil) {
  const ws = await appareil.tempsReel();
  if (ws.refus !== null) throw new Error(`refus ${ws.refus}`);
  ws.envoyer({ t: "bonjour", depuis: null });
  await ws.attendre((m): m is Extract<MessageServeur, { t: "lot" }> => m.t === "lot");
  return ws;
}

const entree = (type: string) => (m: MessageServeur): m is Extract<MessageServeur, { t: "entree" }> =>
  m.t === "entree" && m.entree.type === type;

describe("modifier, épingler, important, transférer", () => {
  it("transmet une modification et une épingle à l'autre participant", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    const [wsAna, wsBob] = await Promise.all([ouvrir(ana.appareil), ouvrir(bob.appareil)]);
    const conversation = conversationDirecte(ana.id, bob.id);
    const id = crypto.randomUUID();
    wsAna.envoyer({ t: "envoyer", id, a: bob.id, texte: "Rendez-vous à 18 h" });
    await wsBob.attendre(entree("message"));

    wsAna.envoyer({ t: "modifier", conversation, message: id, texte: "Rendez-vous à 19 h" });
    const modification = await wsBob.attendre(entree("modification"));
    expect(modification.entree).toMatchObject({ message: id, par: ana.id, texte: "Rendez-vous à 19 h" });

    const jusqua = Date.now() + 86_400_000;
    wsBob.envoyer({ t: "epingler", conversation, message: id, jusqua });
    const epingle = await wsAna.attendre(entree("epingle"));
    expect(epingle.entree).toMatchObject({ message: id, par: bob.id, jusqua });
  });

  it("garde « important » entre mes appareils", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const autre = await t.connecter(ana.identite);
    const bob = await personne(t, "bob");
    const [wsAna, wsAutre, wsBob] = await Promise.all([ouvrir(ana.appareil), ouvrir(autre), ouvrir(bob.appareil)]);
    const message = crypto.randomUUID();
    wsAna.envoyer({ t: "important", conversation: conversationDirecte(ana.id, bob.id), message, important: true });
    const recu = await wsAutre.attendre(entree("important"));
    expect(recu.entree).toMatchObject({ message, important: true });
    const chezBob = await wsBob.attendre(entree("important"), 400).then(() => true, () => false);
    expect(chezBob).toBe(false);
  });

  it("transmet le nombre de transferts avec le message", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    const [wsAna, wsBob] = await Promise.all([ouvrir(ana.appareil), ouvrir(bob.appareil)]);
    wsAna.envoyer({ t: "envoyer", id: crypto.randomUUID(), a: bob.id, texte: "Lien utile", transfere: 3 });
    const recu = await wsBob.attendre(entree("message"));
    expect(recu.entree).toMatchObject({ message: { texte: "Lien utile", transfere: 3 } });
  });
});
