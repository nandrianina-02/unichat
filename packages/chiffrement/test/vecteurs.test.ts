import { describe, expect, it } from "vitest";
import {
  chiffrer,
  chiffrerOctets,
  cleSigneePublique,
  codeSecurite,
  creerCleSignee,
  creerClesUniques,
  creerIdentite,
  dechiffrer,
  identitePublique,
  preparerCode,
  encoderCode,
  scellerIdentite,
  texteVersOctets,
  versHex,
  assembler,
  type Correspondant,
} from "../src";
import { aleatoire, authentifier, chiffrerAead, deriver, echanger, paireEchange, paireSignature, sceller, signer } from "../src/primitives";
import { cleCommune, preuveLiaison } from "../src/liaison";
import { ouvrirX3DH } from "../src/x3dh";
import { b64, cleSigneeJson, ecrireFichier, oct, variable, cleUniqueJson, correspondantJson, identitePriveeJson, identitePubliqueJson } from "./interop";

/*
 * Jeux d'essai pour l'appli Android native, produits par le code du web.
 *   GENERER_VECTEURS=<fichier.json> npx vitest run test/vecteurs.test.ts
 * Le fichier est relu par les tests Kotlin (apps/android-natif). Sans la
 * variable, ce test ne fait rien.
 */

const CIBLE = variable("GENERER_VECTEURS");

