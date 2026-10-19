import { describe, expect, it } from "vitest";
import {
  aleatoire,
  assembler,
  chiffrer,
  cleCommune,
  creerCleSignee,
  creerClesUniques,
  creerIdentite,
  dechiffrer,
  depuisBase64,
  identitePublique,
  octetsVersTexte,
  ouvrir as ouvrirScelle,
  paireEchange,
  preparerCode,
  preuveLiaison,
  sceller,
  scellerIdentite,
  texteVersOctets,
  versBase64,
  type CleUnique,
  type IdentitePrivee,
  type Paquet,
} from "@unichat/chiffrement";
import {
  associeContenu,
  conversationDirecte,
  type AppareilsCompte,
  type Entree,
  type EtatCles,
  type InscriptionCles,
  type MessageServeur,
  type Moi,
  type PaquetsCompte,
} from "@unichat/shared";
import { identite as fausseIdentite, preparer } from "./outils";

type Contexte = Awaited<ReturnType<typeof preparer>>;
type Appareil = Awaited<ReturnType<Contexte["connecter"]>>;
const json = async <T>(r: Response): Promise<T> => (await r.json()) as T;

/** Ce qu'un appareil garde : son identité, sa clé signée, ses clés uniques, et ce qu'il publie. */
function trousseau(identite: IdentitePrivee) {
  const signee = creerCleSignee(identite, 1, Date.now());
  const uniques = creerClesUniques(1, 10);
  const pub = identitePublique(identite);
  const inscription: InscriptionCles = {
    identite: { signature: versBase64(pub.signature), echange: versBase64(pub.echange), preuve: versBase64(pub.preuve) },
    appareil: {
      cleSignee: { id: 1, cle: versBase64(signee.paire.publique), signature: versBase64(signee.signature) },
      clesUniques: uniques.map((u) => ({ id: u.id, cle: versBase64(u.paire.publique) })),
      jeton: versBase64(aleatoire(32)),
    },
  };
  const parId = new Map<number, CleUnique>(uniques.map((u) => [u.id, u]));
  return { identite, signee, parId, inscription };
}

async function personne(t: Contexte, prefixe: string) {
  const fausse = fausseIdentite(prefixe);
  const appareil = await t.connecter(fausse);
  const moi = await json<Moi>(await appareil.appel("/api/moi", { method: "PATCH", json: { pseudo: `${prefixe}_${crypto.randomUUID().slice(0, 8)}` } }));
  const k = trousseau(creerIdentite());
  expect((await appareil.appel("/api/cles/identite", { method: "POST", json: k.inscription })).status).toBe(201);
  return { fausse, appareil, id: moi.id, k };
}

/** Second appareil relié par la vraie liaison (le serveur n'accepte rien d'autre). */
async function relier(t: Contexte, p: Awaited<ReturnType<typeof personne>>): Promise<Appareil> {
  const nouveau = await t.connecter(p.fausse);
  const { canal } = await json<{ canal: string }>(await nouveau.appel("/api/cles/liaisons", { method: "POST", json: { role: "receveur" } }));
  const { code } = preparerCode(canal, "receveur");
  const sienne = paireEchange();
  await p.appareil.appel(`/api/cles/liaisons/${canal}/reponse`, {
    method: "POST",
    json: {
      cle: versBase64(sienne.publique),
      preuve: versBase64(preuveLiaison(code, sienne.publique)),
      cles: versBase64(scellerIdentite(cleCommune(code, sienne, code.cle), canal, p.k.identite)),
    },
  });
  const r = await nouveau.appel("/api/cles/appareil", { method: "POST", json: { canal, appareil: trousseau(p.k.identite).inscription.appareil } });
  expect(r.status).toBe(201);
  return nouveau;
}

async function ouvrir(appareil: Appareil) {
  const connexion = await appareil.tempsReel();
  if (connexion.refus !== null) throw new Error(`connexion refusée : ${connexion.refus}`);
  connexion.envoyer({ t: "bonjour", depuis: null });
  await connexion.attendre((m): m is MessageServeur => m.t === "lot");
  return connexion;
}

const estChiffre = (m: MessageServeur): m is Extract<MessageServeur, { t: "entree" }> => m.t === "entree" && m.entree.type === "chiffre";
const reponse = (id: string) => (m: MessageServeur): m is Extract<MessageServeur, { t: "accepte" | "refuse" }> =>
  (m.t === "accepte" || m.t === "refuse") && m.id === id;
