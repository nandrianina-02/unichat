import { describe, expect, it } from "vitest";
import type { FicheAdmin, Moi, SignalementAdmin, TableauAdmin, UtilisateurAdmin, ActionAdmin, CarteProfil } from "@unichat/shared";
import { HEURE, identite, preparer } from "./outils";

type Contexte = Awaited<ReturnType<typeof preparer>>;

async function personne(t: Contexte, prefixe: string) {
  const fausse = identite(prefixe);
  const appareil = await t.connecter(fausse);
  const pseudo = `${prefixe}_${crypto.randomUUID().slice(0, 8)}`;
  const moi = (await (await appareil.appel("/api/moi", { method: "PATCH", json: { pseudo } })).json()) as Moi;
  return { appareil, id: moi.id, pseudo, fausse };
}

/** Une équipe : une administratrice, et des comptes ordinaires. */
async function equipe() {
  const t = await preparer();
  const admin = await personne(t, "admin");
  const bob = await personne(t, "bob");
  const carl = await personne(t, "carl");
  t.environnement.ADMINS = `autre-id, ${admin.id.toUpperCase()}`;
  return { t, admin, bob, carl };
}

const json = async <T>(r: Response): Promise<T> => (await r.json()) as T;

async function signaler(de: { appareil: { appel: (c: string, i?: RequestInit & { json?: unknown }) => Promise<Response> } }, corps: unknown) {
  const r = await de.appareil.appel("/api/signalements", { method: "POST", json: corps });
  expect(r.status).toBe(201);
}