describe.skipIf(!CIBLE)("jeux d'essai pour l'appli Android", () => {
  it("écrit les jeux d'essai", async () => {
    const texte = (s: string) => texteVersOctets(s);

    // --- Primitives -----------------------------------------------------------------
    const base64 = [0, 1, 2, 3, 31, 32, 33].map((n) => {
      const o = aleatoire(n);
      return { octets: versHex(o), texte: b64(o) };
    });
    const a = paireEchange();
    const b = paireEchange();
    const sig = paireSignature();
    const messageSigne = texte("UniChat : message signé");
    const ikm = aleatoire(40);
    const sel = aleatoire(32);
    const cleHmac = aleatoire(32);
    const cleAead = aleatoire(32);
    const nonce = aleatoire(12);
    const clair = texte("Bonjour depuis le web, avec des accents : é à ç ù.");
    const associe = aleatoire(20);

    // --- Identité, X3DH -------------------------------------------------------------
    const alice = creerIdentite();
    const bob = creerIdentite();
    const bobSignee = creerCleSignee(bob, 7, 1_700_000_000_000);
    const [bobUnique] = creerClesUniques(42, 1);
    const ephemere = paireEchange();
    const paquet = { identite: identitePublique(bob), cleSignee: cleSigneePublique(bobSignee), cleUnique: { id: bobUnique!.id, cle: bobUnique!.paire.publique } };
    const x3dh = ouvrirX3DH(alice, paquet, ephemere);

    // --- Une vraie session : Alice écrit trois messages, Bob répond --------------------
    let cA: Correspondant | undefined;
    const clairsA = ["Premier message", "Deuxième, en route en même temps", "Troisième, arrivé avant le deuxième"];
    const messagesA: string[] = [];
    for (const m of clairsA) {
      const r = chiffrer(cA, alice, texte(m), paquet);
      cA = r.correspondant;
      messagesA.push(b64(r.message));
    }
    const clesBob = {
      identite: bob,
      cleSignee: (id: number) => (id === bobSignee.id ? bobSignee : undefined),
      cleUnique: (id: number) => (id === bobUnique!.id ? bobUnique : undefined),
    };
    // Bob reçoit dans le désordre : 1, 3, 2 (clés sautées).
    let cB: Correspondant | undefined;
    for (const i of [0, 2, 1]) {
      const r = dechiffrer(cB, oct(messagesA[i]!), clesBob);
      expect(new TextDecoder().decode(r.clair)).toBe(clairsA[i]);
      cB = r.correspondant;
    }
    const reponse = chiffrer(cB, bob, texte("Réponse de Bob"));

    // --- Enveloppe d'un message, comme apps/web/src/lib/chiffrement.ts la fabrique --------
    // Le contenu est scellé sous une clé aléatoire ; cette clé, suivie de l'identifiant du
    // message, part vers l'appareil 3 de Bob par une session neuve.
    const idMessage = "8f14e45f-ceea-467a-9a36-dedd4bea2543";
    const conversationEnveloppe = "d:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222";
    const alicId = "11111111-1111-4111-8111-111111111111";
    const contenuEnveloppe = { v: 1, texte: "Message chiffré par le web, lu par Android", reponseA: { id: idMessage, de: alicId, extrait: "Citation" } };
    const cleContenu = aleatoire(32);
    const corps = sceller(cleContenu, texte(JSON.stringify(contenuEnveloppe)), texte(`UniChat-contenu-v1|${idMessage}|${conversationEnveloppe}|${alicId}`));
    const pourBob = chiffrer(undefined, alice, assembler(cleContenu, texte(idMessage)), paquet);
    const enveloppe = {
      id: idMessage,
      conversation: conversationEnveloppe,
      de: alicId,
      deAppareil: 1,
      a: "22222222-2222-4222-8222-222222222222",
      genre: "message",
      corps: b64(corps),
      cles: { "3": b64(pourBob.message) },
      le: 1_793_700_000_000,
    };

    // --- Liaison --------------------------------------------------------------------
    const { code, paire: paireCode } = preparerCode("canal-essai-0123456789abcdef", "donneur");
    const paireReponse = paireEchange();
    const cleLiaison = cleCommune(code, paireCode, paireReponse.publique);

    // --- Code de sécurité, fichier ----------------------------------------------------
    const parties = { moi: { compte: "compte-alice", identite: identitePublique(alice) }, autre: { compte: "compte-bob", identite: identitePublique(bob) } };
    const fichierClair = aleatoire(1000);
    const fichier = await chiffrerOctets(fichierClair);

    const vecteurs = {
      base64,
      x25519: { secreteA: b64(a.secrete), publiqueA: b64(a.publique), publiqueB: b64(b.publique), partage: b64(echanger(a.secrete, b.publique)) },
      ed25519: { secrete: b64(sig.secrete), publique: b64(sig.publique), message: b64(messageSigne), signature: b64(signer(messageSigne, sig.secrete)) },
      hkdf: { ikm: b64(ikm), sel: b64(sel), info: "UniChat-essai-v1", taille: 44, sortie: b64(deriver(ikm, sel, "UniChat-essai-v1", 44)) },
      hmac: { cle: b64(cleHmac), message: b64(clair), sortie: b64(authentifier(cleHmac, clair)) },
      aead: { cle: b64(cleAead), nonce: b64(nonce), clair: b64(clair), associe: b64(associe), chiffre: b64(chiffrerAead(cleAead, nonce, clair, associe)) },
      scelle: { cle: b64(cleAead), associe: b64(associe), clair: b64(clair), scelle: b64(sceller(cleAead, clair, associe)) },
      identite: { privee: identitePriveeJson(alice), publique: identitePubliqueJson(identitePublique(alice)) },
      cleSignee: { identite: identitePubliqueJson(identitePublique(bob)), cle: cleSigneeJson(bobSignee) },
      x3dh: {
        alice: identitePriveeJson(alice),
        bob: identitePriveeJson(bob),
        cleSignee: cleSigneeJson(bobSignee),
        cleUnique: cleUniqueJson(bobUnique!),
        ephemere: b64(ephemere.secrete),
        sk: b64(x3dh.sk),
        ad: b64(x3dh.ad),
      },
      session: {
        alice: identitePriveeJson(alice),
        bob: identitePriveeJson(bob),
        cleSignee: cleSigneeJson(bobSignee),
        cleUnique: cleUniqueJson(bobUnique!),
        messages: messagesA.map((m, i) => ({ message: m, clair: clairsA[i] })),
        /** Alice telle que le web l'a laissée après ses trois envois : elle doit lire la réponse. */
        etatAlice: correspondantJson(cA!),
        reponse: { message: b64(reponse.message), clair: "Réponse de Bob" },
        /** Bob après sa réponse : il doit lire ce qu'Alice renvoie depuis Kotlin (test/kotlin.test.ts). */
        etatBob: correspondantJson(reponse.correspondant),
      },
      liaison: {
        code: encoderCode(code),
        paireCode: b64(paireCode.secrete),
        paireReponse: b64(paireReponse.secrete),
        cleReponse: b64(paireReponse.publique),
        preuve: b64(preuveLiaison(code, paireReponse.publique)),
        cle: b64(cleLiaison),
        identiteScellee: b64(scellerIdentite(cleLiaison, code.canal, alice)),
        identite: identitePriveeJson(alice),
      },
      code: {
        moi: { compte: parties.moi.compte, identite: identitePubliqueJson(parties.moi.identite) },
        autre: { compte: parties.autre.compte, identite: identitePubliqueJson(parties.autre.identite) },
        ...codeSecurite(parties.moi, parties.autre),
      },
      fichier: { cle: b64(fichier.cle), scelle: b64(fichier.scelle), clair: b64(fichierClair) },
      enveloppe: { enveloppe, numeroBob: 3, contenu: contenuEnveloppe },
    };
    await ecrireFichier(CIBLE!, JSON.stringify(vecteurs, null, 2) + "\n");
  });
});
