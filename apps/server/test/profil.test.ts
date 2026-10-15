import { describe, expect, it } from "vitest";
import type { CarteProfil, Moi } from "@unichat/shared";
import { JPEG, WEBP, identite, preparer } from "./outils";

async function json<T>(r: Response): Promise<T> {
  return (await r.json()) as T;
}

function formulairePhoto(grande: Uint8Array, petite: Uint8Array): FormData {
  const f = new FormData();
  f.append("grande", new File([grande], "grande"));
  f.append("petite", new File([petite], "petite"));
  return f;
}

describe("profil", () => {
  it("termine l'accueil avec un nom d'utilisateur unique", async () => {
    const t = await preparer();
    const ana = await t.connecter(identite("ana"));
    const bob = await t.connecter(identite("bob"));

    const dispo = await json<{ disponible: boolean }>(await ana.appel("/api/moi/pseudo-disponible?p=Ana.Rakoto"));
    expect(dispo.disponible).toBe(true);
    const moi = await json<Moi>(await ana.appel("/api/moi", { method: "PATCH", json: { nom: "Ana", pseudo: "Ana.Rakoto" } }));
    expect(moi.pseudo).toBe("ana.rakoto");

    const pris = await json<{ disponible: boolean; message: string }>(await bob.appel("/api/moi/pseudo-disponible?p=ana.rakoto"));
    expect(pris).toEqual({ disponible: false, message: "Ce nom d'utilisateur est déjà pris." });
    const conflit = await bob.appel("/api/moi", { method: "PATCH", json: { pseudo: "ana.rakoto" } });
    expect(conflit.status).toBe(409);
  });

  it("valide les champs avec les mêmes règles que l'interface", async () => {
    const t = await preparer();
    const a = await t.connecter(identite("regles"));
    for (const corps of [
      { pseudo: "admin" },
      { pseudo: "ab" },
      { pseudo: "1commence" },
      { pseudo: "fin." },
      { nom: "" },
      { nom: "x".repeat(26) },
      { infos: "x".repeat(140) },
      { visibilitePhoto: "amis" },
      { champInconnu: true },
    ]) {
      const r = await a.appel("/api/moi", { method: "PATCH", json: corps });
      expect(r.status, JSON.stringify(corps)).toBe(400);
    }
  });

  it("accepte une photo valide et refuse un faux fichier image", async () => {
    const t = await preparer();
    const a = await t.connecter(identite("photo"));
    const faux = new TextEncoder().encode("<svg onload=alert(1)>");
    const refusee = await a.appel("/api/moi/photo", { method: "PUT", body: formulairePhoto(faux, faux) });
    expect(refusee.status).toBe(400);
    const acceptee = await json<Moi>(await a.appel("/api/moi/photo", { method: "PUT", body: formulairePhoto(WEBP, WEBP) }));
    expect(acceptee.photo).toMatch(/^[0-9a-f]{16}$/);
    const image = await a.appel(`/api/personnes/${acceptee.id}/photo?taille=grande&v=${acceptee.photo}`);
    expect(image.headers.get("Content-Type")).toBe("image/webp");
    expect(image.headers.get("Cache-Control")).toContain("immutable");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(WEBP);
    const supprimee = await json<Moi>(await a.appel("/api/moi/photo", { method: "DELETE" }));
    expect(supprimee.photo).toBeNull();
  });

  it("refuse une photo trop lourde avant de la lire", async () => {
    const t = await preparer();
    const a = await t.connecter(identite("lourd"));
    const enorme = new Uint8Array(400 * 1024);
    enorme.set(JPEG);
    const r = await a.appel("/api/moi/photo", { method: "PUT", body: formulairePhoto(enorme, JPEG) });
    expect(r.status).toBe(400);
  });
});