const faux = () => versBase64(aleatoire(120));

describe("discussion à deux chiffrée", () => {
  it("le contenu traverse le serveur scellé ; chaque boîte ne reçoit que les clés de ses appareils", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    const ordinateurAna = await relier(t, ana);
    const wsAna = await ouvrir(ana.appareil);
    const wsBob = await ouvrir(bob.appareil);
    const wsOrdinateur = await ouvrir(ordinateurAna);

    // Ana chiffre pour l'appareil de Bob avec le paquet servi par l'annuaire.
    const { comptes } = await json<{ comptes: AppareilsCompte[] }>(await ana.appareil.appel("/api/cles/appareils", { method: "POST", json: { comptes: [bob.id, ana.id] } }));
    expect(comptes.find((c) => c.id === ana.id)!.appareils).toEqual([1, 2]);
    const [paquetBob] = await json<{ comptes: PaquetsCompte[] }>(
      await ana.appareil.appel("/api/cles/paquets", { method: "POST", json: { comptes: [{ id: bob.id, appareils: [1] }] } }),
    ).then((r) => r.comptes);
    const a = paquetBob!.appareils[0]!;
    const paquet: Paquet = {
      identite: { signature: depuisBase64(paquetBob!.identite.signature), echange: depuisBase64(paquetBob!.identite.echange), preuve: depuisBase64(paquetBob!.identite.preuve) },
      cleSignee: { id: a.cleSignee.id, cle: depuisBase64(a.cleSignee.cle), signature: depuisBase64(a.cleSignee.signature) },
      ...(a.cleUnique ? { cleUnique: { id: a.cleUnique.id, cle: depuisBase64(a.cleUnique.cle) } } : {}),
    };
    const id = crypto.randomUUID();
    const conversation = conversationDirecte(ana.id, bob.id);
    const cle = aleatoire(32);
    const corps = sceller(cle, texteVersOctets(JSON.stringify({ v: 1, texte: "Rendez-vous à 19 h" })), texteVersOctets(associeContenu(id, conversation, ana.id)));
    const pourBob = chiffrer(undefined, ana.k.identite, assembler(cle, texteVersOctets(id)), paquet).message;

    wsAna.envoyer({ t: "chiffre", id, a: bob.id, genre: "message", corps: versBase64(corps), cles: { [bob.id]: { "1": versBase64(pourBob) }, [ana.id]: { "2": faux() } } });
    expect((await wsAna.attendre(reponse(id))).t).toBe("accepte");

    // Bob : son enveloppe ne porte que sa clé, et il lit le message.
    const recu = await wsBob.attendre(estChiffre);
    const e = (recu.entree as Extract<Entree, { type: "chiffre" }>).enveloppe;
    expect(e).toMatchObject({ id, de: ana.id, deAppareil: 1, a: bob.id, genre: "message", conversation });
    expect(Object.keys(e.cles)).toEqual(["1"]);
    const ouvert = dechiffrer(undefined, depuisBase64(e.cles["1"]!), {
      identite: bob.k.identite,
      cleSignee: (n) => (n === bob.k.signee.id ? bob.k.signee : undefined),
      cleUnique: (n) => bob.k.parId.get(n),
    });
    const cleRecue = ouvert.clair.slice(0, 32);
    expect(octetsVersTexte(ouvert.clair.slice(32))).toBe(id);
    const contenu = JSON.parse(octetsVersTexte(ouvrirScelle(cleRecue, depuisBase64(e.corps), texteVersOctets(associeContenu(id, conversation, ana.id)))));
    expect(contenu.texte).toBe("Rendez-vous à 19 h");

    // L'autre appareil d'Ana reçoit sa propre clé ; le journal ne contient aucun texte en clair.
    const copie = await wsOrdinateur.attendre(estChiffre);
    expect(Object.keys((copie.entree as Extract<Entree, { type: "chiffre" }>).enveloppe.cles)).toEqual(["2"]);
    expect(JSON.stringify(recu)).not.toContain("Rendez-vous");

    // Bob accuse réception : Ana voit « remis ».
    wsBob.envoyer({ t: "recu", jusqua: recu.entree.seq });
    const remis = await wsAna.attendre((m): m is MessageServeur => m.t === "entree" && m.entree.type === "accuse" && m.entree.etat === "remis");
    expect(remis.t === "entree" && remis.entree.type === "accuse" && remis.entree.ids).toEqual([id]);

    // Renvoyé après une coupure : confirmé sans nouvelle remise.
    wsAna.envoyer({ t: "chiffre", id, a: bob.id, genre: "message", corps: versBase64(corps), cles: { [bob.id]: { "1": faux() }, [ana.id]: { "2": faux() } } });
    expect((await wsAna.attendre((m): m is MessageServeur => m.t === "accepte" && m.id === id && wsAna.recus.filter((x) => x.t === "accepte").length === 2)).t).toBe("accepte");
  });

  it("un appareil oublié ou de trop : refus avec la bonne liste", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    await relier(t, bob);
    const wsAna = await ouvrir(ana.appareil);

    const oubli = crypto.randomUUID();
    wsAna.envoyer({ t: "chiffre", id: oubli, a: bob.id, genre: "message", corps: faux(), cles: { [bob.id]: { "1": faux() } } });
    const refus = await wsAna.attendre(reponse(oubli));
    expect(refus).toMatchObject({ t: "refuse", code: "appareils", appareils: { [bob.id]: [1, 2], [ana.id]: [] } });

    const enTrop = crypto.randomUUID();
    wsAna.envoyer({ t: "chiffre", id: enTrop, a: bob.id, genre: "action", corps: faux(), cles: { [bob.id]: { "1": faux(), "2": faux(), "7": faux() } } });
    expect(await wsAna.attendre(reponse(enTrop))).toMatchObject({ t: "refuse", code: "appareils" });
  });

  it("un appareil pas encore relié ne peut pas écrire chiffré", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    const nonRelie = await t.connecter(ana.fausse);
    const ws = await ouvrir(nonRelie);
    const id = crypto.randomUUID();
    ws.envoyer({ t: "chiffre", id, a: bob.id, genre: "message", corps: faux(), cles: { [bob.id]: { "1": faux() }, [ana.id]: { "1": faux() } } });
    expect(await ws.attendre(reponse(id))).toMatchObject({ t: "refuse", code: "non_relie" });
  });

  it("bloqué par le destinataire : accepté, jamais remis", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    expect((await bob.appareil.appel("/api/blocages", { method: "POST", json: { id: ana.id } })).status).toBe(201);
    const wsAna = await ouvrir(ana.appareil);
    const wsBob = await ouvrir(bob.appareil);
    const id = crypto.randomUUID();
    wsAna.envoyer({ t: "chiffre", id, a: bob.id, genre: "message", corps: faux(), cles: { [bob.id]: { "1": faux() } } });
    expect((await wsAna.attendre(reponse(id))).t).toBe("accepte");
    await new Promise((r) => setTimeout(r, 200));
    expect(wsBob.recus.some((m) => m.t === "entree" && m.entree.type === "chiffre")).toBe(false);
  });

  it("annuaire des appareils : un compte sans clés n'y figure pas, aucune clé unique consommée", async () => {
    const t = await preparer();
    const ana = await personne(t, "ana");
    const sansCles = await t.connecter(fausseIdentite("lova"));
    const lova = await json<Moi>(await sansCles.appel("/api/moi", { method: "PATCH", json: { pseudo: `lova_${crypto.randomUUID().slice(0, 8)}` } }));
    const avant = await json<EtatCles>(await ana.appareil.appel("/api/cles"));
    const { comptes } = await json<{ comptes: AppareilsCompte[] }>(await ana.appareil.appel("/api/cles/appareils", { method: "POST", json: { comptes: [ana.id, lova.id] } }));
    expect(comptes.map((c) => c.id)).toEqual([ana.id]);
    const apres = await json<EtatCles>(await ana.appareil.appel("/api/cles"));
    expect(apres.appareil?.clesUniques).toBe(avant.appareil?.clesUniques);
  });
});

