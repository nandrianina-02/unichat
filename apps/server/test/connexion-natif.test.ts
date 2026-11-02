import { describe, expect, it } from "vitest";
import type { Moi, NonceNatif, SessionNatif } from "@unichat/shared";
import { identite, preparer } from "./outils";

const JSON_ = { "Content-Type": "application/json" };

async function demanderNonce(t: Awaited<ReturnType<typeof preparer>>) {
  const r = await t.requete("/api/auth/natif/nonce", { method: "POST" });
  expect(r.status).toBe(200);
  return (await r.json()) as NonceNatif;
}

describe("connexion de l'application Android native", () => {
  it("échange un jeton Google contre une session présentée en Bearer", async () => {
    const t = await preparer();
    t.google.reglerHorloge(t.maintenant());
    const { etat, nonce } = await demanderNonce(t);
    const personne = identite("ana");
    const jeton = await t.google.jetonDirect(personne, nonce);

    const r = await t.requete("/api/auth/natif", {
      method: "POST",
      headers: JSON_,
      body: JSON.stringify({ etat, jeton, appareil: "Samsung SM-A155F" }),
    });
    expect(r.status).toBe(200);
    // Aucun cookie : l'application garde son jeton elle-même.
    expect(r.headers.getSetCookie()).toHaveLength(0);
    const session = (await r.json()) as SessionNatif;

    const moi = await t.requete("/api/moi", { headers: { Authorization: `Bearer ${session.jeton}` } });
    expect(moi.status).toBe(200);
    expect(((await moi.json()) as Moi).email).toBe(personne.email);

    const liste = (await (await t.requete("/api/sessions", { headers: { Authorization: `Bearer ${session.jeton}` } })).json()) as {
      appareils: { plateforme: string; appareil: string; actuel: boolean }[];
    };
    expect(liste.appareils).toContainEqual(expect.objectContaining({ plateforme: "android", appareil: "Samsung SM-A155F", actuel: true }));
  });

  it("n'accepte un état qu'une fois", async () => {
    const t = await preparer();
    t.google.reglerHorloge(t.maintenant());
    const { etat, nonce } = await demanderNonce(t);
    const jeton = await t.google.jetonDirect(identite("bob"), nonce);
    const corps = JSON.stringify({ etat, jeton, appareil: "Pixel 8" });
    expect((await t.requete("/api/auth/natif", { method: "POST", headers: JSON_, body: corps })).status).toBe(200);
    const rejoue = await t.requete("/api/auth/natif", { method: "POST", headers: JSON_, body: corps });
    expect(rejoue.status).toBe(400);
    expect(((await rejoue.json()) as { erreur: string }).erreur).toBe("etat_invalide");
  });

  it("refuse un jeton émis pour un autre nonce", async () => {
    const t = await preparer();
    t.google.reglerHorloge(t.maintenant());
    const { etat } = await demanderNonce(t);
    const jeton = await t.google.jetonDirect(identite("eve"), "nonce-d-une-autre-demande");
    const r = await t.requete("/api/auth/natif", { method: "POST", headers: JSON_, body: JSON.stringify({ etat, jeton, appareil: "Pixel 8" }) });
    expect(r.status).toBe(401);
    expect(((await r.json()) as { erreur: string }).erreur).toBe("google");
  });

  it("refuse un état expiré", async () => {
    const t = await preparer();
    t.google.reglerHorloge(t.maintenant());
    const { etat, nonce } = await demanderNonce(t);
    const jeton = await t.google.jetonDirect(identite("lea"), nonce);
    t.avancer(11 * 60 * 1000);
    const r = await t.requete("/api/auth/natif", { method: "POST", headers: JSON_, body: JSON.stringify({ etat, jeton, appareil: "Pixel 8" }) });
    expect(r.status).toBe(400);
  });

  it("refuse une adresse Google non vérifiée", async () => {
    const t = await preparer();
    t.google.reglerHorloge(t.maintenant());
    const { etat, nonce } = await demanderNonce(t);
    const jeton = await t.google.jetonDirect({ ...identite("max"), emailVerifie: false }, nonce);
    const r = await t.requete("/api/auth/natif", { method: "POST", headers: JSON_, body: JSON.stringify({ etat, jeton, appareil: "Pixel 8" }) });
    expect(r.status).toBe(401);
    expect(((await r.json()) as { erreur: string }).erreur).toBe("email_non_verifie");
  });

  it("refuse un état délivré au site web", async () => {
    const t = await preparer();
    t.google.reglerHorloge(t.maintenant());
    // L'état du parcours web est dans un cookie ; on le rejoue ici avec un jeton forgé pour son nonce.
    const depart = await t.requete("/api/auth/google");
    const urlGoogle = new URL(depart.headers.get("Location")!);
    const etatWeb = urlGoogle.searchParams.get("state")!;
    const jeton = await t.google.jetonDirect(identite("zoe"), urlGoogle.searchParams.get("nonce")!);
    const r = await t.requete("/api/auth/natif", { method: "POST", headers: JSON_, body: JSON.stringify({ etat: etatWeb, jeton, appareil: "Pixel 8" }) });
    expect(r.status).toBe(400);
  });
});
