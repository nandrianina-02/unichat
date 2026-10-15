import { describe, expect, it } from "vitest";
import type { AppareilConnecte, EvenementSecurite } from "@unichat/shared";
import { HEURE, JOUR, identite, preparer } from "./outils";

describe("sessions", () => {
  it("refuse une modification venue d'une autre origine (CSRF)", async () => {
    const t = await preparer();
    const appareil = await t.connecter(identite("csrf"));
    const sansOrigine = await t.requete("/api/moi", {
      method: "PATCH",
      headers: { Cookie: `__Host-uc_session=${appareil.jeton}`, "Content-Type": "application/json" },
      body: JSON.stringify({ infos: "piégé" }),
    });
    expect(sansOrigine.status).toBe(403);
    const autreSite = await appareil.appel("/api/moi", {
      method: "PATCH",
      headers: { Origin: "https://site-malveillant.example" },
      json: { infos: "piégé" },
    });
    expect(autreSite.status).toBe(403);
    const legitime = await appareil.appel("/api/moi", { method: "PATCH", json: { infos: "Au travail" } });
    expect(legitime.status).toBe(200);
  });

  it("accepte le jeton en en-tête Authorization sans vérifier l'origine (applications)", async () => {
    const t = await preparer();
    const appareil = await t.connecter(identite("android"));
    const r = await t.requete("/api/moi", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${appareil.jeton}`, "Content-Type": "application/json" },
      body: JSON.stringify({ infos: "Depuis Android" }),
    });
    expect(r.status).toBe(200);
  });

  it("renouvelle le jeton et ferme la session si l'ancien revient après le délai de grâce", async () => {
    const t = await preparer();
    const personne = identite("vol");
    const appareil = await t.connecter(personne);
    const ancien = appareil.jeton;

    t.avancer(13 * HEURE);
    expect((await appareil.appel("/api/moi")).status).toBe(200);
    expect(appareil.jeton).not.toBe(ancien);

    // Requête partie avec l'ancien jeton juste avant le renouvellement : acceptée.
    const concurrente = await t.requete("/api/moi", { headers: { Cookie: `__Host-uc_session=${ancien}` } });
    expect(concurrente.status).toBe(200);

    // L'ancien jeton revient plus tard : quelqu'un d'autre le détient.
    t.avancer(2 * 60 * 1000);
    const voleur = await t.requete("/api/moi", { headers: { Cookie: `__Host-uc_session=${ancien}` } });
    expect(voleur.status).toBe(401);
    expect(await voleur.json()).toMatchObject({ erreur: "session_compromise" });
    // La session est fermée pour tout le monde, y compris le jeton récent.
    expect((await appareil.appel("/api/moi")).status).toBe(401);

    const autre = await t.connecter(personne);
    const { evenements } = (await (await autre.appel("/api/securite/evenements")).json()) as { evenements: EvenementSecurite[] };
    expect(evenements.some((e) => e.type === "reutilisation_jeton")).toBe(true);
  });

  it("ferme une session inactive depuis plus de 30 jours", async () => {
    const t = await preparer();
    const appareil = await t.connecter(identite("dormeur"));
    t.avancer(31 * JOUR);
    expect((await appareil.appel("/api/moi")).status).toBe(401);
  });

  it("liste les appareils, signale une nouvelle connexion et déconnecte à distance", async () => {
    const t = await preparer();
    const personne = identite("multi");
    const ordinateur = await t.connecter(personne, "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36");
    t.avancer(60 * 1000);
    const telephone = await t.connecter(personne, "Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36");

    const { appareils } = (await (await ordinateur.appel("/api/sessions")).json()) as { appareils: AppareilConnecte[] };
    expect(appareils.map((a) => a.appareil).sort()).toEqual(["Chrome sur Android", "Chrome sur Windows"]);
    expect(appareils.find((a) => a.actuel)?.appareil).toBe("Chrome sur Windows");

    // L'ordinateur est prévenu de la connexion du téléphone, pas l'inverse.
    const alertesOrdi = (await (await ordinateur.appel("/api/securite/alertes")).json()) as { alertes: EvenementSecurite[] };
    expect(alertesOrdi.alertes).toHaveLength(1);
    expect(alertesOrdi.alertes[0]).toMatchObject({ appareil: "Chrome sur Android", sessionActive: true });
    const alertesTel = (await (await telephone.appel("/api/securite/alertes")).json()) as { alertes: EvenementSecurite[] };
    expect(alertesTel.alertes).toHaveLength(0);

    expect((await ordinateur.appel("/api/securite/alertes/vues", { method: "POST" })).status).toBe(204);
    const apres = (await (await ordinateur.appel("/api/securite/alertes")).json()) as { alertes: EvenementSecurite[] };
    expect(apres.alertes).toHaveLength(0);

    const idTelephone = appareils.find((a) => !a.actuel)!.id;
    expect((await ordinateur.appel(`/api/sessions/${idTelephone}`, { method: "DELETE" })).status).toBe(204);
    expect((await telephone.appel("/api/moi")).status).toBe(401);
    expect((await ordinateur.appel("/api/moi")).status).toBe(200);
  });

  it("déconnecte tous les autres appareils d'un coup", async () => {
    const t = await preparer();
    const personne = identite("tous");
    const a = await t.connecter(personne);
    const b = await t.connecter(personne);
    const c = await t.connecter(personne);
    const r = await a.appel("/api/sessions/deconnecter-autres", { method: "POST" });
    expect(await r.json()).toEqual({ nombre: 2 });
    expect((await b.appel("/api/moi")).status).toBe(401);
    expect((await c.appel("/api/moi")).status).toBe(401);
    expect((await a.appel("/api/moi")).status).toBe(200);
  });

  it("déconnexion : la session est fermée et le cookie effacé", async () => {
    const t = await preparer();
    const appareil = await t.connecter(identite("sortie"));
    const jeton = appareil.jeton;
    const r = await appareil.appel("/api/auth/deconnexion", { method: "POST" });
    expect(r.status).toBe(204);
    expect(r.headers.getSetCookie().find((l) => l.startsWith("__Host-uc_session="))).toMatch(/Max-Age=0/i);
    const apres = await t.requete("/api/moi", { headers: { Cookie: `__Host-uc_session=${jeton}` } });
    expect(apres.status).toBe(401);
  });
});
