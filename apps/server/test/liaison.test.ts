import { describe, expect, it } from "vitest";
import {
  aleatoire,
  cleCommune,
  creerCleSignee,
  creerClesUniques,
  creerIdentite,
  depuisBase64,
  identitePublique,
  ouvrirIdentite,
  paireEchange,
  preparerCode,
  preuveLiaison,
  scellerIdentite,
  verifierPreuve,
  versBase64,
  type IdentitePrivee,
} from "@unichat/chiffrement";
import type { EtatCles, EtatLiaison, InscriptionCles, Moi, PaquetsCompte } from "@unichat/shared";
import { HEURE, MINUTE, identite as fausseIdentite, preparer } from "./outils";

type Contexte = Awaited<ReturnType<typeof preparer>>;
type Appareil = Awaited<ReturnType<Contexte["connecter"]>>;

const json = async <T>(r: Response): Promise<T> => (await r.json()) as T;

/** Ce qu'un appareil prépare pour s'inscrire avec une identité donnée. */
function inscription(identite: IdentitePrivee): InscriptionCles {
  const pub = identitePublique(identite);
  const signee = creerCleSignee(identite, 1, Date.now());
  return {
    identite: { signature: versBase64(pub.signature), echange: versBase64(pub.echange), preuve: versBase64(pub.preuve) },
    appareil: {
      cleSignee: { id: 1, cle: versBase64(signee.paire.publique), signature: versBase64(signee.signature) },
      clesUniques: creerClesUniques(1, 10).map((u) => ({ id: u.id, cle: versBase64(u.paire.publique) })),
      jeton: versBase64(aleatoire(32)),
    },
  };
}

/** Ana : un téléphone qui a les clés, un ordinateur qui doit être relié. */
async function compte(t: Contexte) {
  const fausse = fausseIdentite("ana");
  const telephone = await t.connecter(fausse);
  const moi = await json<Moi>(await telephone.appel("/api/moi", { method: "PATCH", json: { pseudo: `ana_${crypto.randomUUID().slice(0, 8)}` } }));
  const identite = creerIdentite();
  expect((await telephone.appel("/api/cles/identite", { method: "POST", json: inscription(identite) })).status).toBe(201);
  const ordinateur = await t.connecter(fausse);
  return { fausse, telephone, ordinateur, identite, id: moi.id };
}

const ouvrirCanal = async (a: Appareil, role: "donneur" | "receveur") => {
  const r = await a.appel("/api/cles/liaisons", { method: "POST", json: { role } });
  expect(r.status).toBe(201);
  return (await json<{ canal: string }>(r)).canal;
};

