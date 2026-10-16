import { describe, expect, it } from "vitest";
import {
  aleatoire,
  chiffrer,
  cleSigneePublique,
  cleUniquePublique,
  creerCleSignee,
  creerClesUniques,
  creerIdentite,
  dechiffrer,
  depuisBase64,
  identitePublique,
  octetsVersTexte,
  texteVersOctets,
  verifierPaquet,
  versBase64,
  type CleUnique,
  type IdentitePrivee,
  type Paquet,
} from "@unichat/chiffrement";
import type { EtatCles, InscriptionCles, Moi, PaquetsCompte } from "@unichat/shared";
import { identite, preparer } from "./outils";

type Contexte = Awaited<ReturnType<typeof preparer>>;

async function personne(t: Contexte, prefixe: string) {
  const fausse = identite(prefixe);
  const appareil = await t.connecter(fausse);
  const moi = (await (await appareil.appel("/api/moi", {
    method: "PATCH",
    json: { pseudo: `${prefixe}_${crypto.randomUUID().slice(0, 8)}` },
  })).json()) as Moi;
  return { appareil, id: moi.id, fausse };
}

/** Ce que prépare l'application avant d'inscrire son appareil. */
function trousseau(id: IdentitePrivee = creerIdentite()) {
  const cleSignee = creerCleSignee(id, 1, Date.now());
  const uniques = creerClesUniques(1, 100);
  const jeton = aleatoire(32);
  const pub = identitePublique(id);
  const corps: InscriptionCles = {
    identite: { signature: versBase64(pub.signature), echange: versBase64(pub.echange), preuve: versBase64(pub.preuve) },
    appareil: {
      cleSignee: { id: 1, cle: versBase64(cleSignee.paire.publique), signature: versBase64(cleSignee.signature) },
      clesUniques: uniques.map((c) => ({ id: c.id, cle: versBase64(c.paire.publique) })),
      jeton: versBase64(jeton),
    },
  };
  return { identite: id, cleSignee, uniques: new Map<number, CleUnique>(uniques.map((c) => [c.id, c])), jeton, corps };
}

/** Paquet reçu du serveur, retraduit en octets comme le fera l'application. */
function versPaquet(compte: PaquetsCompte, i = 0): Paquet {
  const a = compte.appareils[i]!;
  return {
    identite: { signature: depuisBase64(compte.identite.signature), echange: depuisBase64(compte.identite.echange), preuve: depuisBase64(compte.identite.preuve) },
    cleSignee: { id: a.cleSignee.id, cle: depuisBase64(a.cleSignee.cle), signature: depuisBase64(a.cleSignee.signature) },
    ...(a.cleUnique ? { cleUnique: { id: a.cleUnique.id, cle: depuisBase64(a.cleUnique.cle) } } : {}),
  };
}

async function paquets(appareil: { appel: (chemin: string, init?: RequestInit & { json?: unknown }) => Promise<Response> }, id: string) {
  const r = await appareil.appel("/api/cles/paquets", { method: "POST", json: { comptes: [{ id }] } });
  expect(r.status).toBe(200);
  return ((await r.json()) as { comptes: PaquetsCompte[] }).comptes;
}

