import { z } from "zod";

/*
 * Numéro de téléphone du profil, vérifié par un code SMS envoyé par Mess.
 * Mess n'envoie qu'aux mobiles malgaches : seuls ceux-là sont acceptés,
 * ramenés à la forme internationale +261 3X XX XXX XX (mêmes règles que
 * mess/packages/shared/src/numeros.ts).
 */

/** 032 et 037 Orange, 033 Airtel, 034 et 038 Yas, 039. */
const PREFIXES = new Set(["32", "33", "34", "37", "38", "39"]);

/** « 034 12 345 67 », « +261 34 12 345 67 »… deviennent « +261341234567 » ; null sinon. */
export function normaliserTelephone(brut: string): string | null {
  const chiffres = brut.replace(/[\s.\-()]/g, "");
  let local: string;
  if (/^\+261\d{9}$/.test(chiffres)) local = chiffres.slice(4);
  else if (/^00261\d{9}$/.test(chiffres)) local = chiffres.slice(5);
  else if (/^261\d{9}$/.test(chiffres)) local = chiffres.slice(3);
  else if (/^0\d{9}$/.test(chiffres)) local = chiffres.slice(1);
  else return null;
  return PREFIXES.has(local.slice(0, 2)) ? `+261${local}` : null;
}

/** « 034 12 345 67 », la forme qu'on écrit à Madagascar. */
export function afficherTelephone(numero: string): string {
  const l = numero.slice(4);
  return `0${l.slice(0, 2)} ${l.slice(2, 4)} ${l.slice(4, 7)} ${l.slice(7)}`;
}

export const MESSAGE_TELEPHONE = "Un mobile malgache : 032, 033, 034, 037, 038 ou 039.";

export const schemaAjoutTelephone = z
  .object({
    numero: z.string().max(30).transform((v, ctx) => {
      const n = normaliserTelephone(v);
      if (!n) ctx.addIssue({ code: "custom", message: MESSAGE_TELEPHONE });
      return n ?? "";
    }),
  })
  .strict();

export const schemaCodeTelephone = z.object({ code: z.string().regex(/^\d{4,8}$/, "Le code reçu par SMS compte 6 chiffres.") }).strict();

/** La vérification en cours : le numéro attend la saisie du code reçu. */
export interface VerificationTelephone {
  numero: string;
  expireLe: number;
}