describe("groupe chiffré", () => {
  async function groupe(t: Contexte) {
    const ana = await personne(t, "ana");
    const bob = await personne(t, "bob");
    const lova = await personne(t, "lova");
    for (const id of [bob.id, lova.id]) await ana.appareil.appel("/api/contacts", { method: "POST", json: { id } });
    const g = await json<{ id: string }>(await ana.appareil.appel("/api/groupes", { method: "POST", json: { nom: "Famille", membres: [bob.id, lova.id] } }));
    return { ana, bob, lova, groupeId: g.id };
  }

  it("chaque membre reçoit l'enveloppe avec les seules clés de ses appareils ; mentions limitées aux membres", async () => {
    const t = await preparer();
    const { ana, bob, lova, groupeId } = await groupe(t);
    const wsAna = await ouvrir(ana.appareil);
    const wsBob = await ouvrir(bob.appareil);
    const wsLova = await ouvrir(lova.appareil);
    const id = crypto.randomUUID();
    const intrus = crypto.randomUUID();
    wsAna.envoyer({
      t: "chiffre",
      id,
      groupe: groupeId,
      genre: "message",
      mentions: [bob.id, intrus],
      corps: faux(),
      cles: { [bob.id]: { "1": "cle-bob" }, [lova.id]: { "1": "cle-lova" }, [ana.id]: {} },
    });
    const accepte = await wsAna.attendre(reponse(id));
    expect(accepte).toMatchObject({ t: "accepte", destinataires: 2 });
    const chezBob = (await wsBob.attendre(estChiffre)).entree as Extract<Entree, { type: "chiffre" }>;
    const chezLova = (await wsLova.attendre(estChiffre)).entree as Extract<Entree, { type: "chiffre" }>;
    expect(chezBob.enveloppe).toMatchObject({ conversation: `g:${groupeId}`, a: groupeId, cles: { "1": "cle-bob" }, mentions: [bob.id] });
    expect(chezLova.enveloppe.cles).toEqual({ "1": "cle-lova" });
  });

  it("un membre oublié : refus avec la liste de tous les membres", async () => {
    const t = await preparer();
    const { ana, bob, lova, groupeId } = await groupe(t);
    const wsAna = await ouvrir(ana.appareil);
    const id = crypto.randomUUID();
    wsAna.envoyer({ t: "chiffre", id, groupe: groupeId, genre: "message", corps: faux(), cles: { [bob.id]: { "1": faux() } } });
    expect(await wsAna.attendre(reponse(id))).toMatchObject({ t: "refuse", code: "appareils", appareils: { [bob.id]: [1], [lova.id]: [1], [ana.id]: [] } });

    // Un compte qui n'est pas membre ne peut pas être visé.
    const autre = await personne(t, "lalao");
    const id2 = crypto.randomUUID();
    wsAna.envoyer({ t: "chiffre", id: id2, groupe: groupeId, genre: "message", corps: faux(), cles: { [bob.id]: { "1": faux() }, [lova.id]: { "1": faux() }, [autre.id]: { "1": faux() } } });
    expect(await wsAna.attendre(reponse(id2))).toMatchObject({ t: "refuse", code: "appareils" });
  });

  it("qui n'est pas membre ne peut pas écrire au groupe", async () => {
    const t = await preparer();
    const { groupeId } = await groupe(t);
    const dehors = await personne(t, "lalao");
    const ws = await ouvrir(dehors.appareil);
    const id = crypto.randomUUID();
    ws.envoyer({ t: "chiffre", id, groupe: groupeId, genre: "message", corps: faux(), cles: {} });
    expect(await ws.attendre(reponse(id))).toMatchObject({ t: "refuse" });
  });

  it("une action réservée à un membre (vue unique ouverte) ne va qu'à lui", async () => {
    const t = await preparer();
    const { ana, bob, lova, groupeId } = await groupe(t);
    const wsAna = await ouvrir(ana.appareil);
    const wsBob = await ouvrir(bob.appareil);
    const wsLova = await ouvrir(lova.appareil);
    const id = crypto.randomUUID();
    wsLova.envoyer({ t: "chiffre", id, groupe: groupeId, pour: ana.id, genre: "action", corps: faux(), cles: { [ana.id]: { "1": faux() }, [lova.id]: {} } });
    expect(await wsLova.attendre(reponse(id))).toMatchObject({ t: "accepte", destinataires: 1 });
    expect((await wsAna.attendre(estChiffre)).t).toBe("entree");
    await new Promise((r) => setTimeout(r, 200));
    expect(wsBob.recus.some(estChiffre)).toBe(false);
  });
});
