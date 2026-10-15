import { describe, expect, it } from "vitest";
import type { CarteProfil, MessageServeur, Moi } from "@unichat/shared";
import { env } from "cloudflare:workers";
import { identite, preparer } from "./outils";

describe("suppression du compte", () => {
  it("exige de recopier le nom d'utilisateur", async () => {
    const t = await preparer();
    const ana = await t.connecter(identite("ana"));
    await ana.appel("/api/moi", { method: "PATCH", json: { pseudo: `ana_${crypto.randomUUID().slice(0, 6)}` } });
    const r = await ana.appel("/api/moi", { method: "DELETE", json: { confirmation: "pas-moi" } });
    expect(r.status).toBe(400);
    expect((await ana.appel("/api/moi")).status).toBe(200);
  });

  it("efface le profil, les sessions, les contacts et coupe les connexions", async () => {
    const t = await preparer();
    const personneAna = identite("ana");
    const ana = await t.connecter(personneAna);
    const telephone = await t.connecter(personneAna);
    const bob = await t.connecter(identite("bob"));
    const pseudo = `ana_${crypto.randomUUID().slice(0, 6)}`;
    const moiAna = (await (await ana.appel("/api/moi", { method: "PATCH", json: { pseudo } })).json()) as Moi;
    await bob.appel("/api/moi", { method: "PATCH", json: { pseudo: `bob_${crypto.randomUUID().slice(0, 6)}` } });
    await bob.appel("/api/contacts", { method: "POST", json: { id: moiAna.id } });

    const ws = await telephone.tempsReel();
    if (ws.refus !== null) throw new Error("refus");
    ws.envoyer({ t: "bonjour", depuis: null });
    await ws.attendre((m): m is MessageServeur => m.t === "lot");

    const r = await ana.appel("/api/moi", { method: "DELETE", json: { confirmation: pseudo.toUpperCase() } });
    expect(r.status).toBe(204);
    expect(r.headers.getSetCookie().find((l) => l.startsWith("__Host-uc_session="))).toMatch(/Max-Age=0/i);

    // Toutes les sessions tombent, y compris celle du téléphone, et sa connexion est coupée.
    expect((await ana.appel("/api/moi")).status).toBe(401);
    expect((await telephone.appel("/api/moi")).status).toBe(401);
    expect(await ws.fermeture).toBe(4001);

    // Plus de trace dans la base ni dans la liste de Bob.
    const { contacts } = (await (await bob.appel("/api/contacts")).json()) as { contacts: CarteProfil[] };
    expect(contacts).toEqual([]);
    for (const table of ["utilisateurs", "sessions", "photos", "evenements_securite"]) {
      const colonne = table === "utilisateurs" ? "id" : "utilisateur_id";
      const reste = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${colonne} = ?1`).bind(moiAna.id).first<{ n: number }>();
      expect(reste?.n, table).toBe(0);
    }

    // Une nouvelle connexion Google crée un compte neuf, sans rien de l'ancien.
    const retour = await t.connecter(personneAna);
    const neuf = (await (await retour.appel("/api/moi")).json()) as Moi;
    expect(neuf.id).not.toBe(moiAna.id);
    expect(neuf.pseudo).toBeNull();
  });
});
