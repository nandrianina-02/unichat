import { describe, expect, it } from "vitest";
import { dechiffrer, dechiffrerOctets, octetsVersTexte, ouvrirIdentite, verifierIdentite, type Correspondant } from "../src";
import { cleSigneeLue, cleUniqueLue, correspondantLu, identitePriveeLue, identitePubliqueLue, lireFichier, oct, variable } from "./interop";
import { lireCode } from "../src/liaison";

/*
 * Ce que l'appli Android native a chiffré, relu par le code du web.
 *   VECTEURS=<vecteurs-web.json> SORTIE_KOTLIN=<sortie-kotlin.json> npx vitest run test/kotlin.test.ts
 * L'intégration continue l'enchaîne après les tests Kotlin. Sans les
 * variables, ce test ne fait rien.
 */

const VECTEURS = variable("VECTEURS");
const SORTIE = variable("SORTIE_KOTLIN");

describe.skipIf(!VECTEURS || !SORTIE)("le web relit ce que Kotlin a chiffré", () => {
  it("messages, réponse, liaison et fichier", async () => {
    const v = JSON.parse(await lireFichier(VECTEURS!));
    const k = JSON.parse(await lireFichier(SORTIE!));
    const s = v.session;
    const bob = identitePriveeLue(s.bob);
    const signee = cleSigneeLue(s.cleSignee);
    const unique = cleUniqueLue(s.cleUnique);
    const cles = {
      identite: bob,
      cleSignee: (id: number) => (id === signee.id ? signee : undefined),
      cleUnique: (id: number) => (id === unique.id ? unique : undefined),
    };

    expect(verifierIdentite(identitePubliqueLue(k.carole))).toBe(true);
    let c: Correspondant | undefined;
    for (const m of k.messages as { message: string; clair: string }[]) {
      const r = dechiffrer(c, oct(m.message), cles);
      expect(octetsVersTexte(r.clair)).toBe(m.clair);
      c = r.correspondant;
    }

    // Alice a répondu depuis Kotlin après un ratchet DH : Bob, tel que le web l'a laissé, la lit.
    const suite = dechiffrer(correspondantLu(s.etatBob), oct(k.suite.message), cles);
    expect(octetsVersTexte(suite.clair)).toBe(k.suite.clair);

    const code = lireCode(v.liaison.code)!;
    const recue = ouvrirIdentite(oct(v.liaison.cle), code.canal, oct(k.liaison.identiteScellee));
    expect(recue.signature.secrete).toEqual(oct(k.liaison.signatureCarole));

    expect(await dechiffrerOctets(oct(k.fichier.scelle), oct(k.fichier.cle))).toEqual(oct(k.fichier.clair));
  });
});
