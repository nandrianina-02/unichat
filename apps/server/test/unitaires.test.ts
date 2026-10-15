import { describe, expect, it } from "vitest";
import { lireRecherche, schemaPseudo } from "@unichat/shared";
import { nomAppareil } from "../src/lib/appareil";
import { photoGoogle } from "../src/lib/google";
import { typeImage } from "../src/lib/images";
import { JPEG, WEBP } from "./outils";

describe("nomAppareil", () => {
  it.each([
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", "Chrome sur Windows"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0", "Edge sur Windows"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15", "Safari sur macOS"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0", "Firefox sur Linux"],
    ["Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36", "Chrome sur Android"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile Safari/604.1", "Safari sur iOS"],
    [undefined, "Navigateur inconnu"],
  ])("%s", (ua, attendu) => expect(nomAppareil(ua)).toBe(attendu));
});

describe("typeImage", () => {
  it("se fie aux octets, pas au type annoncé", () => {
    expect(typeImage(JPEG)).toBe("image/jpeg");
    expect(typeImage(WEBP)).toBe("image/webp");
    expect(typeImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(typeImage(new TextEncoder().encode("<svg></svg>"))).toBeNull();
    expect(typeImage(new Uint8Array([0xff]))).toBeNull();
  });
});

describe("photoGoogle", () => {
  it("ne télécharge que depuis les serveurs de photos Google, à la taille voulue", () => {
    expect(photoGoogle("https://lh3.googleusercontent.com/a/ABC123=s96-c", 640)).toBe(
      "https://lh3.googleusercontent.com/a/ABC123=s640-c",
    );
    expect(photoGoogle("https://lh3.googleusercontent.com/a/ABC123", 128)).toBe("https://lh3.googleusercontent.com/a/ABC123=s128-c");
    expect(photoGoogle("https://exemple.com/a/ABC=s96-c", 640)).toBeNull();
    expect(photoGoogle("http://lh3.googleusercontent.com/a/ABC", 640)).toBeNull();
    expect(photoGoogle("pas une adresse", 640)).toBeNull();
  });
});

describe("règles partagées", () => {
  it("nom d'utilisateur", () => {
    expect(schemaPseudo.parse("  Ana.Rakoto ")).toBe("ana.rakoto");
    for (const refuse of ["ab", "9lives", "a..b", "fin.", "unichat", "avec espace", "x".repeat(31)]) {
      expect(schemaPseudo.safeParse(refuse).success, refuse).toBe(false);
    }
  });

  it("recherche : adresse e-mail ou nom d'utilisateur exact", () => {
    expect(lireRecherche("Ana@Gmail.com")).toEqual({ type: "email", valeur: "ana@gmail.com" });
    expect(lireRecherche("@ana.rakoto")).toEqual({ type: "pseudo", valeur: "ana.rakoto" });
    expect(lireRecherche("ana.rakoto")).toEqual({ type: "pseudo", valeur: "ana.rakoto" });
    expect(lireRecherche("pas@valide")).toBeNull();
    expect(lireRecherche("")).toBeNull();
  });
});