describe("annuaire des clés", () => {
  it("premier appareil : il crée l'identité et s'inscrit sous le numéro 1", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const vide = (await (await ana.appareil.appel("/api/cles")).json()) as EtatCles;
    expect(vide).toEqual({ identite: null, appareil: null });

    const k = trousseau();
    const r = await ana.appareil.appel("/api/cles/identite", { method: "POST", json: k.corps });
    expect(r.status).toBe(201);
    const etat = (await r.json()) as EtatCles;
    expect(etat.identite?.signature).toBe(k.corps.identite.signature);
    expect(etat.appareil).toMatchObject({ numero: 1, cleSigneeId: 1, clesUniques: 100 });

    // Le même appareil ne s'inscrit pas deux fois.
    const encore = await ana.appareil.appel("/api/cles/identite", { method: "POST", json: k.corps });
    expect(encore.status).toBe(409);
  });

  it("un second appareil ne peut pas imposer sa propre identité", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    await ana.appareil.appel("/api/cles/identite", { method: "POST", json: trousseau().corps });
    const ordinateur = await t.connecter(ana.fausse);
    const r = await ordinateur.appel("/api/cles/identite", { method: "POST", json: trousseau().corps });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { erreur: string }).erreur).toBe("identite_existante");
    const etat = (await (await ordinateur.appel("/api/cles")).json()) as EtatCles;
    expect(etat.identite).not.toBeNull();
    expect(etat.appareil).toBeNull();
  });

  it("des clés mal formées sont refusées", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const k = trousseau();
    const r = await ana.appareil.appel("/api/cles/identite", {
      method: "POST",
      json: { ...k.corps, identite: { ...k.corps.identite, echange: "trop-court" } },
    });
    expect(r.status).toBe(400);
  });

  it("le paquet servi ouvre une vraie session, et chaque clé unique ne sert qu'une fois", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    const k = trousseau();
    await ana.appareil.appel("/api/cles/identite", { method: "POST", json: k.corps });

    const [premier] = await paquets(bob.appareil, ana.id);
    const [second] = await paquets(bob.appareil, ana.id);
    expect(premier!.appareils[0]!.cleUnique!.id).not.toBe(second!.appareils[0]!.cleUnique!.id);
    const paquet = versPaquet(premier!);
    expect(verifierPaquet(paquet)).toBe(true);

    // Bob écrit avec ce que le serveur lui a donné ; Ana lit avec ses clés privées.
    const deBob = chiffrer(undefined, creerIdentite(), texteVersOctets("Bonjour Ana"), paquet);
    const lu = dechiffrer(undefined, deBob.message, {
      identite: k.identite,
      cleSignee: (id) => (id === k.cleSignee.id ? k.cleSignee : undefined),
      cleUnique: (id) => k.uniques.get(id),
    });
    expect(octetsVersTexte(lu.clair)).toBe("Bonjour Ana");

    const etat = (await (await ana.appareil.appel("/api/cles")).json()) as EtatCles;
    expect(etat.appareil?.clesUniques).toBe(98);
  });

  it("un compte sans clés n'apparaît pas ; une réserve vide donne un paquet sans clé unique", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    expect(await paquets(bob.appareil, ana.id)).toEqual([]);

    const id = creerIdentite();
    const k = trousseau(id);
    k.corps.appareil.clesUniques = k.corps.appareil.clesUniques.slice(0, 1);
    await ana.appareil.appel("/api/cles/identite", { method: "POST", json: k.corps });
    expect((await paquets(bob.appareil, ana.id))[0]!.appareils[0]!.cleUnique).toBeDefined();
    const [sansUnique] = await paquets(bob.appareil, ana.id);
    expect(sansUnique!.appareils[0]!.cleUnique).toBeUndefined();
    expect(verifierPaquet(versPaquet(sansUnique!))).toBe(true);
  });

  it("réserve refaite sans dépasser le maximum ; nouvelle clé signée publiée", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const k = trousseau();
    await ana.appareil.appel("/api/cles/identite", { method: "POST", json: k.corps });
    const lot = (debut: number) => creerClesUniques(debut, 100).map(cleUniquePublique).map((c) => ({ id: c.id, cle: versBase64(c.cle) }));
    await ana.appareil.appel("/api/cles/uniques", { method: "POST", json: { cles: lot(101) } });
    const r = await ana.appareil.appel("/api/cles/uniques", { method: "POST", json: { cles: lot(201) } });
    expect(((await r.json()) as EtatCles).appareil?.clesUniques).toBe(200);

    const nouvelle = cleSigneePublique(creerCleSignee(k.identite, 2, Date.now()));
    const s = await ana.appareil.appel("/api/cles/signee", {
      method: "PUT",
      json: { cleSignee: { id: 2, cle: versBase64(nouvelle.cle), signature: versBase64(nouvelle.signature) } },
    });
    expect(((await s.json()) as EtatCles).appareil?.cleSigneeId).toBe(2);
  });

  it("déconnecté de lui-même, l'appareil reprend sa place avec son jeton ; un autre jeton est refusé", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const k = trousseau();
    await ana.appareil.appel("/api/cles/identite", { method: "POST", json: k.corps });
    expect((await ana.appareil.appel("/api/auth/deconnexion", { method: "POST" })).status).toBe(204);

    const retour = await t.connecter(ana.fausse);
    expect(((await (await retour.appel("/api/cles")).json()) as EtatCles).appareil).toBeNull();
    const faux = await retour.appel("/api/cles/reprendre", { method: "POST", json: { numero: 1, jeton: versBase64(aleatoire(32)) } });
    expect(faux.status).toBe(404);
    const r = await retour.appel("/api/cles/reprendre", { method: "POST", json: { numero: 1, jeton: versBase64(k.jeton) } });
    expect(r.status).toBe(200);
    expect(((await r.json()) as EtatCles).appareil?.numero).toBe(1);
  });

  it("déconnecté à distance, l'appareil quitte l'annuaire et ne peut plus reprendre sa place", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    const k = trousseau();
    await ana.appareil.appel("/api/cles/identite", { method: "POST", json: k.corps });
    const ordinateur = await t.connecter(ana.fausse);
    const { appareils } = (await (await ordinateur.appel("/api/sessions")).json()) as { appareils: { id: string; actuel: boolean }[] };
    const telephone = appareils.find((a) => !a.actuel)!;
    expect((await ordinateur.appel(`/api/sessions/${telephone.id}`, { method: "DELETE" })).status).toBe(204);

    const [compte] = await paquets(bob.appareil, ana.id);
    expect(compte!.appareils).toEqual([]);
    const voleur = await t.connecter(ana.fausse);
    const r = await voleur.appel("/api/cles/reprendre", { method: "POST", json: { numero: 1, jeton: versBase64(k.jeton) } });
    expect(r.status).toBe(404);
  });
});
