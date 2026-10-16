import type { ApercuInvitation, Groupe } from "@unichat/shared";
import { Copy, LoaderCircle, RotateCw, UsersRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ErreurApi, api } from "../lib/api";
import { useCompte } from "../lib/compte";
import { lienGroupe } from "../lib/invitation";
import { useRetourSysteme } from "../lib/retour";
import { AvatarGroupe } from "./Avatar";
import { BoutonIcone } from "./BoutonIcone";
import { Dialogue } from "./Dialogue";

function Cadre({ titre, onFermer, children }: { titre: string; onFermer: () => void; children: React.ReactNode }) {
  useRetourSysteme(true, onFermer);
  useEffect(() => {
    const echap = (e: KeyboardEvent) => e.key === "Escape" && onFermer();
    window.addEventListener("keydown", echap);
    return () => window.removeEventListener("keydown", echap);
  }, [onFermer]);
  return createPortal(
    <div className="animate-fade fixed inset-0 z-50 flex items-center justify-center bg-voile p-4" onMouseDown={onFermer}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titre}
        className="animate-rise w-full max-w-md rounded-lg bg-panneau shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 px-3 pt-3">
          <BoutonIcone libelle="Fermer" onClick={onFermer}>
            <X size={22} />
          </BoutonIcone>
          <h2 className="text-[17px] text-texte">{titre}</h2>
        </header>
        <div className="px-6 pt-2 pb-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Lien d'invitation d'un groupe, pour les administrateurs : quiconque le
 * reçoit peut entrer, sans être dans les contacts de personne. Le
 * réinitialiser rend l'ancien inutilisable.
 */
export function DialogueLienGroupe({ groupe, onFermer }: { groupe: Groupe; onFermer: () => void }) {
  const { sessionPerdue } = useCompte();
  const [code, setCode] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [avis, setAvis] = useState<string | null>(null);
  const [confirmer, setConfirmer] = useState(false);

  useEffect(() => {
    api.invitationGroupe(groupe.id).then(
      (r) => setCode(r.code),
      (e) => !sessionPerdue(e) && setErreur(e instanceof ErreurApi ? e.message : "Lien indisponible."),
    );
  }, [groupe.id, sessionPerdue]);

  const lien = code ? lienGroupe(code) : "";

  async function reinitialiser() {
    setConfirmer(false);
    try {
      setCode((await api.reinitialiserInvitation(groupe.id)).code);
      setAvis("Nouveau lien créé. L'ancien ne fonctionne plus.");
    } catch (e) {
      if (!sessionPerdue(e)) setErreur("Le lien n'a pas pu être réinitialisé.");
    }
  }

  return (
    <Cadre titre="Inviter avec un lien" onFermer={onFermer}>
      <div className="flex items-center gap-4">
        <AvatarGroupe taille={56} groupeId={groupe.id} photo={groupe.photo} />
        <div className="min-w-0">
          <p className="truncate text-[16px] text-texte">{groupe.nom}</p>
          <p className="text-[13px] text-texte-2">Toute personne qui reçoit ce lien peut rejoindre le groupe.</p>
        </div>
      </div>
      {erreur && <p className="mt-4 text-sm text-danger">{erreur}</p>}
      {!code && !erreur && (
        <p className="mt-6 flex justify-center text-texte-2">
          <LoaderCircle size={20} className="animate-spin" />
        </p>
      )}
      {code && (
        <>
          <input
            readOnly
            value={lien}
            aria-label="Lien d'invitation"
            onFocus={(e) => e.currentTarget.select()}
            className="mt-5 w-full rounded-lg bg-champ px-3 py-2.5 text-[14px] text-primaire-texte outline-none"
          />
          <div className="mt-4 flex flex-col gap-1">
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard.writeText(lien).then(
                  () => setAvis("Lien copié."),
                  () => setAvis("La copie a été refusée par le navigateur."),
                )
              }
              className="flex items-center gap-4 rounded-md px-2 py-2.5 text-left text-[15px] text-texte transition-colors hover:bg-survol"
            >
              <Copy size={20} className="text-texte-2" /> Copier le lien
            </button>
            <button
              type="button"
              onClick={() => setConfirmer(true)}
              className="flex items-center gap-4 rounded-md px-2 py-2.5 text-left text-[15px] text-danger transition-colors hover:bg-survol"
            >
              <RotateCw size={20} /> Réinitialiser le lien
            </button>
          </div>
        </>
      )}
      {avis && <p role="status" className="animate-fade mt-3 text-[13px] text-texte-2">{avis}</p>}
      {confirmer && (
        <Dialogue titre="Réinitialiser le lien ?" confirmer="Réinitialiser" danger onConfirmer={() => void reinitialiser()} onFermer={() => setConfirmer(false)}>
          Personne ne pourra plus rejoindre le groupe avec l'ancien lien.
        </Dialogue>
      )}
    </Cadre>
  );
}

/** Lien d'invitation ouvert : aperçu du groupe, puis « Rejoindre ». */
export function DialogueRejoindre({
  code,
  onFermer,
  onRejoint,
}: {
  code: string;
  onFermer: () => void;
  onRejoint: (groupe: Groupe) => void;
}) {
  const { sessionPerdue } = useCompte();
  const [apercu, setApercu] = useState<ApercuInvitation | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    api.apercuInvitation(code).then(setApercu, (e) => !sessionPerdue(e) && setErreur(e instanceof ErreurApi ? e.message : "Lien indisponible."));
  }, [code, sessionPerdue]);

  async function rejoindre() {
    setEnCours(true);
    try {
      onRejoint(await api.rejoindre(code));
    } catch (e) {
      if (!sessionPerdue(e)) setErreur(e instanceof ErreurApi ? e.message : "Impossible de rejoindre le groupe.");
      setEnCours(false);
    }
  }

  return (
    <Cadre titre="Invitation à un groupe" onFermer={onFermer}>
      {erreur && <p className="text-sm text-danger">{erreur}</p>}
      {!apercu && !erreur && (
        <p className="flex justify-center py-6 text-texte-2">
          <LoaderCircle size={20} className="animate-spin" />
        </p>
      )}
      {apercu && (
        <div className="animate-fade flex flex-col items-center text-center">
          <AvatarGroupe taille={96} />
          <p className="mt-4 text-[20px] text-texte">{apercu.nom}</p>
          <p className="mt-1 flex items-center gap-1.5 text-[14px] text-texte-2">
            <UsersRound size={15} /> {apercu.membres} membre{apercu.membres > 1 ? "s" : ""}
          </p>
          {apercu.description && <p className="mt-3 line-clamp-4 text-[14px] leading-relaxed text-texte-2">{apercu.description}</p>}
          <button
            type="button"
            onClick={() => (apercu.dejaMembre ? onFermer() : void rejoindre())}
            disabled={enCours}
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-primaire px-6 py-2.5 text-sm font-medium text-sur-primaire transition-colors hover:bg-primaire-fort disabled:opacity-60"
          >
            {enCours && <LoaderCircle size={16} className="animate-spin" />}
            {apercu.dejaMembre ? "Vous êtes déjà membre" : "Rejoindre le groupe"}
          </button>
        </div>
      )}
    </Cadre>
  );
}
