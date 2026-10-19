import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import type { z } from "zod";
import { CONNEXION_RECENTE } from "@unichat/shared";
import { Refus, refus } from "../lib/erreurs";
import { autoriser } from "../lib/limites";
import { DUREES } from "../lib/sessions";
import type { AppEnv } from "../types";

export const COOKIE_SESSION = "uc_session";
export const COOKIE_ETAT = "uc_oauth";
export const MINUTE = 60 * 1000;

/** Cookie `__Host-` : HTTPS seulement, tout le site, aucun sous-domaine. */
export function poserCookie(c: Context<AppEnv>, nom: string, valeur: string, dureeMs: number): void {
  setCookie(c, nom, valeur, {
    prefix: "host",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: Math.floor(dureeMs / 1000),
  });
}

export function poserCookieSession(c: Context<AppEnv>, jeton: string): void {
  poserCookie(c, COOKIE_SESSION, jeton, DUREES.maximale);
}

export function effacerCookie(c: Context<AppEnv>, nom: string): void {
  poserCookie(c, nom, "", 0);
}

export function ip(c: Context<AppEnv>): string {
  return c.req.header("CF-Connecting-IP") ?? "local";
}

export function lieu(c: Context<AppEnv>): { ville: string | null; pays: string | null } {
  const cf = c.req.raw.cf as { city?: unknown; country?: unknown } | undefined;
  return {
    ville: typeof cf?.city === "string" ? cf.city : null,
    pays: typeof cf?.country === "string" ? cf.country : null,
  };
}

export async function limiter(c: Context<AppEnv>, cle: string, maximum: number, fenetreMs: number): Promise<void> {
  const r = await autoriser(c.env.DB, cle, maximum, fenetreMs, c.get("deps").maintenant());
  if (!r.ok) throw refus.tropDeDemandes(r.reessayerDans);
}

/**
 * Action lourde (supprimer un compte, refaire ses clés) : réservée à une
 * connexion Google de moins de 24 heures, pour qu'une session dérobée ne
 * suffise pas.
 */
export function exigerConnexionRecente(c: Context<AppEnv>): void {
  if (c.get("deps").maintenant() - c.get("session").cree_le > CONNEXION_RECENTE) {
    throw new Refus(403, "reconnexion_requise", "Par sécurité, reconnectez-vous avec Google avant cette action : elle demande une connexion de moins de 24 heures.");
  }
}

export async function corpsJson<S extends z.ZodType>(c: Context<AppEnv>, schema: S): Promise<z.output<S>> {
  let brut: unknown;
  try {
    brut = await c.req.json();
  } catch {
    throw refus.requete("Corps de requête invalide.");
  }
  const resultat = schema.safeParse(brut);
  if (!resultat.success) throw refus.requete(resultat.error.issues[0]?.message ?? "Requête invalide.");
  return resultat.data;
}