describe("administration", () => {
  it("un compte ordinaire ne voit pas l'espace, l'administratrice oui", async () => {
    const { admin, bob } = await equipe();
    expect((await bob.appareil.appel("/api/admin/tableau")).status).toBe(404);
    expect((await json<Moi>(await bob.appareil.appel("/api/moi"))).admin).toBe(false);
    expect((await json<Moi>(await admin.appareil.appel("/api/moi"))).admin).toBe(true);
    const tableau = await json<TableauAdmin>(await admin.appareil.appel("/api/admin/tableau"));
    expect(tableau.comptes).toBeGreaterThanOrEqual(3);
    expect(tableau.inscriptions).toHaveLength(14);
    expect(tableau.octetsBase).toBeGreaterThan(0);
  });

  it("recherche de comptes par nom d'utilisateur", async () => {
    const { admin, carl } = await equipe();
    const r = await json<{ utilisateurs: UtilisateurAdmin[] }>(await admin.appareil.appel(`/api/admin/utilisateurs?q=${carl.pseudo}`));
    expect(r.utilisateurs.map((u) => u.id)).toEqual([carl.id]);
    const fiche = await json<FicheAdmin>(await admin.appareil.appel(`/api/admin/utilisateurs/${carl.id}`));
    expect(fiche.sessions).toHaveLength(1);
    // Un « % » saisi ne devient pas un joker.
    const joker = await json<{ utilisateurs: UtilisateurAdmin[] }>(await admin.appareil.appel("/api/admin/utilisateurs?q=%25"));
    expect(joker.utilisateurs).toEqual([]);
  });

  it("signalement suivi d'une suspension : plus de connexion, plus de recherche, journal tenu", async () => {
    const { t, admin, bob, carl } = await equipe();
    const message = { id: crypto.randomUUID(), de: carl.id, texte: "message abusif", le: Date.now() };
    await signaler(bob, { type: "personne", cible: carl.id, messages: [message] });
    await signaler(bob, { type: "personne", cible: carl.id, messages: [] });

    const { signalements } = await json<{ signalements: SignalementAdmin[] }>(await admin.appareil.appel("/api/admin/signalements"));
    const premier = signalements.find((s) => s.messages.length === 1)!;
    expect(premier.messages[0]!.texte).toBe("message abusif");
    expect(premier.auteurs[carl.id]).toContain("carl");
    expect(premier.surLaCible).toBe(2);

    const sansMotif = await admin.appareil.appel(`/api/admin/signalements/${premier.id}/decision`, { method: "POST", json: { decision: "suspendu" } });
    expect(sansMotif.status).toBe(400);
    const r = await admin.appareil.appel(`/api/admin/signalements/${premier.id}/decision`, {
      method: "POST",
      json: { decision: "suspendu", motif: "Harcèlement" },
    });
    expect(r.status).toBe(204);

    // Les deux signalements sur Carl sont traités d'un coup.
    const restants = await json<{ signalements: SignalementAdmin[] }>(await admin.appareil.appel("/api/admin/signalements"));
    expect(restants.signalements.filter((s) => s.cible.id === carl.id)).toEqual([]);
    const traites = await json<{ signalements: SignalementAdmin[] }>(await admin.appareil.appel("/api/admin/signalements?etat=traites"));
    expect(traites.signalements.filter((s) => s.cible.id === carl.id).map((s) => s.decision)).toEqual(["suspendu", "suspendu"]);

    // Carl est déconnecté et ne peut pas revenir.
    expect((await carl.appareil.appel("/api/moi")).status).toBe(401);
    await expect(t.connecter(carl.fausse)).rejects.toThrow(/compte_suspendu/);
    const recherche = await json<{ resultats: CarteProfil[] }>(await bob.appareil.appel(`/api/recherche?q=${carl.pseudo}`));
    expect(recherche.resultats).toEqual([]);

    const fiche = await json<FicheAdmin>(await admin.appareil.appel(`/api/admin/utilisateurs/${carl.id}`));
    expect(fiche.suspenduLe).not.toBeNull();
    expect(fiche.motifSuspension).toBe("Harcèlement");
    expect(fiche.sessions).toEqual([]);

    // Suspension levée : Carl revient.
    expect((await admin.appareil.appel(`/api/admin/utilisateurs/${carl.id}/suspension`, { method: "DELETE" })).status).toBe(200);
    await expect(t.connecter(carl.fausse)).resolves.toBeDefined();

    const { actions } = await json<{ actions: ActionAdmin[] }>(await admin.appareil.appel("/api/admin/journal"));
    expect(actions.map((a) => a.action).slice(0, 2)).toEqual(["suspension_levee", "suspension"]);
    expect(actions[1]!.detail).toBe("Harcèlement");
  });

  it("ni sur soi-même ni sur une autre administratrice", async () => {
    const { t, admin, bob } = await equipe();
    t.environnement.ADMINS = `${admin.id},${bob.id}`;
    const surSoi = await admin.appareil.appel(`/api/admin/utilisateurs/${admin.id}/suspension`, { method: "POST", json: { motif: "essai" } });
    expect(surSoi.status).toBe(403);
    const surAutre = await admin.appareil.appel(`/api/admin/utilisateurs/${bob.id}/deconnexion`, { method: "POST" });
    expect(surAutre.status).toBe(403);
  });

  it("supprimer un compte demande une connexion récente et la recopie du nom d'utilisateur", async () => {
    const { t, admin, carl } = await equipe();
    t.avancer(25 * HEURE);
    const ancienne = await admin.appareil.appel(`/api/admin/utilisateurs/${carl.id}`, { method: "DELETE", json: { confirmation: carl.pseudo } });
    expect(ancienne.status).toBe(403);
    expect((await json<{ erreur: string }>(ancienne)).erreur).toBe("reconnexion_requise");

    const recente = await t.connecter(admin.fausse);
    expect((await recente.appel(`/api/admin/utilisateurs/${carl.id}`, { method: "DELETE", json: { confirmation: "autre" } })).status).toBe(400);
    expect((await recente.appel(`/api/admin/utilisateurs/${carl.id}`, { method: "DELETE", json: { confirmation: carl.pseudo } })).status).toBe(204);
    expect((await recente.appel(`/api/admin/utilisateurs/${carl.id}`)).status).toBe(404);
    const { actions } = await json<{ actions: ActionAdmin[] }>(await recente.appel("/api/admin/journal"));
    expect(actions[0]).toMatchObject({ action: "suppression_compte", cibleId: carl.id });
  });

  it("groupe signalé puis fermé : ses membres le perdent", async () => {
    const { admin, bob, carl } = await equipe();
    await bob.appareil.appel("/api/contacts", { method: "POST", json: { id: carl.id } });
    const groupe = await json<{ id: string }>(await bob.appareil.appel("/api/groupes", { method: "POST", json: { nom: "Club", membres: [carl.id] } }));
    await signaler(carl, { type: "groupe", cible: groupe.id, messages: [] });
    const { signalements } = await json<{ signalements: SignalementAdmin[] }>(await admin.appareil.appel("/api/admin/signalements"));
    const s = signalements.find((x) => x.cible.id === groupe.id)!;
    expect(s.cible.membres).toBe(2);

    const r = await admin.appareil.appel(`/api/admin/signalements/${s.id}/decision`, {
      method: "POST",
      json: { decision: "groupe_ferme", motif: "Contenu illicite" },
    });
    expect(r.status).toBe(204);
    expect((await bob.appareil.appel(`/api/groupes/${groupe.id}`)).status).toBe(404);
  });
});
