import { verifierIdentite, type IdentitePrivee } from "./identite";
import { assembler, depuisBase64, egaux, octetsVersTexte, texteVersOctets, versBase64 } from "./octets";
import { TAILLE_CLE, aleatoire, authentifier, deriver, echanger, ouvrir, paireEchange, publiqueEchange, publiqueSignature, sceller, type Paire } from "./primitives";

/**
 * Liaison d'un appareil : l'identité du compte passe d'un appareil déjà
 * relié (le « donneur ») à un nouveau (le « receveur »), par le serveur,
 * sans que celui-ci puisse la lire ni s'interposer.
 *
 * L'un des deux affiche un QR code : canal du serveur, clé éphémère X25519
 * et secret de 128 bits. Le serveur ne voit jamais ce code. L'autre le lit,
 * répond avec sa propre clé éphémère et une preuve (HMAC sous le secret) :
 * seul un appareil qui a vu l'écran peut la produire. Les deux tirent alors
 * une clé commune de l'échange X25519, salée par le secret, et le donneur
 * scelle l'identité sous cette clé.
 */

export type RoleLiaison = "donneur" | "receveur";

export interface CodeLiaison {
  canal: string;
  /** Clé éphémère de l'appareil qui affiche le code. */
  cle: Uint8Array;
  secret: Uint8Array;
  /** Rôle de l'appareil qui affiche le code. */
  role: RoleLiaison;
}

const VERSION = "UC1";
const TAILLE_SECRET = 16;
const MOTIF_CANAL = /^[A-Za-z0-9_-]{22,64}$/;

export function encoderCode(c: CodeLiaison): string {
  return [VERSION, c.canal, versBase64(c.cle), versBase64(c.secret), c.role === "donneur" ? "d" : "r"].join(".");
}

/** Lit un code scanné ou collé ; null s'il ne vient pas d'UniChat. */
export function lireCode(texte: string): CodeLiaison | null {
  const parties = texte.trim().split(".");
  if (parties.length !== 5 || parties[0] !== VERSION || !MOTIF_CANAL.test(parties[1]!) || !["d", "r"].includes(parties[4]!)) return null;
  try {
    const cle = depuisBase64(parties[2]!);
    const secret = depuisBase64(parties[3]!);
    if (cle.length !== TAILLE_CLE || secret.length !== TAILLE_SECRET) return null;
    return { canal: parties[1]!, cle, secret, role: parties[4] === "d" ? "donneur" : "receveur" };
  } catch {
    return null;
  }
}

/** L'appareil qui affiche : une paire éphémère et un secret, tirés pour cette liaison seulement. */
export function preparerCode(canal: string, role: RoleLiaison): { code: CodeLiaison; paire: Paire } {
  const paire = paireEchange();
  return { code: { canal, cle: paire.publique, secret: aleatoire(TAILLE_SECRET), role }, paire };
}

/** Preuve que l'appareil qui répond a bien lu le code à l'écran. */
export function preuveLiaison(code: CodeLiaison, cleReponse: Uint8Array): Uint8Array {
  const cleHmac = deriver(code.secret, new Uint8Array(32), "UniChat-liaison-preuve-v1", 32);
  return authentifier(cleHmac, assembler(texteVersOctets(code.canal), code.cle, cleReponse));
}

export function verifierPreuve(code: CodeLiaison, cleReponse: Uint8Array, preuve: Uint8Array): boolean {
  return egaux(preuveLiaison(code, cleReponse), preuve);
}

/** Clé commune : échange X25519 entre les deux paires éphémères, salé par le secret du code. */
export function cleCommune(code: CodeLiaison, maPaire: Paire, autreCle: Uint8Array): Uint8Array {
  return deriver(echanger(maPaire.secrete, autreCle), code.secret, `UniChat-liaison-v1:${code.canal}`, 32);
}

const associe = (canal: string) => texteVersOctets(`UniChat-liaison:${canal}`);

export function scellerIdentite(cle: Uint8Array, canal: string, i: IdentitePrivee): Uint8Array {
  const contenu = JSON.stringify({
    v: 1,
    signature: versBase64(i.signature.secrete),
    echange: versBase64(i.echange.secrete),
    preuve: versBase64(i.preuve),
  });
  return sceller(cle, texteVersOctets(contenu), associe(canal));
}

/**
 * Identité reçue : clés publiques recalculées depuis les secrètes, et preuve
 * vérifiée. Une identité incohérente est refusée plutôt que rangée.
 */
export function ouvrirIdentite(cle: Uint8Array, canal: string, scelle: Uint8Array): IdentitePrivee {
  const brut = JSON.parse(octetsVersTexte(ouvrir(cle, scelle, associe(canal)))) as { v: number; signature: string; echange: string; preuve: string };
  if (brut.v !== 1) throw new Error("Version de liaison inconnue.");
  const signature = depuisBase64(brut.signature);
  const echange = depuisBase64(brut.echange);
  const identite: IdentitePrivee = {
    signature: { secrete: signature, publique: publiqueSignature(signature) },
    echange: { secrete: echange, publique: publiqueEchange(echange) },
    preuve: depuisBase64(brut.preuve),
  };
  if (!verifierIdentite({ signature: identite.signature.publique, echange: identite.echange.publique, preuve: identite.preuve })) {
    throw new Error("Identité reçue incohérente.");
  }
  return identite;
}
