import { LIMITE_TEXTE, MENTIONS_MAX, type ApercuLien } from "@unichat/shared";
import clsx from "clsx";
import { Check, FileText, Globe, Images, ListChecks, LoaderCircle, MapPin, Mic, Paperclip, Pencil, SendHorizontal, Smile, UserRound, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BoutonIcone } from "../composants/BoutonIcone";
import { Anime, Apparition } from "../composants/Apparition";
import { ChoixEmoji } from "../composants/ChoixEmoji";
import { Enregistrement } from "../composants/Enregistrement";
import { ACCEPTE_DOCUMENTS, ACCEPTE_VISUELS } from "../composants/EnvoiFichiers";
import { Menu, useFermetureExterieure } from "../composants/Menu";
import { premierLien } from "../composants/TexteMessage";
import { api } from "../lib/api";
import { estTactile } from "../lib/appui";
import { resumeMessage } from "../lib/format";
import type { MessageLocal } from "../lib/stockage";

// Brouillons gardés le temps de la visite, par discussion, comme dans les messageries de référence.
const brouillons = new Map<string, string>();

const normaliser = (texte: string) => texte.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export interface Extras {
  lien?: ApercuLien;
  mentions?: string[];
}

export function Composeur({
  conversation,
  reponse,
  edition,
  membres,
  nom,
  onAnnulerReponse,
  onAnnulerEdition,
  onModifier,
  onEnvoyer,
  onEcrit,
  onJoindre,
  onSpecial,
  onVocal,
  onAvis,
}: {
  conversation: string;
  reponse: MessageLocal | null;
  edition: MessageLocal | null;
  /** Groupe : les autres membres, que l'on peut mentionner avec @. */
  membres?: { id: string; nom: string }[];
  nom: (id: string) => string;
  onAnnulerReponse: () => void;
  onAnnulerEdition: () => void;
  onModifier: (texte: string) => void;
  onEnvoyer: (texte: string, extras: Extras) => void;
  onEcrit: () => void;
  onJoindre: (fichiers: File[]) => void;
  onSpecial: (quoi: "position" | "contact" | "sondage") => void;
  onVocal: (blob: Blob, duree: number) => void;
  onAvis: (texte: string) => void;
}) {
  const [texte, setTexte] = useState(() => brouillons.get(conversation) ?? "");
  const [menu, setMenu] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const [enregistre, setEnregistre] = useState(false);
  const [apercu, setApercu] = useState<{ url: string; resultat: ApercuLien | null } | null>(null);
  const [ignores, setIgnores] = useState<Set<string>>(() => new Set());
  const [mentionnes, setMentionnes] = useState<Map<string, string>>(() => new Map());
  const [suggestion, setSuggestion] = useState<{ debut: number; requete: string; rang: number } | null>(null);
  const champ = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const visuels = useRef<HTMLInputElement>(null);
  const documents = useRef<HTMLInputElement>(null);
  useFermetureExterieure(menu, menuRef, () => setMenu(false));

  // Répondre ou modifier : le clavier s'ouvre, c'est ce que l'on vient de demander.
  // À l'ouverture d'une discussion, seulement sur ordinateur : sur téléphone,
  // le clavier attend que l'on touche le champ, comme dans WhatsApp.
  useEffect(() => {
    if (reponse || !estTactile()) champ.current?.focus();
  }, [reponse]);
  // Modifier : le texte d'origine remplace le brouillon, qui revient ensuite.
  useEffect(() => {
    setTexte(edition ? edition.texte : (brouillons.get(conversation) ?? ""));
    if (edition || !estTactile()) champ.current?.focus();
  }, [edition, conversation]);
  useEffect(() => {
    if (edition) return;
    if (texte) brouillons.set(conversation, texte);
    else brouillons.delete(conversation);
  }, [texte, conversation, edition]);
  // Le champ grandit avec le texte, jusqu'à six lignes.
  useLayoutEffect(() => {
    const t = champ.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, 132)}px`;
  }, [texte]);

  // Aperçu du premier lien, préparé pendant la saisie (comme dans WhatsApp) et joint au message.
  const lien = edition ? null : premierLien(texte);
  useEffect(() => {
    if (!lien || ignores.has(lien)) {
      setApercu(null);
      return;
    }
    if (apercu?.url === lien) return;
    const controleur = new AbortController();
    const minuterie = setTimeout(() => {
      setApercu({ url: lien, resultat: null });
      api.apercu(lien, controleur.signal).then(
        (resultat) => setApercu((a) => (a?.url === lien ? { url: lien, resultat } : a)),
        () => setApercu((a) => (a?.url === lien ? null : a)),
      );
    }, 700);
    return () => {
      clearTimeout(minuterie);
      controleur.abort();
    };
    // apercu est volontairement absent : il change à chaque réponse et relancerait la demande.
  }, [lien, ignores]);

  const candidats =
    suggestion && membres
      ? membres.filter((m) => normaliser(m.nom).includes(normaliser(suggestion.requete))).slice(0, 6)
      : [];

  /** « @… » juste avant le curseur : on propose les membres du groupe. */
  function detecterMention(valeur: string, curseur: number) {
    if (!membres?.length) return;
    const avant = valeur.slice(0, curseur);
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(avant);
    setSuggestion(m ? { debut: curseur - m[2]!.length - 1, requete: m[2]!, rang: 0 } : null);
  }

  function choisirMention(membre: { id: string; nom: string }) {
    const t = champ.current;
    if (!t || !suggestion) return;
    const fin = t.selectionStart;
    const insere = `@${membre.nom} `;
    const suite = texte.slice(0, suggestion.debut) + insere + texte.slice(fin);
    setTexte(suite);
    setMentionnes((actuels) => new Map(actuels).set(membre.id, membre.nom));
    setSuggestion(null);
    requestAnimationFrame(() => {
      const position = suggestion.debut + insere.length;
      t.focus();
      t.setSelectionRange(position, position);
    });
  }

  function insererEmoji(e: string) {
    const t = champ.current;
    const debut = t?.selectionStart ?? texte.length;
    const fin = t?.selectionEnd ?? texte.length;
    if (texte.length + e.length > LIMITE_TEXTE) return;
    setTexte(texte.slice(0, debut) + e + texte.slice(fin));
    requestAnimationFrame(() => {
      t?.focus();
      t?.setSelectionRange(debut + e.length, debut + e.length);
    });
  }

  function envoyer() {
    if (!texte.trim()) return;
    if (edition) onModifier(texte);
    else {
      // Seules les mentions encore présentes dans le texte partent.
      const mentions = [...mentionnes].filter(([, n]) => texte.includes(`@${n}`)).map(([id]) => id).slice(0, MENTIONS_MAX);
      const joint = apercu?.resultat && apercu.url === lien ? apercu.resultat : undefined;
      onEnvoyer(texte, { ...(joint ? { lien: joint } : {}), ...(mentions.length ? { mentions } : {}) });
    }
    setTexte("");
    setApercu(null);
    setMentionnes(new Map());
    setSuggestion(null);
    champ.current?.focus();
  }

  return (
    <footer className="shrink-0 bg-entete">
      <Apparition>
        {edition && (
          <Anime className="flex items-center gap-3 px-3 pt-2.5 md:px-4">
            <div className="min-w-0 flex-1 rounded-md border-l-4 border-primaire bg-panneau px-3 py-2">
              <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-primaire-texte">
                <Pencil size={13} /> Modifier le message
              </p>
              <p className="truncate text-[13px] text-texte-2">{edition.texte}</p>
            </div>
            <BoutonIcone libelle="Annuler la modification" onClick={onAnnulerEdition}>
              <X size={20} />
            </BoutonIcone>
          </Anime>
        )}
      </Apparition>
      <Apparition>
        {reponse && (
          <Anime className="flex items-center gap-3 px-3 pt-2.5 md:px-4">
            <div className="min-w-0 flex-1 rounded-md border-l-4 border-primaire bg-panneau px-3 py-2">
              <p className="text-[12.5px] font-medium text-primaire-texte">Réponse à {nom(reponse.de)}</p>
              <p className="truncate text-[13px] text-texte-2">{resumeMessage(reponse)}</p>
            </div>
            <BoutonIcone libelle="Annuler la réponse" onClick={onAnnulerReponse}>
              <X size={20} />
            </BoutonIcone>
          </Anime>
        )}
      </Apparition>
      <Apparition>
        {apercu && (
          <Anime className="flex items-center gap-3 px-3 pt-2.5 md:px-4">
            <div className="flex min-w-0 flex-1 items-center gap-3 rounded-md bg-panneau px-3 py-2">
              <span className="flex size-10 shrink-0 items-center justify-center rounded bg-primaire-doux text-primaire-texte">
                {apercu.resultat ? <Globe size={20} /> : <LoaderCircle size={18} className="animate-spin" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-texte">{apercu.resultat?.titre ?? apercu.resultat?.site ?? "Aperçu du lien…"}</span>
                <span className="block truncate text-[12.5px] text-texte-2">{apercu.resultat?.description ?? apercu.url}</span>
              </span>
            </div>
            <BoutonIcone libelle="Retirer l'aperçu" onClick={() => setIgnores((s) => new Set(s).add(apercu.url))}>
              <X size={20} />
            </BoutonIcone>
          </Anime>
        )}
      </Apparition>
      <Apparition>{emoji && !enregistre && <ChoixEmoji onChoisir={insererEmoji} />}</Apparition>
      {enregistre ? (
        <Enregistrement
          onAnnuler={() => setEnregistre(false)}
          onTerminer={(blob, duree) => {
            setEnregistre(false);
            onVocal(blob, duree);
          }}
          onErreur={(message) => {
            setEnregistre(false);
            onAvis(message);
          }}
        />
      ) : (
        <div className="flex items-end gap-1 px-2 py-2.5 md:gap-1.5 md:px-4">
          <div ref={menuRef} className={clsx("relative", edition && "hidden")}>
            <BoutonIcone libelle="Joindre" actif={menu} onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} className="mb-px">
              <Paperclip size={22} />
            </BoutonIcone>
            <Apparition>
              {menu && (
                <Menu
                  className="bottom-full left-0 mb-2"
                  elements={[
                    { icone: Images, libelle: "Photos et vidéos", action: () => visuels.current?.click() },
                    { icone: FileText, libelle: "Document", action: () => documents.current?.click() },
                    { icone: MapPin, libelle: "Position", action: () => onSpecial("position") },
                    { icone: UserRound, libelle: "Contact", action: () => onSpecial("contact") },
                    { icone: ListChecks, libelle: "Sondage", action: () => onSpecial("sondage") },
                  ]}
                  onChoix={() => setMenu(false)}
                />
              )}
            </Apparition>
            {[
              { ref: visuels, accept: ACCEPTE_VISUELS },
              { ref: documents, accept: ACCEPTE_DOCUMENTS },
            ].map(({ ref, accept }) => (
              <input
                key={accept}
                ref={ref}
                type="file"
                multiple
                accept={accept}
                hidden
                onChange={(e) => {
                  const choisis = [...(e.target.files ?? [])];
                  e.target.value = "";
                  onJoindre(choisis);
                }}
              />
            ))}
          </div>
          <BoutonIcone
            libelle={emoji ? "Fermer les emoji" : "Emoji"}
            actif={emoji}
            onClick={() => {
              setEmoji((e) => !e);
              champ.current?.focus();
            }}
            className="mb-px"
          >
            {emoji ? <X size={22} /> : <Smile size={22} />}
          </BoutonIcone>
          <div className="relative flex min-h-[42px] flex-1 items-center rounded-lg bg-panneau px-3.5 py-[10px]">
            <Apparition>
              {candidats.length > 0 && suggestion && (
                <Anime effet="surgit" role="listbox" aria-label="Mentionner un membre" className="absolute right-0 bottom-full left-0 z-30 mb-2 overflow-hidden rounded-lg bg-panneau py-1.5 shadow-xl ring-1 ring-bordure">
                  {candidats.map((m, i) => (
                    <button
                      key={m.id}
                      type="button"
                      role="option"
                      aria-selected={i === suggestion.rang}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        choisirMention(m);
                      }}
                      className={clsx("flex w-full items-center gap-3 px-4 py-2 text-left text-[14.5px] text-texte", i === suggestion.rang ? "bg-survol" : "hover:bg-survol")}
                    >
                      <span className="text-primaire-texte">@</span>
                      {m.nom}
                    </button>
                  ))}
                </Anime>
              )}
            </Apparition>
            <textarea
              ref={champ}
              rows={1}
              value={texte}
              maxLength={LIMITE_TEXTE}
              onChange={(e) => {
                setTexte(e.target.value);
                detecterMention(e.target.value, e.target.selectionStart);
                if (e.target.value.trim()) onEcrit();
              }}
              onKeyDown={(e) => {
                if (candidats.length > 0 && suggestion) {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    const pas = e.key === "ArrowDown" ? 1 : -1;
                    setSuggestion({ ...suggestion, rang: (suggestion.rang + pas + candidats.length) % candidats.length });
                    return;
                  }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    choisirMention(candidats[suggestion.rang]!);
                    return;
                  }
                  if (e.key === "Escape") {
                    setSuggestion(null);
                    return;
                  }
                }
                // Entrée envoie, Maj+Entrée va à la ligne ; pas pendant une saisie
                // en cours de composition (accents, alphabets asiatiques).
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  envoyer();
                }
                if (e.key === "Escape" && emoji) setEmoji(false);
                else if (e.key === "Escape" && reponse) onAnnulerReponse();
                else if (e.key === "Escape" && edition) onAnnulerEdition();
              }}
              onPaste={(e) => {
                // Une capture d'écran collée part comme une photo, avec aperçu.
                const fichiers = [...e.clipboardData.files];
                if (fichiers.length === 0) return;
                e.preventDefault();
                onJoindre(fichiers);
              }}
              placeholder="Écrire un message"
              aria-label="Message"
              className="max-h-[132px] w-full resize-none bg-transparent text-[15px] leading-[20px] text-texte outline-none placeholder:text-texte-2"
            />
          </div>
          {/* Champ vide : le micro prend la place du bouton d'envoi, comme dans les messageries de référence. */}
          {edition ? (
            <button
              type="button"
              onClick={envoyer}
              disabled={!texte.trim()}
              aria-label="Enregistrer la modification"
              title="Enregistrer"
              className="flex size-[42px] shrink-0 items-center justify-center rounded-full bg-primaire text-sur-primaire transition-colors hover:bg-primaire-fort disabled:opacity-40"
            >
              <Check size={21} className="animate-fade" />
            </button>
          ) : (
            <button
              type="button"
              onClick={texte.trim() ? envoyer : () => setEnregistre(true)}
              aria-label={texte.trim() ? "Envoyer" : "Enregistrer un message vocal"}
              title={texte.trim() ? "Envoyer" : "Message vocal"}
              className="flex size-[42px] shrink-0 items-center justify-center rounded-full bg-primaire text-sur-primaire transition-colors hover:bg-primaire-fort"
            >
              {texte.trim() ? <SendHorizontal key="envoyer" size={20} className="animate-fade" /> : <Mic key="micro" size={20} className="animate-fade" />}
            </button>
          )}
        </div>
      )}
    </footer>
  );
}
