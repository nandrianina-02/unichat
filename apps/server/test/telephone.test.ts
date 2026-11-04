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

  it("inscrit par numéro, puis reconnecte le même compte avec le même numéro", async () => {
    const t = await preparer();
    const nouveau = await t.connecterParTelephone("034 55 666 77");
    const moi = await json<Moi>(await nouveau.appel("/api/moi"));
    expect(moi).toMatchObject({ connexion: "telephone", telephone: "+261345566677", email: "", pseudo: null, nom: "" });

    // L'accueil se termine comme après Google : nom et nom d'utilisateur.
    const accueil = await nouveau.appel("/api/moi", { method: "PATCH", json: { nom: "Rivo", pseudo: "rivo.tel" } });
    expect(accueil.status).toBe(200);

    const ailleurs = await t.connecterParTelephone("+261345566677");
    expect((await json<Moi>(await ailleurs.appel("/api/moi"))).id).toBe(moi.id);
  });

  it("ouvre aussi le compte Google qui porte ce numéro vérifié", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    await verifier(t, ana, "0349998877");
    const idAna = (await json<Moi>(await ana.appel("/api/moi"))).id;
    const parNumero = await t.connecterParTelephone("0349998877");
    expect((await json<Moi>(await parNumero.appel("/api/moi"))).id).toBe(idAna);
  });

  it("répond de la même façon que le numéro soit inscrit ou non", async () => {
    const t = await preparer();
    await t.connecterParTelephone("0331231231");
    const demande = (numero: string) =>
      t.requete("/api/auth/telephone", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ numero }) });
    const inscrit = (await (await demande("0331231231")).json()) as Record<string, unknown>;
    const inconnu = (await (await demande("0331231232")).json()) as Record<string, unknown>;
    expect(Object.keys(inscrit).sort()).toEqual(Object.keys(inconnu).sort());
  });

  it("protège le numéro d'un compte sans Google", async () => {
    const t = await preparer();
    const sansGoogle = await t.connecterParTelephone("0387776655");
    // Il ne peut pas le retirer : ce serait perdre l'accès à son compte.
    expect((await sansGoogle.appel("/api/moi/telephone", { method: "DELETE" })).status).toBe(400);
    // Un autre compte ne peut pas le reprendre par la vérification du profil.
    const bob = await personne(t, "bob");
    const r = await bob.appel("/api/moi/telephone", { method: "POST", json: { numero: "0387776655" } });
    expect(r.status).toBe(409);
    expect(t.mess.sms.filter((s) => s.numero === "+261387776655")).toHaveLength(1);
  });

  it("refuse une connexion web venue d'une autre page, et un code faux", async () => {
    const t = await preparer();
    const r = await t.requete("/api/auth/telephone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numero: "0324445566" }),
    });
    const { demande } = (await r.json()) as { demande: string };
    const tiers = await t.requete("/api/auth/telephone/verifier", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://pirate.exemple" },
      body: JSON.stringify({ demande, code: t.mess.codeRecu("+261324445566") }),
    });
    expect(tiers.status).toBe(403);
    const faux = await t.requete("/api/auth/telephone/verifier", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ demande, code: "000000" }),
    });
    expect(faux.status).toBe(400);
  });

  it("donne un jeton de session à l'application native", async () => {
    const t = await preparer();
    const r = await t.requete("/api/auth/telephone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numero: "0371112222" }),
    });
    const { demande } = (await r.json()) as { demande: string };
    const session = await t.requete("/api/auth/telephone/verifier", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ demande, code: t.mess.codeRecu("+261371112222"), appareil: "Samsung SM-A155F" }),
    });
    expect(session.status).toBe(200);
    expect(((await session.json()) as { jeton: string }).jeton.length).toBeGreaterThan(20);
  });
});