describe("contacts et confidentialité", () => {
  async function deuxPersonnes() {
    const t = await preparer();
    const ana = await t.connecter(identite("ana"));
    const bob = await t.connecter(identite("bob"));
    const suffixe = crypto.randomUUID().slice(0, 6);
    const moiAna = await json<Moi>(await ana.appel("/api/moi", { method: "PATCH", json: { pseudo: `ana_${suffixe}` } }));
    const moiBob = await json<Moi>(await bob.appel("/api/moi", { method: "PATCH", json: { pseudo: `bob_${suffixe}`, infos: "Infos de Bob" } }));
    return { t, ana, bob, moiAna, moiBob };
  }

  it("trouve une personne par son nom d'utilisateur exact, jamais par un fragment", async () => {
    const { ana, moiBob } = await deuxPersonnes();
    const exact = await json<{ resultats: CarteProfil[] }>(await ana.appel(`/api/recherche?q=@${moiBob.pseudo}`));
    expect(exact.resultats).toHaveLength(1);
    expect(exact.resultats[0]).toMatchObject({ id: moiBob.id, infos: "Infos de Bob", estContact: false });
    const fragment = await json<{ resultats: CarteProfil[] }>(await ana.appel(`/api/recherche?q=${moiBob.pseudo!.slice(0, 4)}`));
    expect(fragment.resultats).toHaveLength(0);
  });

  it("respecte le refus d'être trouvé par adresse e-mail", async () => {
    const { ana, bob, moiBob } = await deuxPersonnes();
    const parEmail = async () =>
      (await json<{ resultats: CarteProfil[] }>(await ana.appel(`/api/recherche?q=${encodeURIComponent(moiBob.email)}`))).resultats;
    expect(await parEmail()).toHaveLength(1);
    await bob.appel("/api/moi", { method: "PATCH", json: { trouvableParEmail: false } });
    expect(await parEmail()).toHaveLength(0);
  });

  it("« mes contacts » : photo et infos visibles seulement par les contacts de la personne", async () => {
    const { ana, bob, moiAna, moiBob } = await deuxPersonnes();
    await bob.appel("/api/moi/photo", { method: "PUT", body: formulairePhoto(JPEG, JPEG) });
    await bob.appel("/api/moi", { method: "PATCH", json: { visibilitePhoto: "contacts", visibiliteInfos: "contacts" } });

    // Ana ajoute Bob : cela ne lui donne pas accès, c'est Bob qui décide.
    const ajout = await ana.appel("/api/contacts", { method: "POST", json: { id: moiBob.id } });
    expect(ajout.status).toBe(201);
    let vue = await json<CarteProfil>(await ana.appel(`/api/personnes/${moiBob.id}`));
    expect(vue).toMatchObject({ estContact: true, photo: null, infos: null });
    expect((await ana.appel(`/api/personnes/${moiBob.id}/photo`)).status).toBe(404);

    // Bob ajoute Ana : elle voit désormais sa photo et ses infos.
    await bob.appel("/api/contacts", { method: "POST", json: { id: moiAna.id } });
    vue = await json<CarteProfil>(await ana.appel(`/api/personnes/${moiBob.id}`));
    expect(vue.infos).toBe("Infos de Bob");
    expect(vue.photo).not.toBeNull();
    expect((await ana.appel(`/api/personnes/${moiBob.id}/photo`)).status).toBe(200);

    const { contacts } = await json<{ contacts: CarteProfil[] }>(await ana.appel("/api/contacts"));
    expect(contacts.map((c) => c.id)).toEqual([moiBob.id]);
    expect((await ana.appel(`/api/contacts/${moiBob.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await json<{ contacts: CarteProfil[] }>(await ana.appel("/api/contacts"))).contacts).toHaveLength(0);
  });

  it("refuse de s'ajouter soi-même ou d'ajouter un identifiant inconnu", async () => {
    const { ana, moiAna } = await deuxPersonnes();
    expect((await ana.appel("/api/contacts", { method: "POST", json: { id: moiAna.id } })).status).toBe(400);
    expect((await ana.appel("/api/contacts", { method: "POST", json: { id: crypto.randomUUID() } })).status).toBe(404);
    expect((await ana.appel("/api/contacts", { method: "POST", json: { id: "pas-un-uuid" } })).status).toBe(400);
  });

  it("limite les recherches pour empêcher de parcourir l'annuaire", async () => {
    const { ana } = await deuxPersonnes();
    for (let i = 0; i < 30; i++) expect((await ana.appel(`/api/recherche?q=@personne${i}`)).status).toBe(200);
    const refusee = await ana.appel("/api/recherche?q=@personne31");
    expect(refusee.status).toBe(429);
    expect(await refusee.json()).toMatchObject({ erreur: "trop_de_demandes" });
  });
});
