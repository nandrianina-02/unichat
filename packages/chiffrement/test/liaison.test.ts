import { describe, expect, it } from "vitest";
import {
  aleatoire,
  cleCommune,
  creerIdentite,
  encoderCode,
  identitePublique,
  lireCode,
  ouvrirIdentite,
  paireEchange,
  preparerCode,
  preuveLiaison,
  scellerIdentite,
  verifierPreuve,
  versBase64,
  type CodeLiaison,
} from "../src";

const canal = versBase64(aleatoire(16));
const memeIdentite = (a: ReturnType<typeof creerIdentite>, b: ReturnType<typeof creerIdentite>) =>
  versBase64(a.signature.secrete) === versBase64(b.signature.secrete) && versBase64(a.echange.secrete) === versBase64(b.echange.secrete);

describe("code de liaison", () => {
  it("s'écrit et se relit", () => {
    const { code } = preparerCode(canal, "receveur");
    const relu = lireCode(encoderCode(code))!;
    expect(relu.canal).toBe(canal);
    expect(versBase64(relu.cle)).toBe(versBase64(code.cle));
    expect(versBase64(relu.secret)).toBe(versBase64(code.secret));
    expect(relu.role).toBe("receveur");
  });

  it("un texte quelconque n'est pas un code", () => {
    for (const faux of ["", "https://exemple.com", "UC1.a.b.c.d", `UC2.${canal}.x.y.r`]) expect(lireCode(faux)).toBeNull();
  });
});

describe("liaison", () => {
  it("le nouvel appareil affiche, l'ancien lit et transmet l'identité", () => {
    const identite = creerIdentite();
    // Nouvel appareil (receveur) : il affiche le code.
    const { code, paire: paireReceveur } = preparerCode(canal, "receveur");
    // Appareil relié (donneur) : il lit le code, répond et scelle l'identité.
    const lu = lireCode(encoderCode(code))!;
    const paireDonneur = paireEchange();
    const preuve = preuveLiaison(lu, paireDonneur.publique);
    const scelle = scellerIdentite(cleCommune(lu, paireDonneur, lu.cle), canal, identite);
    // De retour chez le receveur.
    expect(verifierPreuve(code, paireDonneur.publique, preuve)).toBe(true);
    const recue = ouvrirIdentite(cleCommune(code, paireReceveur, paireDonneur.publique), canal, scelle);
    expect(memeIdentite(recue, identite)).toBe(true);
    expect(versBase64(identitePublique(recue).preuve)).toBe(versBase64(identite.preuve));
  });

  it("l'ancien appareil affiche, le nouveau lit puis reçoit", () => {
    const identite = creerIdentite();
    const { code, paire: paireDonneur } = preparerCode(canal, "donneur");
    const lu = lireCode(encoderCode(code))!;
    const paireReceveur = paireEchange();
    const preuve = preuveLiaison(lu, paireReceveur.publique);
    expect(verifierPreuve(code, paireReceveur.publique, preuve)).toBe(true);
    const scelle = scellerIdentite(cleCommune(code, paireDonneur, paireReceveur.publique), canal, identite);
    expect(memeIdentite(ouvrirIdentite(cleCommune(lu, paireReceveur, lu.cle), canal, scelle), identite)).toBe(true);
  });

  it("un serveur qui substitue sa propre clé ne produit pas de preuve valable", () => {
    const { code } = preparerCode(canal, "receveur");
    const intrus = paireEchange();
    // Sans le secret affiché à l'écran, la preuve est forgée au hasard.
    const sansSecret: CodeLiaison = { ...code, secret: aleatoire(16) };
    expect(verifierPreuve(code, intrus.publique, preuveLiaison(sansSecret, intrus.publique))).toBe(false);
  });

  it("un intrus qui n'a que la clé publique ne lit pas l'identité", () => {
    const identite = creerIdentite();
    const { code } = preparerCode(canal, "receveur");
    const donneur = paireEchange();
    const scelle = scellerIdentite(cleCommune(code, donneur, code.cle), canal, identite);
    const intrus = paireEchange();
    expect(() => ouvrirIdentite(cleCommune(code, intrus, donneur.publique), canal, scelle)).toThrow();
  });

  it("une identité scellée pour un autre canal est refusée", () => {
    const identite = creerIdentite();
    const { code, paire } = preparerCode(canal, "receveur");
    const donneur = paireEchange();
    const scelle = scellerIdentite(cleCommune(code, donneur, code.cle), "autre-canal-0000000000", identite);
    expect(() => ouvrirIdentite(cleCommune(code, paire, donneur.publique), canal, scelle)).toThrow();
  });
});
