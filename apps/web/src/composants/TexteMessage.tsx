import type { ReactNode } from "react";

/** Adresses web dans un texte : http(s) seulement, la ponctuation finale n'en fait pas partie. */
const MOTIF_LIEN = /https?:\/\/[^\s<>"']+/gi;
const PONCTUATION_FINALE = /[.,;:!?)\]}»'"]+$/;

export function premierLien(texte: string): string | null {
  for (const brut of texte.match(MOTIF_LIEN) ?? []) {
    const url = brut.replace(PONCTUATION_FINALE, "");
    if (url.length > 10) return url;
  }
  return null;
}

const echapper = (texte: string) => texte.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Mentions « @Nom » des membres cités, du plus long nom au plus court (« @Ana Rakoto » avant « @Ana »). */
function avecMentions(texte: string, noms: string[], cle: string): ReactNode[] {
  if (noms.length === 0) return [texte];
  const motif = new RegExp(`@(${[...noms].sort((a, b) => b.length - a.length).map(echapper).join("|")})`, "g");
  const morceaux: ReactNode[] = [];
  let depuis = 0;
  for (const m of texte.matchAll(motif)) {
    if (m.index > depuis) morceaux.push(texte.slice(depuis, m.index));
    morceaux.push(
      <span key={`${cle}-${m.index}`} className="font-medium text-primaire-texte">
        {m[0]}
      </span>,
    );
    depuis = m.index + m[0].length;
  }
  if (depuis < texte.length) morceaux.push(texte.slice(depuis));
  return morceaux;
}

/** Texte d'un message : liens cliquables et mentions mises en évidence, rien d'autre n'est interprété. */
export function TexteMessage({ texte, mentions = [] }: { texte: string; mentions?: string[] }) {
  const morceaux: ReactNode[] = [];
  let depuis = 0;
  for (const m of texte.matchAll(MOTIF_LIEN)) {
    const url = m[0].replace(PONCTUATION_FINALE, "");
    if (m.index > depuis) morceaux.push(...avecMentions(texte.slice(depuis, m.index), mentions, `t${depuis}`));
    morceaux.push(
      <a
        key={`l${m.index}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        onClick={(e) => e.stopPropagation()}
        className="text-primaire-texte underline [overflow-wrap:anywhere]"
      >
        {url}
      </a>,
    );
    depuis = m.index + url.length;
  }
  if (depuis < texte.length) morceaux.push(...avecMentions(texte.slice(depuis), mentions, `t${depuis}`));
  return <>{morceaux}</>;
}
