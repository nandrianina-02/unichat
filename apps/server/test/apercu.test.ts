import { describe, expect, it } from "vitest";
import { adresseAutorisee, lireApercu } from "../src/lib/apercu";

describe("aperçu de lien", () => {
  it("lit Open Graph, puis le titre de la page à défaut", () => {
    const url = new URL("https://www.exemple.mg/article");
    const html = `<html><head>
      <meta content="Le &amp; grand titre" property="og:title">
      <meta name="description" content='Une description &#233;crite ici'>
      <title>Titre de secours</title>
    </head></html>`;
    expect(lireApercu(html, url)).toEqual({ titre: "Le & grand titre", description: "Une description écrite ici", site: "exemple.mg" });
    expect(lireApercu("<title> Seulement\n un titre </title>", url)).toEqual({ titre: "Seulement un titre", site: "exemple.mg" });
  });

  it("refuse les adresses locales, les adresses IP et les identifiants", () => {
    for (const brute of [
      "http://localhost/admin",
      "http://192.168.1.1/",
      "http://[::1]/",
      "https://imprimante.local/",
      "ftp://exemple.mg/fichier",
      "https://moi:secret@exemple.mg/",
      "pas une adresse",
    ]) {
      expect(adresseAutorisee(brute), brute).toBeNull();
    }
    expect(adresseAutorisee("https://exemple.mg/page?x=1")?.hostname).toBe("exemple.mg");
  });
});
