import { describe, expect, it } from "vitest";
import { SURCOUT_FICHIER, chiffrerOctets, dechiffrerOctets, versBase64 } from "../src";

describe("fichier chiffré", () => {
  const photo = new Uint8Array(Array.from({ length: 5000 }, (_, i) => (i * 31) % 256));

  it("aller-retour, avec le surcoût annoncé", async () => {
    const { scelle, cle } = await chiffrerOctets(photo);
    expect(scelle.length).toBe(photo.length + SURCOUT_FICHIER);
    expect([...(await dechiffrerOctets(scelle, cle))]).toEqual([...photo]);
  });

  it("deux envois du même fichier ne se ressemblent pas (clé et nonce neufs)", async () => {
    const a = await chiffrerOctets(photo);
    const b = await chiffrerOctets(photo);
    expect(versBase64(a.scelle)).not.toBe(versBase64(b.scelle));
  });

  it("refuse un fichier altéré, tronqué, ou une autre clé", async () => {
    const { scelle, cle } = await chiffrerOctets(photo);
    const altere = scelle.slice();
    altere[100]! ^= 1;
    await expect(dechiffrerOctets(altere, cle)).rejects.toThrow();
    await expect(dechiffrerOctets(scelle.slice(0, -1), cle)).rejects.toThrow();
    await expect(dechiffrerOctets(scelle, crypto.getRandomValues(new Uint8Array(32)))).rejects.toThrow();
  });
});
