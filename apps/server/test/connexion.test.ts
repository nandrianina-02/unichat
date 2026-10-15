import { describe, expect, it } from "vitest";
import type { Moi } from "@unichat/shared";
import { cookies, identite, preparer } from "./outils";

describe("connexion Google", () => {
  it("crée le compte, ouvre une session protégée et reprend la photo Google", async () => {
    const t = await preparer();
    const depart = await t.requete("/api/auth/google");
    expect(depart.status).toBe(302);
    const google = new URL(depart.headers.get("Location")!);
    expect(google.origin).toBe("https://accounts.google.com");
    expect(google.searchParams.get("scope")).toBe("openid email profile");
    expect(google.searchParams.get("code_challenge_method")).toBe("S256");
    expect(google.searchParams.get("redirect_uri")).toBe("http://localhost/api/auth/google/rappel");
    // Le cookie d'état est strictement limité.
    const cookieEtat = depart.headers.getSetCookie().find((l) => l.startsWith("__Host-uc_oauth="))!;
    expect(cookieEtat).toMatch(/HttpOnly/i);
    expect(cookieEtat).toMatch(/Secure/i);
    expect(cookieEtat).toMatch(/SameSite=Lax/i);

    const personne = { ...identite("ana"), photo: "https://lh3.googleusercontent.com/a/abc=s96-c" };
    const { code, state } = t.google.consentir(depart.headers.get("Location")!, personne);
    const retour = await t.requete(`/api/auth/google/rappel?code=${code}&state=${state}`, {
      headers: { Cookie: `__Host-uc_oauth=${cookies(depart).get("__Host-uc_oauth")}` },
    });
    expect(retour.status).toBe(302);
    expect(retour.headers.get("Location")).toBe("/");
    const cookieSession = retour.headers.getSetCookie().find((l) => l.startsWith("__Host-uc_session="))!;
    expect(cookieSession).toMatch(/HttpOnly/i);
    expect(cookieSession).toMatch(/Secure/i);
    expect(cookieSession).toMatch(/Path=\//i);

    const jeton = cookies(retour).get("__Host-uc_session")!;
    const moi = (await (await t.requete("/api/moi", { headers: { Cookie: `__Host-uc_session=${jeton}` } })).json()) as Moi;
    expect(moi.email).toBe(personne.email);
    expect(moi.nom).toBe(personne.nom);
    expect(moi.pseudo).toBeNull();
    expect(moi.photo).toMatch(/^[0-9a-f]{16}$/);
  });

  it("refuse un retour dont l'état n'appartient pas à ce navigateur", async () => {
    const t = await preparer();
    const depart = await t.requete("/api/auth/google");
    const { code, state } = t.google.consentir(depart.headers.get("Location")!, identite("eve"));
    // Lien de retour forgé et ouvert dans un autre navigateur (sans le cookie d'état).
    const retour = await t.requete(`/api/auth/google/rappel?code=${code}&state=${state}`);
    expect(retour.headers.get("Location")).toBe("/?erreur=etat_invalide");
    expect(cookies(retour).get("__Host-uc_session")).toBeUndefined();
  });

  it("n'accepte un état qu'une seule fois", async () => {
    const t = await preparer();
    const depart = await t.requete("/api/auth/google");
    const etat = cookies(depart).get("__Host-uc_oauth")!;
    const premier = t.google.consentir(depart.headers.get("Location")!, identite("bob"));
    const ok = await t.requete(`/api/auth/google/rappel?code=${premier.code}&state=${premier.state}`, {
      headers: { Cookie: `__Host-uc_oauth=${etat}` },
    });
    expect(ok.headers.get("Location")).toBe("/");
    const rejoue = t.google.consentir(depart.headers.get("Location")!, identite("bob"));
    const ko = await t.requete(`/api/auth/google/rappel?code=${rejoue.code}&state=${rejoue.state}`, {
      headers: { Cookie: `__Host-uc_oauth=${etat}` },
    });
    expect(ko.headers.get("Location")).toBe("/?erreur=etat_invalide");
  });

  it("refuse un état expiré", async () => {
    const t = await preparer();
    const depart = await t.requete("/api/auth/google");
    const { code, state } = t.google.consentir(depart.headers.get("Location")!, identite("lea"));
    t.avancer(11 * 60 * 1000);
    t.google.reglerHorloge(t.maintenant());
    const retour = await t.requete(`/api/auth/google/rappel?code=${code}&state=${state}`, {
      headers: { Cookie: `__Host-uc_oauth=${cookies(depart).get("__Host-uc_oauth")}` },
    });
    expect(retour.headers.get("Location")).toBe("/?erreur=etat_invalide");
  });

  it("refuse un jeton dont le nonce ne correspond pas", async () => {
    const t = await preparer();
    const depart = await t.requete("/api/auth/google");
    const { code, state } = t.google.consentir(depart.headers.get("Location")!, identite("max"), { nonceForce: "autre" });
    const retour = await t.requete(`/api/auth/google/rappel?code=${code}&state=${state}`, {
      headers: { Cookie: `__Host-uc_oauth=${cookies(depart).get("__Host-uc_oauth")}` },
    });
    expect(retour.headers.get("Location")).toBe("/?erreur=google");
  });

  it("refuse une adresse Google non vérifiée", async () => {
    const t = await preparer();
    const depart = await t.requete("/api/auth/google");
    const { code, state } = t.google.consentir(depart.headers.get("Location")!, { ...identite("zoe"), emailVerifie: false });
    const retour = await t.requete(`/api/auth/google/rappel?code=${code}&state=${state}`, {
      headers: { Cookie: `__Host-uc_oauth=${cookies(depart).get("__Host-uc_oauth")}` },
    });
    expect(retour.headers.get("Location")).toBe("/?erreur=email_non_verifie");
  });

  it("retrouve le compte par l'identifiant Google, même si l'adresse a changé", async () => {
    const t = await preparer();
    const personne = identite("sam");
    const premier = await t.connecter(personne);
    const id = ((await (await premier.appel("/api/moi")).json()) as Moi).id;
    const second = await t.connecter({ ...personne, email: "nouvelle.adresse@gmail.com" });
    const moi = (await (await second.appel("/api/moi")).json()) as Moi;
    expect(moi.id).toBe(id);
    expect(moi.email).toBe("nouvelle.adresse@gmail.com");
  });

  it("signale une annulation sur la page Google", async () => {
    const t = await preparer();
    const retour = await t.requete("/api/auth/google/rappel?error=access_denied");
    expect(retour.headers.get("Location")).toBe("/?erreur=connexion_annulee");
  });

  it("limite les tentatives de connexion par adresse IP", async () => {
    const t = await preparer();
    const enTetes = { "CF-Connecting-IP": "203.0.113.9" };
    for (let i = 0; i < 20; i++) expect((await t.requete("/api/auth/google", { headers: enTetes })).status).toBe(302);
    const refusee = await t.requete("/api/auth/google", { headers: enTetes });
    expect(refusee.headers.get("Location")).toBe("/?erreur=trop_de_demandes");
  });

  it("répond 404 en JSON sur une adresse d'API inconnue, sans exiger de session", async () => {
    const t = await preparer();
    const r = await t.requete("/api/inconnue");
    expect(r.status).toBe(404);
    expect(await r.json()).toMatchObject({ erreur: "introuvable" });
  });
});
