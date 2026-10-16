import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { dateListe, resumeMessage } from "../lib/format";
import { useMessagerie, useMessages } from "../lib/messagerie-react";
import { allerAuMessage } from "./Discussion";

/** Comparaison sans casse ni accents : « ete » trouve « Été ». */
const normaliser = (texte: string) => texte.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Extrait autour de l'occurrence, l'occurrence mise en évidence. */
function Extrait({ texte, recherche }: { texte: string; recherche: string }): ReactNode {
  const position = normaliser(texte).indexOf(normaliser(recherche));
  if (position < 0) return texte;
  const debut = Math.max(0, position - 30);
  const fin = position + recherche.length;
  return (
    <>
      {debut > 0 && "…"}
      {texte.slice(debut, position)}
      <mark className="rounded-sm bg-primaire-doux text-texte">{texte.slice(position, fin)}</mark>
      {texte.slice(fin, fin + 80)}
    </>
  );
}

/**
 * « Rechercher des messages », à côté de la discussion comme les infos. La
 * recherche se fait sur l'appareil : le serveur n'a pas l'historique.
 */
export function RechercheMessages({ conversation, onFermer }: { conversation: string; onFermer: () => void }) {
  const { messagerie } = useMessagerie();
  const messages = useMessages(conversation);
  const [texte, setTexte] = useState("");
  const champ = useRef<HTMLInputElement>(null);

  useEffect(() => {
    champ.current?.focus();
  }, []);

  const recherche = texte.trim();
  const resultats = useMemo(() => {
    if (recherche.length < 2 || !messages) return [];
    const cle = normaliser(recherche);
    return messages
      .filter((m) => m.type !== "evenement" && !m.supprime && normaliser(resumeMessage(m)).includes(cle))
      .reverse();
  }, [messages, recherche]);

  return (
    <section className="vue-entree flex h-full w-full flex-col bg-panneau">
      <header className="flex h-[60px] shrink-0 items-center gap-6 bg-entete px-5">
        <button
          type="button"
          onClick={onFermer}
          aria-label="Fermer"
          title="Fermer"
          className="inline-flex size-10 items-center justify-center rounded-full text-texte-2 hover:bg-survol"
        >
          <X size={22} />
        </button>
        <h2 className="text-[16px] text-texte">Rechercher des messages</h2>
      </header>
      <div className="px-4 py-3">
        <label className="flex h-10 items-center gap-3 rounded-lg bg-champ px-3 focus-within:ring-2 focus-within:ring-primaire/40">
          <Search size={18} className="shrink-0 text-texte-2" />
          <input
            ref={champ}
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            placeholder="Rechercher…"
            aria-label="Rechercher dans la discussion"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-texte outline-none placeholder:text-texte-2"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {recherche.length < 2 && <p className="px-8 py-8 text-center text-sm text-texte-2">Rechercher des messages dans cette discussion.</p>}
        {recherche.length >= 2 && resultats.length === 0 && (
          <p className="animate-fade px-8 py-8 text-center text-sm text-texte-2">Aucun message ne contient « {recherche} ».</p>
        )}
        {resultats.map((m, i) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              allerAuMessage(m.id);
              // Sur un petit écran, le panneau recouvre la discussion : on le referme pour montrer le message.
              if (window.innerWidth < 1024) onFermer();
            }}
            className={`flex w-full flex-col gap-0.5 border-b border-bordure px-6 py-3 text-left transition-colors hover:bg-survol ${i < 6 ? `animate-fade stagger-${i + 1}` : ""}`}
          >
            <span className="flex items-baseline justify-between gap-3 text-[12.5px] text-texte-2">
              <span className="truncate">{messagerie.nom(m.de, conversation)}</span>
              <span className="shrink-0">{dateListe(m.le)}</span>
            </span>
            <span className="line-clamp-2 text-[14.5px] text-texte">
              <Extrait texte={resumeMessage(m)} recherche={recherche} />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
