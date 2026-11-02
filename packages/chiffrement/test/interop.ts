import type { CleSignee, CleUnique, Correspondant, IdentitePrivee, IdentitePublique, Session } from "../src";
import { depuisBase64, versBase64 } from "../src";
import type { EtatRatchet } from "../src/ratchet";
import { publiqueEchange, publiqueSignature } from "../src/primitives";

/*
 * Forme JSON partagée avec l'appli Android native (apps/android-natif) :
 * octets en base64 « URL » sans remplissage, comme sur le réseau. Les jeux
 * d'essai écrits ici sont relus en Kotlin, et ce que Kotlin chiffre est
 * relu ici : les deux implémentations doivent produire les mêmes octets.
 */

export const b64 = versBase64;

// Le paquet ne dépend pas de Node (ni ses types) : l'accès aux fichiers et à
// l'environnement, propre à ces tests d'échange, est déclaré ici seulement.
declare const process: { env: Record<string, string | undefined> };
export const variable = (nom: string): string | undefined => process.env[nom];

type Fs = { writeFileSync(chemin: string, texte: string): void; readFileSync(chemin: string, codage: "utf8"): string };
const fs = async () => (await import(/* @vite-ignore */ "node:fs" as string)) as Fs;
export const ecrireFichier = async (chemin: string, texte: string) => (await fs()).writeFileSync(chemin, texte);
export const lireFichier = async (chemin: string) => (await fs()).readFileSync(chemin, "utf8");
export const oct = depuisBase64;

export const identitePriveeJson = (i: IdentitePrivee) => ({
  signature: b64(i.signature.secrete),
  echange: b64(i.echange.secrete),
  preuve: b64(i.preuve),
});

export const identitePubliqueJson = (i: IdentitePublique) => ({
  signature: b64(i.signature),
  echange: b64(i.echange),
  preuve: b64(i.preuve),
});

export function identitePubliqueLue(j: { signature: string; echange: string; preuve: string }): IdentitePublique {
  return { signature: oct(j.signature), echange: oct(j.echange), preuve: oct(j.preuve) };
}

export const cleSigneeJson = (c: CleSignee) => ({ id: c.id, secrete: b64(c.paire.secrete), publique: b64(c.paire.publique), signature: b64(c.signature), creeeLe: c.creeeLe });
export const cleUniqueJson = (c: CleUnique) => ({ id: c.id, secrete: b64(c.paire.secrete), publique: b64(c.paire.publique) });

const ratchetJson = (r: EtatRatchet) => ({
  dhs: { secrete: b64(r.dhs.secrete), publique: b64(r.dhs.publique) },
  dhr: r.dhr && b64(r.dhr),
  rk: b64(r.rk),
  cks: r.cks && b64(r.cks),
  ckr: r.ckr && b64(r.ckr),
  ns: r.ns,
  nr: r.nr,
  pn: r.pn,
  sautees: Object.fromEntries(Object.entries(r.sautees).map(([k, v]) => [k, b64(v)])),
  ordre: r.ordre,
});

const sessionJson = (s: Session) => ({
  ratchet: ratchetJson(s.ratchet),
  ad: b64(s.ad),
  ephemere: b64(s.ephemere),
  ouverture: s.ouverture && {
    identite: identitePubliqueJson(s.ouverture.identite),
    ephemere: b64(s.ouverture.ephemere),
    cleSigneeId: s.ouverture.cleSigneeId,
    cleUniqueId: s.ouverture.cleUniqueId,
  },
  identite: identitePubliqueJson(s.identite),
});

export const correspondantJson = (c: Correspondant) => ({ sessions: c.sessions.map(sessionJson) });

type SessionJson = ReturnType<typeof sessionJson>;

const ratchetLu = (r: SessionJson["ratchet"]): EtatRatchet => ({
  dhs: { secrete: oct(r.dhs.secrete), publique: oct(r.dhs.publique) },
  dhr: r.dhr ? oct(r.dhr) : null,
  rk: oct(r.rk),
  cks: r.cks ? oct(r.cks) : null,
  ckr: r.ckr ? oct(r.ckr) : null,
  ns: r.ns,
  nr: r.nr,
  pn: r.pn,
  sautees: Object.fromEntries(Object.entries(r.sautees).map(([k, v]) => [k, oct(v)])),
  ordre: r.ordre,
});

export const correspondantLu = (j: { sessions: SessionJson[] }): Correspondant => ({
  sessions: j.sessions.map((s) => ({
    ratchet: ratchetLu(s.ratchet),
    ad: oct(s.ad),
    ephemere: oct(s.ephemere),
    ...(s.ouverture
      ? {
          ouverture: {
            identite: identitePubliqueLue(s.ouverture.identite),
            ephemere: oct(s.ouverture.ephemere),
            cleSigneeId: s.ouverture.cleSigneeId,
            cleUniqueId: s.ouverture.cleUniqueId,
          },
        }
      : {}),
    identite: identitePubliqueLue(s.identite),
  })),
});

export const identitePriveeLue = (j: { signature: string; echange: string; preuve: string }): IdentitePrivee => ({
  signature: { secrete: oct(j.signature), publique: publiqueSignature(oct(j.signature)) },
  echange: { secrete: oct(j.echange), publique: publiqueEchange(oct(j.echange)) },
  preuve: oct(j.preuve),
});

export const cleSigneeLue = (j: ReturnType<typeof cleSigneeJson>): CleSignee => ({
  id: j.id,
  paire: { secrete: oct(j.secrete), publique: oct(j.publique) },
  signature: oct(j.signature),
  creeeLe: j.creeeLe,
});

export const cleUniqueLue = (j: ReturnType<typeof cleUniqueJson>): CleUnique => ({ id: j.id, paire: { secrete: oct(j.secrete), publique: oct(j.publique) } });

