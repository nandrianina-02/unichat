import { MOTIF_SUSPENSION_MAX } from "@unichat/shared";
import clsx from "clsx";
import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Dialogue } from "../../composants/Dialogue";
import { ErreurApi } from "../../lib/api";
import { reconnecter, reconnexionRequise } from "../../lib/reconnexion";
import { estTactile } from "../../lib/appui";
import { useCompte } from "../../lib/compte";

const jour = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const jourHeure = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const compact = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });
const entier = new Intl.NumberFormat("fr-FR");

export const dateCourte = (le: number) => jour.format(new Date(le));
export const dateHeure = (le: number) => jourHeure.format(new Date(le));
/** Au-delà de 10 000, la forme courte (12,9 k) : un tableau de bord se lit d'un coup d'œil. */
export const nombre = (n: number) => (n >= 10_000 ? compact.format(n) : entier.format(n));

export const messageErreur = (e: unknown, defaut: string) => (e instanceof ErreurApi ? e.message : defaut);
/** Chargement d'une liste ou d'une fiche, avec la session perdue traitée comme partout ailleurs. */
export function useChargement<T>(charger: () => Promise<T>, cle: string) {
  const { sessionPerdue } = useCompte();
  const [donnees, setDonnees] = useState<T | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const chargerRef = useRef(charger);
  chargerRef.current = charger;

  useEffect(() => {
    let actif = true;
    setErreur(null);
    chargerRef.current().then(
      (d) => actif && setDonnees(d),
      (e) => actif && !sessionPerdue(e) && setErreur(messageErreur(e, "Chargement impossible.")),
    );
    return () => {
      actif = false;
    };
  }, [cle, version, sessionPerdue]);

  const recharger = useCallback(() => setVersion((v) => v + 1), []);
  return { donnees, setDonnees, erreur, recharger };
}

export function Attente({ texte = "Chargement…" }: { texte?: string }) {
  return (
    <p className="animate-fade flex items-center gap-3 px-1 py-6 text-sm text-texte-2">
      <LoaderCircle size={18} className="animate-spin" /> {texte}
    </p>
  );
}

export function Pastille({ children, ton = "neutre" }: { children: ReactNode; ton?: "neutre" | "accent" | "danger" }) {
  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-px text-[11.5px] font-medium",
        ton === "accent" && "bg-primaire-doux text-primaire-texte",
        ton === "danger" && "bg-danger-doux text-danger",
        ton === "neutre" && "bg-entete text-texte-2",
      )}
    >
      {children}
    </span>
  );
}

/**
 * Boîte de dialogue d'une action de modération : motif à saisir (suspension,
 * fermeture), erreur du serveur affichée sur place, et reconnexion proposée
 * quand le serveur l'exige.
 */
export function DialogueAction({
  titre,
  confirmer,
  danger,
  explication,
  motif: avecMotif,
  saisie,
  onAgir,
  onFermer,
}: {
  titre: string;
  confirmer: string;
  danger?: boolean;
  explication: ReactNode;
  /** Motif obligatoire, gardé au journal. */
  motif?: boolean;
  /** Texte à recopier pour confirmer (nom d'utilisateur). */
  saisie?: { etiquette: string; attendu: string };
  onAgir: (motif: string) => Promise<void>;
  onFermer: () => void;
}) {
  const [motif, setMotif] = useState("");
  const [recopie, setRecopie] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [aReconnecter, setAReconnecter] = useState(false);
  const champ = useRef<HTMLTextAreaElement & HTMLInputElement>(null);

  useEffect(() => {
    // Après la boîte, qui donne d'abord le focus à son bouton.
    if (!estTactile()) setTimeout(() => champ.current?.focus(), 0);
  }, []);

  const pret = (!avecMotif || motif.trim().length >= 3) && (!saisie || recopie.trim() === saisie.attendu);

  async function agir() {
    if (aReconnecter) return reconnecter();
    if (!pret) {
      setErreur(avecMotif && motif.trim().length < 3 ? "Indiquez le motif (3 caractères au moins)." : "La confirmation ne correspond pas.");
      return;
    }
    setEnCours(true);
    setErreur(null);
    try {
      await onAgir(motif.trim());
      onFermer();
    } catch (e) {
      if (reconnexionRequise(e)) setAReconnecter(true);
      setErreur(messageErreur(e, "L'action a échoué. Réessayez."));
      setEnCours(false);
    }
  }

  return (
    <Dialogue titre={titre} confirmer={aReconnecter ? "Se reconnecter" : confirmer} danger={danger && !aReconnecter} enCours={enCours} onConfirmer={() => void agir()} onFermer={onFermer}>
      <div className="space-y-4">
        <div>{explication}</div>
        {avecMotif && (
          <label className="block">
            <span className="mb-1.5 block text-[13px] text-texte-2">Motif, gardé au journal</span>
            <textarea
              ref={champ}
              value={motif}
              maxLength={MOTIF_SUSPENSION_MAX}
              rows={3}
              onChange={(e) => setMotif(e.target.value)}
              className="w-full resize-none rounded-lg bg-champ px-3 py-2.5 text-[14px] text-texte outline-none focus:ring-2 focus:ring-primaire"
            />
          </label>
        )}
        {saisie && (
          <label className="block">
            <span className="mb-1.5 block text-[13px] text-texte-2">{saisie.etiquette}</span>
            <input
              ref={champ}
              value={recopie}
              onChange={(e) => setRecopie(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-lg bg-champ px-3 py-2.5 text-[14px] text-texte outline-none focus:ring-2 focus:ring-primaire"
            />
          </label>
        )}
        {erreur && (
          <p role="alert" className="animate-fade text-[13px] text-danger">
            {erreur}
          </p>
        )}
      </div>
    </Dialogue>
  );
}
