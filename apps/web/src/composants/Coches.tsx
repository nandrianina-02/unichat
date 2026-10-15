import clsx from "clsx";
import { Check, CheckCheck, CircleAlert, Clock } from "lucide-react";
import type { EtatMessage } from "../lib/stockage";

const LIBELLES: Record<EtatMessage, string> = {
  attente: "En attente d'envoi",
  envoye: "Envoyé",
  remis: "Remis",
  lu: "Lu",
  echec: "Non envoyé",
};

/** Horloge, une coche, deux coches, deux coches colorées : l'état de remise d'un message. */
export function Coches({ etat, className }: { etat: EtatMessage | undefined; className?: string }) {
  if (!etat) return null;
  const commun = clsx("shrink-0", className);
  const libelle = LIBELLES[etat];
  if (etat === "attente") return <Clock size={14} className={clsx(commun, "text-texte-3")} aria-label={libelle} />;
  if (etat === "envoye") return <Check size={16} className={clsx(commun, "text-texte-3")} aria-label={libelle} />;
  if (etat === "remis") return <CheckCheck size={16} className={clsx(commun, "text-texte-3")} aria-label={libelle} />;
  if (etat === "lu") return <CheckCheck size={16} className={clsx(commun, "text-coche-lue")} aria-label={libelle} />;
  return <CircleAlert size={15} className={clsx(commun, "text-danger")} aria-label={libelle} />;
}
