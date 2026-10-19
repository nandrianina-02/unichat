import { useMemo } from "react";
import { encode } from "uqr";

/** Zone de silence exigée par la norme du QR code, en modules. */
const MARGE = 4;

/**
 * QR code dessiné en SVG à partir de la matrice : pas de balisage injecté, la
 * politique de sécurité du site reste fermée. Sombre sur clair quel que soit
 * le thème, c'est ce que lisent les appareils photo.
 */
export function CodeQr({ texte, taille = 232, libelle }: { texte: string; taille?: number; libelle: string }) {
  const { chemin, cote } = useMemo(() => {
    const { data, size } = encode(texte, { ecc: "M", border: 0 });
    // Un seul tracé : chaque suite de modules sombres d'une rangée devient un rectangle.
    let d = "";
    data.forEach((rangee, y) => {
      let x = 0;
      while (x < size) {
        if (!rangee[x]) {
          x += 1;
          continue;
        }
        let fin = x;
        while (fin < size && rangee[fin]) fin += 1;
        d += `M${x + MARGE} ${y + MARGE}h${fin - x}v1h${x - fin}z`;
        x = fin;
      }
    });
    return { chemin: d, cote: size + MARGE * 2 };
  }, [texte]);

  return (
    <svg role="img" aria-label={libelle} viewBox={`0 0 ${cote} ${cote}`} width={taille} height={taille} shapeRendering="crispEdges" className="rounded-md bg-qr-fond">
      <path d={chemin} className="fill-qr-encre" />
    </svg>
  );
}
