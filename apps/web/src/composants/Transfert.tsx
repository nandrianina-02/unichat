import { TRANSFERT_MAX, conversationDirecte, estGroupe, type CarteProfil } from "@unichat/shared";
import clsx from "clsx";
import { LoaderCircle, Search, SendHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { useMoi } from "../lib/compte";
import { useMessagerie } from "../lib/messagerie-react";
import type { MessageLocal } from "../lib/stockage";
import { Avatar, AvatarGroupe } from "./Avatar";
import { BoutonIcone } from "./BoutonIcone";
import { Case } from "./Case";

interface Choix {
  conversation: string;
  nom: string;
  detail: string;
  photo: { id: string; version: string | null } | null;
}

/**
 * « Transférer à » : discussions récentes puis contacts, cinq destinataires
 * au plus à la fois, comme WhatsApp le fait pour freiner les chaînes.
 */
export function DialogueTransfert({
  messages,
  onFermer,
  onAvis,
}: {
  messages: MessageLocal[];
  onFermer: () => void;
  onAvis: (texte: string) => void;
}) {
  const moi = useMoi();
  const { messagerie, etat } = useMessagerie();
  const [contacts, setContacts] = useState<CarteProfil[]>([]);
  const [recherche, setRecherche] = useState("");
  const [choisis, setChoisis] = useState<string[]>([]);
  const [enCours, setEnCours] = useState(false);
  const champ = useRef<HTMLInputElement>(null);

  useEffect(() => {
    champ.current?.focus();
    api.contacts().then(
      (r) => setContacts(r.contacts),
      () => setContacts([]),
    );
    const echap = (e: KeyboardEvent) => e.key === "Escape" && onFermer();
    window.addEventListener("keydown", echap);
    return () => window.removeEventListener("keydown", echap);
  }, [onFermer]);

  const candidats = useMemo(() => {
    const liste: Choix[] = [];
    const vues = new Set<string>();
    for (const c of etat.conversations) {
      if (estGroupe(c.id)) {
        const g = etat.groupes[c.autre];
        if (!g || !g.moiMembre) continue;
        liste.push({ conversation: c.id, nom: g.nom, detail: `${g.membres.length} membres`, photo: null });
      } else {
        const p = c.autre === moi.id ? null : etat.personnes[c.autre];
        if (c.autre !== moi.id && (!p || p.bloque)) continue;
        liste.push({
          conversation: c.id,
          nom: p ? p.nom : `${moi.nom} (vous)`,
          detail: p?.infos ?? "",
          photo: { id: c.autre, version: p ? p.photo : moi.photo },
        });
      }
      vues.add(c.id);
    }
    for (const p of contacts) {
      const conversation = conversationDirecte(moi.id, p.id);
      if (vues.has(conversation) || p.bloque) continue;
      liste.push({ conversation, nom: p.nom, detail: p.infos ?? "", photo: { id: p.id, version: p.photo } });
    }
    const texte = recherche.trim().toLowerCase();
    return texte ? liste.filter((c) => c.nom.toLowerCase().includes(texte)) : liste;
  }, [etat.conversations, etat.groupes, etat.personnes, contacts, recherche, moi.id, moi.nom, moi.photo]);

  const noms = new Map(candidats.map((c) => [c.conversation, c.nom]));

  function basculer(conversation: string, coche: boolean) {
    if (coche && choisis.length >= TRANSFERT_MAX) {
      onAvis(`Vous pouvez transférer à ${TRANSFERT_MAX} discussions au plus à la fois.`);
      return;
    }
    setChoisis((liste) => (coche ? [...liste, conversation] : liste.filter((c) => c !== conversation)));
  }

  async function envoyer() {
    if (choisis.length === 0) return;
    setEnCours(true);
    const echecs = await messagerie.transferer(messages, choisis);
    onAvis(echecs > 0 ? `${echecs} message${echecs > 1 ? "s n'ont" : " n'a"} pas pu être transféré${echecs > 1 ? "s" : ""}.` : "Transféré.");
    onFermer();
  }

  return createPortal(
    <div className="animate-fade fixed inset-0 z-50 flex items-center justify-center bg-voile p-4" onMouseDown={onFermer}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Transférer le message"
        className="animate-rise flex h-[min(640px,90vh)] w-full max-w-md flex-col overflow-hidden rounded-lg bg-panneau shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex h-[60px] shrink-0 items-center gap-3 px-3">
          <BoutonIcone libelle="Fermer" onClick={onFermer}>
            <X size={22} />
          </BoutonIcone>
          <h2 className="text-[17px] text-texte">{messages.length > 1 ? `Transférer ${messages.length} messages` : "Transférer le message"}</h2>
        </header>
        <div className="px-3 pb-2">
          <label className="flex h-10 items-center gap-3 rounded-lg bg-champ px-3 focus-within:ring-2 focus-within:ring-primaire/40">
            <Search size={18} className="shrink-0 text-texte-2" />
            <input
              ref={champ}
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Rechercher un nom"
              aria-label="Rechercher un nom"
              className="min-w-0 flex-1 bg-transparent text-[15px] text-texte outline-none placeholder:text-texte-2"
            />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {candidats.length === 0 && <p className="px-6 py-10 text-center text-sm text-texte-2">Aucune discussion ni aucun contact.</p>}
          {candidats.map((c, i) => (
            <Case
              key={c.conversation}
              coche={choisis.includes(c.conversation)}
              onChange={(coche) => basculer(c.conversation, coche)}
              className={clsx("py-2.5 pr-4 pl-5 hover:bg-survol", i < 6 && `animate-fade stagger-${i + 1}`)}
            >
              {c.photo ? (
                <Avatar id={c.photo.id} photo={c.photo.version} nom={c.nom} taille={40} />
              ) : (
                <AvatarGroupe taille={40} />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15.5px] text-texte">{c.nom}</span>
                {c.detail && <span className="block truncate text-[13px] text-texte-2">{c.detail}</span>}
              </span>
            </Case>
          ))}
        </div>
        <footer className="flex min-h-[64px] shrink-0 items-center gap-3 border-t border-bordure bg-entete px-4 py-3">
          <p className="min-w-0 flex-1 truncate text-sm text-texte-2">
            {choisis.length === 0 ? "Choisissez jusqu'à 5 discussions" : choisis.map((c) => noms.get(c) ?? "…").join(", ")}
          </p>
          <button
            type="button"
            onClick={() => void envoyer()}
            disabled={choisis.length === 0 || enCours}
            aria-label="Transférer"
            title="Transférer"
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primaire text-sur-primaire transition-colors hover:bg-primaire-fort disabled:opacity-40"
          >
            {enCours ? <LoaderCircle size={20} className="animate-spin" /> : <SendHorizontal size={20} />}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
