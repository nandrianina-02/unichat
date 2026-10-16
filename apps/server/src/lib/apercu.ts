import type { ApercuLien } from "@unichat/shared";

/** On lit le début de la page seulement : les balises utiles sont dans <head>. */
const OCTETS_MAX = 128 * 1024;
const DELAI = 4000;

const ENTITES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decoderEntites(texte: string): string {
  return texte.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (tout, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : tout;
    }
    return ENTITES[code.toLowerCase()] ?? tout;
  });
}

const propre = (texte: string | undefined, max: number) => {
  if (!texte) return undefined;
  const t = decoderEntites(texte).replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** Valeur d'une balise <meta> (property ou name), quel que soit l'ordre des attributs. */
function meta(html: string, cles: string[]): string | undefined {
  for (const balise of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const nom = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(balise)?.[1]?.toLowerCase();
    if (!nom || !cles.includes(nom)) continue;
    const contenu = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(balise);
    const valeur = contenu?.[1] ?? contenu?.[2];
    if (valeur) return valeur;
  }
  return undefined;
}

export function lireApercu(html: string, url: URL): Omit<ApercuLien, "url"> {
  const titre = meta(html, ["og:title", "twitter:title"]) ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const description = meta(html, ["og:description", "twitter:description", "description"]);
  const site = meta(html, ["og:site_name"]) ?? url.hostname.replace(/^www\./, "");
  return {
    ...(propre(titre, 200) ? { titre: propre(titre, 200) } : {}),
    ...(propre(description, 300) ? { description: propre(description, 300) } : {}),
    site: propre(site, 100) ?? url.hostname,
  };
}

/**
 * Adresse acceptée pour un aperçu : http(s), un nom de domaine (pas d'adresse
 * IP ni de nom local), sans identifiants dans l'URL.
 */
export function adresseAutorisee(brute: string): URL | null {
  let url: URL;
  try {
    url = new URL(brute);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const hote = url.hostname.toLowerCase();
  if (!hote.includes(".") || /^[\d.]+$/.test(hote) || hote.startsWith("[")) return null;
  if (/(^|\.)(localhost|local|internal|lan|home|arpa)$/.test(hote)) return null;
  return url;
}

/** Lit l'aperçu d'une page. Une erreur ou une page qui n'est pas du HTML donne un aperçu minimal. */
export async function chercherApercu(recuperer: typeof fetch, url: URL): Promise<ApercuLien> {
  const minimal: ApercuLien = { url: url.href, site: url.hostname.replace(/^www\./, "") };
  let reponse: Response;
  try {
    reponse = await recuperer(url.href, {
      headers: { "User-Agent": "UniChat/1.0 (apercu de lien)", Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(DELAI),
    });
  } catch {
    return minimal;
  }
  if (!reponse.ok || !reponse.body || !(reponse.headers.get("Content-Type") ?? "").includes("html")) {
    await reponse.body?.cancel().catch(() => {});
    return minimal;
  }
  const lecteur = reponse.body.getReader();
  const morceaux: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < OCTETS_MAX) {
      const { done, value } = await lecteur.read();
      if (done || !value) break;
      morceaux.push(value);
      total += value.length;
    }
  } catch {
    // Coupure en cours de lecture : on garde ce qui est arrivé.
  } finally {
    await lecteur.cancel().catch(() => {});
  }
  const octets = new Uint8Array(Math.min(total, OCTETS_MAX));
  let position = 0;
  for (const m of morceaux) {
    const part = m.subarray(0, Math.max(0, octets.length - position));
    octets.set(part, position);
    position += part.length;
  }
  const html = new TextDecoder("utf-8").decode(octets);
  return { url: url.href, ...lireApercu(html, url) };
}
