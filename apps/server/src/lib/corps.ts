/**
 * Lit le corps d'une requête en s'arrêtant dès qu'il dépasse `maximum`.
 *
 * On ne se fie pas à Content-Length : il peut manquer (envoi par morceaux,
 * HTTP/2) ou mentir. Sans cette borne, un envoi de plusieurs dizaines de
 * mégaoctets serait chargé entièrement en mémoire avant d'être refusé.
 */
export async function lireCorpsBorne(requete: Request, maximum: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const annonce = Number(requete.headers.get("Content-Length") ?? "NaN");
  if (Number.isFinite(annonce) && annonce > maximum) return null;
  if (!requete.body) return new Uint8Array(0);

  const lecteur = requete.body.getReader();
  const morceaux: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximum) {
      await lecteur.cancel();
      return null;
    }
    morceaux.push(value);
  }
  const resultat = new Uint8Array(total);
  let position = 0;
  for (const morceau of morceaux) {
    resultat.set(morceau, position);
    position += morceau.byteLength;
  }
  return resultat;
}
