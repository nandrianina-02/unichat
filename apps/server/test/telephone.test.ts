import { describe, expect, it } from "vitest";
import { lireRecherche, normaliserTelephone, type CarteProfil, type EvenementSecurite, type Moi } from "@unichat/shared";
import { MINUTE, identite, preparer } from "./outils";

async function json<T>(r: Response): Promise<T> {
  return (await r.json()) as T;
}

type Contexte = Awaited<ReturnType<typeof preparer>>;

async function personne(t: Contexte, prefixe: string) {
  const appareil = await t.connecter(identite(prefixe));
  await appareil.appel("/api/moi", { method: "PATCH", json: { pseudo: `${prefixe}_${crypto.randomUUID().slice(0, 8)}` } });
  return appareil;
}

/** Demande un code pour ce numéro, puis saisit celui que le « téléphone » a reçu. */
async function verifier(t: Contexte, appareil: Awaited<ReturnType<typeof personne>>, numero: string) {
  const demande = await appareil.appel("/api/moi/telephone", { method: "POST", json: { numero } });
  expect(demande.status).toBe(200);
  const code = t.mess.codeRecu(normaliserTelephone(numero)!);
  return appareil.appel("/api/moi/telephone/verifier", { method: "POST", json: { code } });
}

describe("numéro de téléphone", () => {
  it("lit un numéro malgache dans la recherche, sans le confondre avec un nom", () => {
    expect(lireRecherche("034 12 345 67")).toEqual({ type: "telephone", valeur: "+261341234567" });
    expect(lireRecherche("+261 33 38 369 82")).toEqual({ type: "telephone", valeur: "+261333836982" });
    expect(lireRecherche("0612345678")).toBeNull();
    expect(lireRecherche("ana.rakoto")).toEqual({ type: "pseudo", valeur: "ana.rakoto" });
  });

  it("vérifie le numéro par un code SMS, puis le rend trouvable", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");

    const enAttente = await json<Moi>(await ana.appel("/api/moi/telephone", { method: "POST", json: { numero: "034 12 345 67" } }));
    expect(enAttente.telephone).toBeNull();
    expect(enAttente.verificationTelephone?.numero).toBe("+261341234567");
    expect(t.mess.sms.at(-1)?.numero).toBe("+261341234567");

    const faux = await ana.appel("/api/moi/telephone/verifier", { method: "POST", json: { code: "000000" } });
    expect(faux.status).toBe(400);
    expect(((await faux.json()) as { message: string }).message).toMatch(/^Code incorrect\. Encore 4 essais\./);

    const bon = await json<Moi>(
      await ana.appel("/api/moi/telephone/verifier", { method: "POST", json: { code: t.mess.codeRecu("+261341234567") } }),
    );
    expect(bon.telephone).toBe("+261341234567");
    expect(bon.verificationTelephone).toBeNull();

    // Bob la trouve par son numéro, écrit comme on veut.
    const { resultats } = await json<{ resultats: CarteProfil[] }>(await bob.appel(`/api/recherche?q=${encodeURIComponent("+261 34 12 345 67")}`));
    expect(resultats).toHaveLength(1);
    // Le numéro lui-même n'est jamais montré aux autres.
    expect(JSON.stringify(resultats)).not.toContain("+261341234567");

    const { evenements } = await json<{ evenements: EvenementSecurite[] }>(await ana.appel("/api/securite/evenements"));
    expect(evenements.map((e) => e.type)).toContain("telephone_ajoute");
  });

  it("respecte le réglage « trouvable par numéro »", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    await verifier(t, ana, "0331112233");
    await ana.appel("/api/moi", { method: "PATCH", json: { trouvableParTelephone: false } });
    const { resultats } = await json<{ resultats: CarteProfil[] }>(await bob.appel("/api/recherche?q=0331112233"));
    expect(resultats).toEqual([]);
  });

  it("donne le numéro à qui le prouve : il quitte l'ancien compte", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    await verifier(t, ana, "0381234567");
    const repris = await json<Moi>(await verifier(t, bob, "0381234567"));
    expect(repris.telephone).toBe("+261381234567");
    expect((await json<Moi>(await ana.appel("/api/moi"))).telephone).toBeNull();
  });

  it("refuse un code expiré et efface la vérification", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    await ana.appel("/api/moi/telephone", { method: "POST", json: { numero: "0321234567" } });
    t.avancer(11 * MINUTE);
    const r = await ana.appel("/api/moi/telephone/verifier", { method: "POST", json: { code: t.mess.codeRecu("+261321234567") } });
    expect(r.status).toBe(400);
    expect((await json<Moi>(await ana.appel("/api/moi"))).verificationTelephone).toBeNull();
  });

  it("refuse un numéro étranger avant tout envoi", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const r = await ana.appel("/api/moi/telephone", { method: "POST", json: { numero: "+33 6 12 34 56 78" } });
    expect(r.status).toBe(400);
    expect(t.mess.sms).toHaveLength(0);
  });

  it("retire le numéro et le note dans l'activité", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    await verifier(t, ana, "0371234567");
    const apres = await json<Moi>(await ana.appel("/api/moi/telephone", { method: "DELETE" }));
    expect(apres.telephone).toBeNull();
    const { evenements } = await json<{ evenements: EvenementSecurite[] }>(await ana.appel("/api/securite/evenements"));
    expect(evenements.map((e) => e.type)).toContain("telephone_retire");
  });

  it("dit clairement quand le service SMS manque ou tombe en panne", async () => {
    const sansSms = await preparer({ sms: false });
    const ana = await personne(sansSms, "ana");
    expect((await ana.appel("/api/moi/telephone", { method: "POST", json: { numero: "0341234567" } })).status).toBe(503);

    const t = await preparer();
    const bob = await personne(t, "bob");
    t.mess.options.panne = true;
    const r = await bob.appel("/api/moi/telephone", { method: "POST", json: { numero: "0341234567" } });
    expect(r.status).toBe(503);
    expect(((await r.json()) as { message: string }).message).toMatch(/momentanément indisponible/);
  });
});
