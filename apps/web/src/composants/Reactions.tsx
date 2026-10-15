import { REACTIONS, type Reaction } from "@unichat/shared";
import clsx from "clsx";
import { Frown, HandHeart, Heart, Laugh, PartyPopper, ThumbsUp, type LucideIcon } from "lucide-react";

/** Les réactions d'UniChat sont des pictogrammes, pas des emoji. */
export const REACTIONS_AFFICHEES: Record<Reaction, { icone: LucideIcon; libelle: string }> = {
  pouce: { icone: ThumbsUp, libelle: "J'aime" },
  coeur: { icone: Heart, libelle: "J'adore" },
  rire: { icone: Laugh, libelle: "Drôle" },
  bravo: { icone: PartyPopper, libelle: "Bravo" },
  triste: { icone: Frown, libelle: "Triste" },
  merci: { icone: HandHeart, libelle: "Merci" },
};

export function IconeReaction({ code, taille = 16, className }: { code: Reaction; taille?: number; className?: string }) {
  const { icone: Icone, libelle } = REACTIONS_AFFICHEES[code];
  return <Icone size={taille} aria-label={libelle} className={clsx("shrink-0 text-primaire", className)} />;
}

/** Barre de choix : un clic sur la réaction déjà choisie la retire. */
export function ChoixReaction({ actuelle, onChoisir }: { actuelle: Reaction | undefined; onChoisir: (code: Reaction | null) => void }) {
  return (
    <div role="group" aria-label="Réagir" className="flex gap-1">
      {REACTIONS.map((code) => {
        const { icone: Icone, libelle } = REACTIONS_AFFICHEES[code];
        const choisie = actuelle === code;
        return (
          <button
            key={code}
            type="button"
            title={libelle}
            aria-label={libelle}
            aria-pressed={choisie}
            onClick={() => onChoisir(choisie ? null : code)}
            className={clsx(
              "flex size-9 items-center justify-center rounded-full transition-colors",
              choisie ? "bg-primaire-doux text-primaire" : "text-texte-2 hover:bg-survol hover:text-primaire",
            )}
          >
            <Icone size={20} />
          </button>
        );
      })}
    </div>
  );
}
