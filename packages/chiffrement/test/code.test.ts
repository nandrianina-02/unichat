import { describe, expect, it } from "vitest";
import { codeSecurite, comparerCodeScanne, creerIdentite, identitePublique } from "../src";

const ANA = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

describe("code de sécurité", () => {
  const ana = { compte: ANA, identite: identitePublique(creerIdentite()) };
  const bob = { compte: BOB, identite: identitePublique(creerIdentite()) };
  const chezAna = codeSecurite(ana, bob);
  const chezBob = codeSecurite(bob, ana);

  it("les deux personnes lisent les mêmes 60 chiffres", () => {
    expect(chezAna.chiffres).toMatch(/^\d{60}$/);
    expect(chezBob.chiffres).toBe(chezAna.chiffres);
  });

  it("change avec l'identité, et avec le compte qui la porte", () => {
    const bobRefait = { compte: BOB, identite: identitePublique(creerIdentite()) };
    expect(codeSecurite(ana, bobRefait).chiffres).not.toBe(chezAna.chiffres);
    expect(codeSecurite(ana, { ...bob, compte: "33333333-3333-4333-8333-333333333333" }).chiffres).not.toBe(chezAna.chiffres);
  });

  it("le QR code de l'autre correspond au mien", () => {
    expect(comparerCodeScanne(chezBob.qr, chezAna)).toBe("identique");
    expect(comparerCodeScanne(chezAna.qr, chezBob)).toBe("identique");
  });

  it("une identité substituée ne correspond pas", () => {
    // Un intermédiaire présente à Ana une autre clé que celle de Bob.
    const intrus = { compte: BOB, identite: identitePublique(creerIdentite()) };
    expect(comparerCodeScanne(chezBob.qr, codeSecurite(ana, intrus))).toBe("different");
    // Mon propre code n'est pas celui de l'autre.
    expect(comparerCodeScanne(chezAna.qr, chezAna)).toBe("different");
  });

  it("un autre QR code est reconnu comme tel", () => {
    expect(comparerCodeScanne("https://exemple.org", chezAna)).toBe("invalide");
    expect(comparerCodeScanne("unichat-code:abc", chezAna)).toBe("invalide");
    expect(comparerCodeScanne("unichat-code:!!!", chezAna)).toBe("invalide");
  });
});