describe("liaison d'un appareil", () => {
  it("le nouvel appareil affiche le code, le téléphone le lit et transmet l'identité", async () => {
    const t = await preparer();
    const ana = await compte(t);

    // Ordinateur : il affiche un code (le secret ne quitte pas l'écran).
    const canal = await ouvrirCanal(ana.ordinateur, "receveur");
    const { code, paire } = preparerCode(canal, "receveur");

    // Téléphone : il lit le code, répond et scelle l'identité.
    const sienne = paireEchange();
    const reponse = await ana.telephone.appel(`/api/cles/liaisons/${canal}/reponse`, {
      method: "POST",
      json: {
        cle: versBase64(sienne.publique),
        preuve: versBase64(preuveLiaison(code, sienne.publique)),
        cles: versBase64(scellerIdentite(cleCommune(code, sienne, code.cle), canal, ana.identite)),
      },
    });
    expect(reponse.status).toBe(200);

    // Ordinateur : il vérifie la preuve, ouvre l'identité et s'inscrit.
    const etat = await json<EtatLiaison>(await ana.ordinateur.appel(`/api/cles/liaisons/${canal}`));
    expect(etat.etat).toBe("cles");
    expect(etat.autre).toBeTruthy();
    const cleTelephone = depuisBase64(etat.reponse!.cle);
    expect(verifierPreuve(code, cleTelephone, depuisBase64(etat.reponse!.preuve))).toBe(true);
    const recue = ouvrirIdentite(cleCommune(code, paire, cleTelephone), canal, depuisBase64(etat.cles!));
    expect(versBase64(recue.signature.publique)).toBe(versBase64(ana.identite.signature.publique));

    const inscrit = await ana.ordinateur.appel("/api/cles/appareil", { method: "POST", json: { canal, appareil: inscription(recue).appareil } });
    expect(inscrit.status).toBe(201);
    const apres = await json<EtatCles>(inscrit);
    expect(apres.appareil?.numero).toBe(2);
    expect(apres.appareilsInscrits).toBe(2);

    // Une liaison ne sert qu'une fois.
    const encore = await ana.ordinateur.appel("/api/cles/appareil", { method: "POST", json: { canal, appareil: inscription(recue).appareil } });
    expect(encore.status).toBe(409);
    expect((await json<EtatLiaison>(await ana.telephone.appel(`/api/cles/liaisons/${canal}`))).etat).toBe("termine");

    // Les correspondants voient désormais deux appareils.
    const bob = await t.connecter(fausseIdentite("bob"));
    const { comptes } = await json<{ comptes: PaquetsCompte[] }>(
      await bob.appel("/api/cles/paquets", { method: "POST", json: { comptes: [{ id: ana.id }] } }),
    );
    expect(comptes[0]!.appareils.map((a) => a.numero)).toEqual([1, 2]);
  });

  it("le téléphone affiche le code, le nouvel appareil le lit puis reçoit l'identité", async () => {
    const t = await preparer();
    const ana = await compte(t);
    const canal = await ouvrirCanal(ana.telephone, "donneur");
    const { code, paire } = preparerCode(canal, "donneur");

    const sienne = paireEchange();
    const r = await ana.ordinateur.appel(`/api/cles/liaisons/${canal}/reponse`, {
      method: "POST",
      json: { cle: versBase64(sienne.publique), preuve: versBase64(preuveLiaison(code, sienne.publique)) },
    });
    expect(r.status).toBe(200);

    const vu = await json<EtatLiaison>(await ana.telephone.appel(`/api/cles/liaisons/${canal}`));
    expect(vu.etat).toBe("repondu");
    const cleOrdinateur = depuisBase64(vu.reponse!.cle);
    expect(verifierPreuve(code, cleOrdinateur, depuisBase64(vu.reponse!.preuve))).toBe(true);
    const depot = await ana.telephone.appel(`/api/cles/liaisons/${canal}/cles`, {
      method: "POST",
      json: { cles: versBase64(scellerIdentite(cleCommune(code, paire, cleOrdinateur), canal, ana.identite)) },
    });
    expect(depot.status).toBe(200);

    const recu = await json<EtatLiaison>(await ana.ordinateur.appel(`/api/cles/liaisons/${canal}`));
    expect(recu.role).toBe("receveur");
    const identite = ouvrirIdentite(cleCommune(code, sienne, code.cle), canal, depuisBase64(recu.cles!));
    const inscrit = await ana.ordinateur.appel("/api/cles/appareil", { method: "POST", json: { canal, appareil: inscription(identite).appareil } });
    expect(inscrit.status).toBe(201);
  });

  it("le code d'un autre compte ne mène nulle part", async () => {
    const t = await preparer();
    const ana = await compte(t);
    const canal = await ouvrirCanal(ana.ordinateur, "receveur");
    const intrus = await compte(t);
    const sienne = paireEchange();
    const r = await intrus.telephone.appel(`/api/cles/liaisons/${canal}/reponse`, {
      method: "POST",
      json: { cle: versBase64(sienne.publique), preuve: versBase64(aleatoire(32)), cles: versBase64(aleatoire(200)) },
    });
    expect(r.status).toBe(404);
  });

  it("un appareil non relié ne peut ni donner l'identité, ni s'inscrire sans liaison", async () => {
    const t = await preparer();
    const ana = await compte(t);
    const canal = await ouvrirCanal(ana.ordinateur, "receveur");
    const tiers = await t.connecter(ana.fausse);
    const sienne = paireEchange();
    const r = await tiers.appel(`/api/cles/liaisons/${canal}/reponse`, {
      method: "POST",
      json: { cle: versBase64(sienne.publique), preuve: versBase64(aleatoire(32)), cles: versBase64(aleatoire(200)) },
    });
    expect(r.status).toBe(409);
    expect((await ouvrirCanal(tiers, "receveur")).length).toBe(22);
    expect((await tiers.appel("/api/cles/liaisons", { method: "POST", json: { role: "donneur" } })).status).toBe(409);
    const sansLiaison = await tiers.appel("/api/cles/appareil", {
      method: "POST",
      json: { canal: versBase64(aleatoire(16)), appareil: inscription(ana.identite).appareil },
    });
    expect(sansLiaison.status).toBe(404);
  });

  it("un code périmé est refusé", async () => {
    const t = await preparer();
    const ana = await compte(t);
    const canal = await ouvrirCanal(ana.ordinateur, "receveur");
    t.avancer(6 * MINUTE);
    const sienne = paireEchange();
    const r = await ana.telephone.appel(`/api/cles/liaisons/${canal}/reponse`, {
      method: "POST",
      json: { cle: versBase64(sienne.publique), preuve: versBase64(aleatoire(32)), cles: versBase64(aleatoire(200)) },
    });
    expect(r.status).toBe(410);
  });
});

describe("réinitialisation des clés", () => {
  it("une nouvelle identité remplace l'ancienne ; les autres appareils sont à relier", async () => {
    const t = await preparer();
    const ana = await compte(t);
    const nouvelle = creerIdentite();
    const r = await ana.ordinateur.appel("/api/cles/reinitialisation", { method: "POST", json: inscription(nouvelle) });
    expect(r.status).toBe(201);
    const etat = await json<EtatCles>(r);
    expect(etat.identite?.version).toBe(2);
    expect(etat.identite?.signature).toBe(versBase64(nouvelle.signature.publique));
    expect(etat.appareilsInscrits).toBe(1);
    expect(etat.appareil?.numero).toBe(2);
    const telephone = await json<EtatCles>(await ana.telephone.appel("/api/cles"));
    expect(telephone.appareil).toBeNull();
  });

  it("demande une connexion récente", async () => {
    const t = await preparer();
    const ana = await compte(t);
    t.avancer(25 * HEURE);
    const r = await ana.ordinateur.appel("/api/cles/reinitialisation", { method: "POST", json: inscription(creerIdentite()) });
    expect(r.status).toBe(403);
    expect((await json<{ erreur: string }>(r)).erreur).toBe("reconnexion_requise");
  });
});
