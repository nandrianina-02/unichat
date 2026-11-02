import { describe, expect, it } from "vitest";
import { conversationDirecte, schemaContenuAction, schemaContenuMessage, type MessageServeur, type Moi } from "@unichat/shared";
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

describe("important, et règles du contenu", () => {
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

  // Le serveur ne lit plus le contenu (lot 8) : l'application qui le reçoit applique
  // ces règles en le déchiffrant, avec ces mêmes schémas.
  it("refuse un contenu de message hors des règles", () => {
    expect(schemaContenuMessage.safeParse({ v: 1, texte: "Rendez-vous à 18 h" }).success).toBe(true);
    const erreur = (contenu: unknown) => {
      const r = schemaContenuMessage.safeParse(contenu);
      return r.success ? null : r.error.issues[0]?.message;
    };
    expect(erreur({ v: 1, texte: "   " })).toBe("Message vide.");
    expect(erreur({ v: 1, texte: "x".repeat(4097) })).toContain("4096");
    expect(erreur({ v: 1, texte: "", sondage: { question: "Oui ?", options: ["Oui"], multiple: false } })).toContain("options");
    expect(erreur({ v: 1, texte: "Bonjour", ephemere: 3600_000 })).toBeTruthy();
    expect(erreur({ v: 1, texte: "Bonjour", inconnu: true })).toBeTruthy();
  });

  it("refuse une action hors des règles", () => {
    const message = crypto.randomUUID();
    const valide = (contenu: unknown) => schemaContenuAction.safeParse(contenu).success;
    expect(valide({ v: 1, action: "modification", message, texte: "Rendez-vous à 19 h" })).toBe(true);
    expect(valide({ v: 1, action: "modification", message, texte: "" })).toBe(false);
    expect(valide({ v: 1, action: "ephemere", duree: 7 * 86_400_000 })).toBe(true);
    expect(valide({ v: 1, action: "ephemere", duree: 3600_000 })).toBe(false);
    expect(valide({ v: 1, action: "vote", message, choix: [1] })).toBe(true);
    expect(valide({ v: 1, action: "vote", message, choix: [99] })).toBe(false);
    expect(valide({ v: 1, action: "reaction", message, code: "inconnue" })).toBe(false);
  });
});
