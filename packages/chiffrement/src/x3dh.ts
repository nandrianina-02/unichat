import { encoderIdentite, verifierPaquet, type CleSignee, type CleUnique, type IdentitePrivee, type IdentitePublique, type Paquet } from "./identite";
import { assembler } from "./octets";
import { deriver, echanger, paireEchange, type Paire } from "./primitives";

/**
 * X3DH (signal.org/docs/specifications/x3dh) : deux appareils conviennent
 * d'un secret sans s'être jamais parlé, à partir du paquet de clés que le
 * destinataire a déposé sur le serveur. Seule différence avec la
 * spécification : l'identité porte deux clés (signature Ed25519, échange
 * X25519) au lieu d'une seule clé XEdDSA.
 */

/** Ce que l'émetteur joint à ses premiers messages pour que l'autre retrouve le secret. */
export interface OuvertureX3DH {
  identite: IdentitePublique;
  /** Clé éphémère de l'émetteur : elle désigne la session de façon unique. */
  ephemere: Uint8Array;
  cleSigneeId: number;
  /** 0 : le serveur n'avait plus de clé unique à donner. */
  cleUniqueId: number;
}

const INFO = "UniChat-X3DH-v1";
const PREFIXE = new Uint8Array(32).fill(0xff);
const SEL = new Uint8Array(32);

const secret = (dh: Uint8Array[]) => deriver(assembler(PREFIXE, ...dh), SEL, INFO, 32);

/** Données associées : les deux identités, liées à chaque message de la session. */
export const associe = (emetteur: IdentitePublique, recepteur: IdentitePublique) => assembler(encoderIdentite(emetteur), encoderIdentite(recepteur));

export function ouvrirX3DH(moi: IdentitePrivee, paquet: Paquet, ephemere: Paire = paireEchange()): { sk: Uint8Array; ad: Uint8Array; ouverture: OuvertureX3DH } {
  if (!verifierPaquet(paquet)) throw new Error("Paquet de clés invalide : signature incorrecte.");
  const dh = [
    echanger(moi.echange.secrete, paquet.cleSignee.cle),
    echanger(ephemere.secrete, paquet.identite.echange),
    echanger(ephemere.secrete, paquet.cleSignee.cle),
  ];
  if (paquet.cleUnique) dh.push(echanger(ephemere.secrete, paquet.cleUnique.cle));
  const identite = { signature: moi.signature.publique, echange: moi.echange.publique, preuve: moi.preuve };
  return {
    sk: secret(dh),
    ad: associe(identite, paquet.identite),
    ouverture: { identite, ephemere: ephemere.publique, cleSigneeId: paquet.cleSignee.id, cleUniqueId: paquet.cleUnique?.id ?? 0 },
  };
}

export function accepterX3DH(moi: IdentitePrivee, cleSignee: CleSignee, cleUnique: CleUnique | undefined, o: OuvertureX3DH): { sk: Uint8Array; ad: Uint8Array } {
  const dh = [
    echanger(cleSignee.paire.secrete, o.identite.echange),
    echanger(moi.echange.secrete, o.ephemere),
    echanger(cleSignee.paire.secrete, o.ephemere),
  ];
  if (cleUnique) dh.push(echanger(cleUnique.paire.secrete, o.ephemere));
  return { sk: secret(dh), ad: associe(o.identite, { signature: moi.signature.publique, echange: moi.echange.publique, preuve: moi.preuve }) };
}
