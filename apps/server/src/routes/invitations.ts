import { Hono, type Context } from "hono";
import { LIMITES_GROUPE, schemaCodeInvitation, type ApercuInvitation } from "@unichat/shared";
import { refus } from "../lib/erreurs";
import { annoncer, groupePour, membresDe } from "../lib/groupes";
import type { AppEnv } from "../types";
import { exigerSession } from "./garde";
import { MINUTE, limiter } from "./outils";

export const invitations = new Hono<AppEnv>();
invitations.use("*", exigerSession);

interface LigneGroupe {
  id: string;
  nom: string;
  description: string;
  photo_version: string | null;
}

/** Le groupe d'un lien. Les essais sont limités : un code ne se devine pas, on ne laisse pas essayer. */
async function groupeDuLien(c: Context<AppEnv>): Promise<LigneGroupe> {
  const moi = c.get("session").utilisateur_id;
  await limiter(c, `invitation:${moi}`, 60, 60 * MINUTE);
  const code = schemaCodeInvitation.safeParse(c.req.param("code"));
  if (!code.success) throw refus.introuvable("Ce lien d'invitation n'est plus valable.");
  const groupe = await c.env.DB.prepare("SELECT id, nom, description, photo_version FROM groupes WHERE invitation = ?1")
    .bind(code.data)
    .first<LigneGroupe>();
  if (!groupe) throw refus.introuvable("Ce lien d'invitation n'est plus valable.");
  return groupe;
}

/** Aperçu avant de rejoindre : nom, description, nombre de membres, comme WhatsApp. */
invitations.get("/:code", async (c) => {
  const groupe = await groupeDuLien(c);
  const membres = await membresDe(c.env.DB, groupe.id);
  const apercu: ApercuInvitation = {
    id: groupe.id,
    nom: groupe.nom,
    description: groupe.description,
    membres: membres.length,
    photo: groupe.photo_version,
    dejaMembre: membres.some((m) => m.id === c.get("session").utilisateur_id),
  };
  return c.json(apercu);
});

invitations.post("/:code", async (c) => {
  const groupe = await groupeDuLien(c);
  const moi = c.get("session").utilisateur_id;
  const membres = await membresDe(c.env.DB, groupe.id);
  if (!membres.some((m) => m.id === moi)) {
    if (membres.length >= LIMITES_GROUPE.membres) throw refus.conflit(`Ce groupe est complet (${LIMITES_GROUPE.membres} membres).`);
    const maintenant = c.get("deps").maintenant();
    await c.env.DB.prepare("INSERT OR IGNORE INTO membres (groupe_id, utilisateur_id, role, ajoute_le) VALUES (?1, ?2, 'membre', ?3)")
      .bind(groupe.id, moi, maintenant)
      .run();
    await annoncer(c.env, [...membres.map((m) => m.id), moi], { groupeId: groupe.id, action: "lien", par: moi, cibles: [moi], le: maintenant });
  }
  return c.json(await groupePour(c.env.DB, groupe.id, moi));
});
