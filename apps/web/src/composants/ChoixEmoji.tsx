import clsx from "clsx";
import { Apple, Car, Clock, Hash, Lightbulb, LoaderCircle, PawPrint, Smile, Trophy, UserRound, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CategorieEmoji } from "../lib/emoji";
import { useSortie } from "./Apparition";

const ICONES: Record<string, LucideIcon> = {
  recents: Clock,
  emotions: Smile,
  personnes: UserRound,
  nature: PawPrint,
  nourriture: Apple,
  voyages: Car,
  activites: Trophy,
  objets: Lightbulb,
  symboles: Hash,
};

const CLE_RECENTS = "unichat.emoji-recents";
const RECENTS_MAX = 32;

function lireRecents(): string[] {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE_RECENTS) ?? "[]") as unknown;
    return Array.isArray(brut) ? brut.filter((e): e is string => typeof e === "string").slice(0, RECENTS_MAX) : [];
  } catch {
    return [];
  }
}

/**
 * Panneau d'emoji, au-dessus du champ de saisie. Les emoji sont du contenu
 * écrit par l'utilisateur : ils ne servent jamais d'élément d'interface (les
 * onglets sont des pictogrammes). La liste est chargée à la première ouverture.
 */
export function ChoixEmoji({ onChoisir }: { onChoisir: (emoji: string) => void }) {
  const [categories, setCategories] = useState<CategorieEmoji[] | null>(null);
  const [recents, setRecents] = useState<string[]>(lireRecents);
  const [active, setActive] = useState("emotions");
  const zone = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let annule = false;
    void import("../lib/emoji").then((m) => !annule && setCategories(m.CATEGORIES_EMOJI));
    return () => {
      annule = true;
    };
  }, []);

  function choisir(emoji: string) {
    onChoisir(emoji);
    const suite = [emoji, ...recents.filter((e) => e !== emoji)].slice(0, RECENTS_MAX);
    setRecents(suite);
    try {
      localStorage.setItem(CLE_RECENTS, JSON.stringify(suite));
    } catch {
      // Stockage indisponible : les récents ne seront pas retenus.
    }
  }

  const sections: CategorieEmoji[] = [
    ...(recents.length > 0 ? [{ id: "recents", libelle: "Récents", emoji: recents }] : []),
    ...(categories ?? []),
  ];

  const sortie = useSortie();

  function aller(id: string) {
    setActive(id);
    zone.current?.querySelector(`[data-categorie="${id}"]`)?.scrollIntoView({ block: "start" });
  }

  return (
    <div className={clsx(sortie ? "animate-sink pointer-events-none" : "animate-rise", "mx-2 mb-1 flex h-[300px] flex-col overflow-hidden rounded-lg bg-panneau shadow-sm ring-1 ring-bordure md:mx-4")}>
      <div role="tablist" aria-label="Catégories d'emoji" className="flex shrink-0 justify-between gap-1 border-b border-bordure px-2 py-1">
        {sections.map((s) => {
          const Icone = ICONES[s.id] ?? Smile;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={active === s.id}
              aria-label={s.libelle}
              title={s.libelle}
              onClick={() => aller(s.id)}
              className={clsx(
                "flex size-9 items-center justify-center rounded-md border-b-2 transition-colors",
                active === s.id ? "border-primaire text-primaire" : "border-transparent text-texte-2 hover:text-texte",
              )}
            >
              <Icone size={19} />
            </button>
          );
        })}
      </div>
      <div
        ref={zone}
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
        onScroll={(e) => {
          // L'onglet suit la section visible.
          const haut = e.currentTarget.getBoundingClientRect().top;
          let courante = active;
          for (const section of e.currentTarget.querySelectorAll<HTMLElement>("[data-categorie]")) {
            if (section.getBoundingClientRect().top - haut <= 40) courante = section.dataset.categorie ?? courante;
          }
          if (courante !== active) setActive(courante);
        }}
      >
        {categories === null && (
          <p className="flex justify-center py-10 text-texte-2">
            <LoaderCircle size={20} className="animate-spin" />
          </p>
        )}
        {categories &&
          sections.map((s) => (
            <section key={s.id} data-categorie={s.id}>
              <h4 className="sticky top-0 bg-panneau px-1.5 pt-2.5 pb-1.5 text-[12.5px] text-texte-2">{s.libelle}</h4>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(40px,1fr))]">
                {s.emoji.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => choisir(e)}
                    className="flex h-10 items-center justify-center rounded-md text-[24px] leading-none transition-colors hover:bg-survol"
                  >
                    {e}
                  </button>
                ))}
              </div>
            </section>
          ))}
      </div>
    </div>
  );
}
