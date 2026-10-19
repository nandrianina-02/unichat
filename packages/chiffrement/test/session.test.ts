import { describe, expect, it } from "vitest";
import {
  SAUT_MAX,
  chiffrer,
  cleSigneePublique,
  cleUniquePublique,
  creerCleSignee,
  creerClesUniques,
  creerIdentite,
  dechiffrer,
  depuisBase64,
  exigencesOuverture,
  identitePublique,
  octetsVersTexte,
  ouvrir,
  sceller,
  texteVersOctets,
  verifierPaquet,
  versBase64,
  aleatoire,
  type ClesLocales,
  type Correspondant,
  type IdentitePrivee,
  type Paquet,
} from "../src";

/** Un appareil de test : identité, clé signée, clés uniques, et ce qu'il publie. */
function appareil(identite: IdentitePrivee = creerIdentite()) {
  const cleSignee = creerCleSignee(identite, 1, Date.now());
  const uniques = new Map(creerClesUniques(1, 5).map((c) => [c.id, c]));
  const cles: ClesLocales = {
    identite,
    cleSignee: (id) => (id === cleSignee.id ? cleSignee : undefined),
    cleUnique: (id) => uniques.get(id),
  };
  const paquet = (avecUnique = true): Paquet => {
    const unique = [...uniques.values()][0];
    return {
      identite: identitePublique(identite),
      cleSignee: cleSigneePublique(cleSignee),
      ...(avecUnique && unique ? { cleUnique: cleUniquePublique(unique) } : {}),
    };
  };
  return { identite, cleSignee, uniques, cles, paquet };
}

const t = texteVersOctets;
const lire = octetsVersTexte;

/** Deux appareils et leurs sessions, pour faire circuler des messages. */
function paire() {
  const alice = appareil();
  const bob = appareil();
  let chezAlice: Correspondant | undefined;
  let chezBob: Correspondant | undefined;
  return {
    alice,
    bob,
    deAlice(texte: string, paquet?: Paquet) {
      const r = chiffrer(chezAlice, alice.identite, t(texte), paquet ?? (chezAlice ? undefined : bob.paquet()));
      chezAlice = r.correspondant;
      return r.message;
    },
    deBob(texte: string) {
      const r = chiffrer(chezBob, bob.identite, t(texte));
      chezBob = r.correspondant;
      return r.message;
    },
    versBob(message: Uint8Array) {
      const r = dechiffrer(chezBob, message, bob.cles);
      chezBob = r.correspondant;
      if (r.cleUniqueUtilisee) bob.uniques.delete(r.cleUniqueUtilisee);
      return lire(r.clair);
    },
    versAlice(message: Uint8Array) {
      const r = dechiffrer(chezAlice, message, alice.cles);
      chezAlice = r.correspondant;
      return lire(r.clair);
    },
    get chezAlice() {
      return chezAlice;
    },
  };
}

describe("octets", () => {
  it("base64 aller-retour, toutes longueurs", () => {
    for (let n = 0; n < 70; n++) {
      const o = aleatoire(n);
      expect([...depuisBase64(versBase64(o))]).toEqual([...o]);
    }
    expect(() => depuisBase64("ab$c")).toThrow();
  });
});

describe("identité et paquets", () => {
  it("un paquet honnête se vérifie", () => {
    expect(verifierPaquet(appareil().paquet())).toBe(true);
  });

  it("une clé signée par une autre identité est refusée", () => {
    const a = appareil();
    const intrus = creerIdentite();
    const faux: Paquet = { ...a.paquet(), cleSignee: cleSigneePublique(creerCleSignee(intrus, 1, 0)) };
    expect(verifierPaquet(faux)).toBe(false);
    expect(() => chiffrer(undefined, creerIdentite(), t("x"), faux)).toThrow(/signature/);
  });

  it("une clé d'échange substituée dans l'identité est refusée", () => {
    const a = appareil();
    const p = a.paquet();
    const faux: Paquet = { ...p, identite: { ...p.identite, echange: identitePublique(creerIdentite()).echange } };
    expect(verifierPaquet(faux)).toBe(false);
  });

  it("des appareils d'un même compte partagent l'identité, chacun sa clé signée", () => {
    const identite = creerIdentite();
    const telephone = appareil(identite);
    const ordinateur = appareil(identite);
    expect(verifierPaquet(telephone.paquet())).toBe(true);
    expect(verifierPaquet(ordinateur.paquet())).toBe(true);
    expect(versBase64(telephone.cleSignee.paire.publique)).not.toBe(versBase64(ordinateur.cleSignee.paire.publique));
  });
});

describe("sessions", () => {
  it("ouverture X3DH puis conversation dans les deux sens", () => {
    const s = paire();
    expect(s.versBob(s.deAlice("Bonjour Bob"))).toBe("Bonjour Bob");
    expect(s.versAlice(s.deBob("Bonjour Alice"))).toBe("Bonjour Alice");
    for (let i = 0; i < 5; i++) {
      expect(s.versBob(s.deAlice(`a${i}`))).toBe(`a${i}`);
      expect(s.versAlice(s.deBob(`b${i}`))).toBe(`b${i}`);
    }
  });

  it("la clé unique est consommée par la première ouverture", () => {
    const s = paire();
    const avant = s.bob.uniques.size;
    s.versBob(s.deAlice("x"));
    expect(s.bob.uniques.size).toBe(avant - 1);
  });

  it("sans clé unique disponible, la session s'ouvre quand même", () => {
    const s = paire();
    expect(s.versBob(s.deAlice("x", s.bob.paquet(false)))).toBe("x");
  });

  it("l'ouverture accompagne les messages tant que l'autre n'a pas répondu", () => {
    const s = paire();
    const premier = s.deAlice("1");
    const second = s.deAlice("2");
    expect(premier[1]).toBe(2);
    expect(second[1]).toBe(2);
    // Le premier s'est perdu : le second suffit à ouvrir la session.
    expect(s.versBob(second)).toBe("2");
    expect(s.versBob(premier)).toBe("1");
    s.versAlice(s.deBob("ok"));
    expect(s.deAlice("3")[1]).toBe(1);
  });

  it("messages dans le désordre, à travers plusieurs échanges", () => {
    const s = paire();
    s.versBob(s.deAlice("ouverture"));
    s.versAlice(s.deBob("réponse"));
    const lot = ["m0", "m1", "m2", "m3"].map((m) => [m, s.deAlice(m)] as const);
    expect(s.versBob(lot[2]![1])).toBe("m2");
    expect(s.versAlice(s.deBob("entre-temps"))).toBe("entre-temps");
    const suite = s.deAlice("m4");
    expect(s.versBob(suite)).toBe("m4");
    expect(s.versBob(lot[0]![1])).toBe("m0");
    expect(s.versBob(lot[3]![1])).toBe("m3");
    expect(s.versBob(lot[1]![1])).toBe("m1");
  });

  it("un message rejoué est refusé", () => {
    const s = paire();
    s.versBob(s.deAlice("ouverture"));
    s.versAlice(s.deBob("réponse"));
    const m = s.deAlice("une fois");
    expect(s.versBob(m)).toBe("une fois");
    expect(() => s.versBob(m)).toThrow();
  });

  it("un message altéré est refusé sans abîmer la session", () => {
    const s = paire();
    s.versBob(s.deAlice("ouverture"));
    s.versAlice(s.deBob("réponse"));
    const m = s.deAlice("intact");
    const altere = m.slice();
    altere[altere.length - 1]! ^= 1;
    expect(() => s.versBob(altere)).toThrow();
    expect(s.versBob(m)).toBe("intact");
  });

  it("un en-tête altéré (numéro de message) est refusé", () => {
    const s = paire();
    s.versBob(s.deAlice("ouverture"));
    s.versAlice(s.deBob("réponse"));
    const m = s.deAlice("x");
    const altere = m.slice();
    altere[2 + 32 + 7]! ^= 1;
    expect(() => s.versBob(altere)).toThrow();
    expect(s.versBob(m)).toBe("x");
  });

  it("trop de messages sautés d'un coup : refusé", () => {
    const s = paire();
    s.versBob(s.deAlice("ouverture"));
    s.versAlice(s.deBob("réponse"));
    for (let i = 0; i <= SAUT_MAX; i++) s.deAlice(`perdu ${i}`);
    expect(() => s.versBob(s.deAlice("trop loin"))).toThrow(/manquants/);
  });

  it("un tiers sans les clés ne lit rien", () => {
    const s = paire();
    const m = s.deAlice("secret");
    const intrus = appareil();
    expect(() => dechiffrer(undefined, m, intrus.cles)).toThrow();
  });

  it("ouvertures simultanées : les deux sessions convergent", () => {
    const alice = appareil();
    const bob = appareil();
    let chezAlice: Correspondant | undefined;
    let chezBob: Correspondant | undefined;
    const a = chiffrer(chezAlice, alice.identite, t("de Alice"), bob.paquet());
    chezAlice = a.correspondant;
    const b = chiffrer(chezBob, bob.identite, t("de Bob"), alice.paquet());
    chezBob = b.correspondant;
    const recuParBob = dechiffrer(chezBob, a.message, bob.cles);
    chezBob = recuParBob.correspondant;
    const recuParAlice = dechiffrer(chezAlice, b.message, alice.cles);
    chezAlice = recuParAlice.correspondant;
    expect(lire(recuParBob.clair)).toBe("de Alice");
    expect(lire(recuParAlice.clair)).toBe("de Bob");
    for (let i = 0; i < 3; i++) {
      const x = chiffrer(chezAlice, alice.identite, t(`a${i}`));
      chezAlice = x.correspondant;
      const y = dechiffrer(chezBob, x.message, bob.cles);
      chezBob = y.correspondant;
      expect(lire(y.clair)).toBe(`a${i}`);
      const z = chiffrer(chezBob, bob.identite, t(`b${i}`));
      chezBob = z.correspondant;
      const w = dechiffrer(chezAlice, z.message, alice.cles);
      chezAlice = w.correspondant;
      expect(lire(w.clair)).toBe(`b${i}`);
    }
  });

  it("l'état se range et se relit (clonage structuré, comme IndexedDB)", () => {
    const s = paire();
    s.versBob(s.deAlice("ouverture"));
    const copie = structuredClone(s.chezAlice);
    expect(copie).toEqual(s.chezAlice);
  });

  it("une ouverture dit quelles clés locales elle réclame ; un message ordinaire, aucune", () => {
    const s = paire();
    const ouverture = s.deAlice("x");
    const unique = s.bob.paquet().cleUnique!.id;
    expect(exigencesOuverture(ouverture)).toEqual({ cleSigneeId: 1, cleUniqueId: unique });
    s.versBob(ouverture);
    s.versAlice(s.deBob("ok"));
    expect(exigencesOuverture(s.deAlice("y"))).toBeNull();
  });

  it("l'identité de l'expéditeur est rendue pour être comparée", () => {
    const s = paire();
    const r = dechiffrer(undefined, s.deAlice("x"), s.bob.cles);
    expect(versBase64(r.identite.signature)).toBe(versBase64(s.alice.identite.signature.publique));
    expect(r.nouvelleSession).toBe(true);
  });
});

describe("contenu scellé", () => {
  it("ouvre ce qui a été scellé, refuse une autre donnée associée", () => {
    const cle = aleatoire(32);
    const s = sceller(cle, t("corps"), t("message-1"));
    expect(lire(ouvrir(cle, s, t("message-1")))).toBe("corps");
    expect(() => ouvrir(cle, s, t("message-2"))).toThrow();
    expect(() => ouvrir(aleatoire(32), s, t("message-1"))).toThrow();
  });
});
