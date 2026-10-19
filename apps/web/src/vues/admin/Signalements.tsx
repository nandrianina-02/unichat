import type { Decision, SignalementAdmin } from "@unichat/shared";
import clsx from "clsx";
import { Ban, Check, Flag, Paperclip, UserRound, UsersRound } from "lucide-react";
import { useState } from "react";
import { Apparition } from "../../composants/Apparition";
import { api } from "../../lib/api";
import { quand } from "../../lib/format";
import { Attente, DialogueAction, Pastille, dateHeure, useChargement } from "./outils";

const DECISIONS: Record<Decision, string> = {
  classe: "Classé sans suite",
  suspendu: "Compte suspendu",
  groupe_ferme: "Groupe fermé",
};

export function Signalements({ onOuvrirCompte, onTraite }: { onOuvrirCompte: (id: string) => void; onTraite: () => void }) {
  const [etat, setEtat] = useState<"ouverts" | "traites">("ouverts");
  const { donnees, erreur, recharger } = useChargement(() => api.admin.signalements(etat), etat);
  const [action, setAction] = useState<{ s: SignalementAdmin; decision: Decision } | null>(null);

  async function decider(s: SignalementAdmin, decision: Decision, motif?: string) {
    await api.admin.decider(s.id, decision, motif);
    recharger();
    onTraite();
  }

  const liste = donnees?.signalements ?? null;
  return (
    <div className="pb-10">
      <div className="animate-rise flex gap-2">
        {(["ouverts", "traites"] as const).map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => setEtat(e)}
            aria-pressed={etat === e}
            className={clsx(
              "rounded-full px-3.5 py-1.5 text-[13.5px] transition-colors",
              etat === e ? "bg-primaire-doux text-primaire-texte" : "bg-entete text-texte-2 hover:text-texte",
            )}
          >
            {e === "ouverts" ? "À examiner" : "Traités"}
          </button>
        ))}
      </div>
      <p className="animate-fade mt-3 max-w-2xl text-[13px] text-texte-2">
        Les messages affichés sont ceux que la personne qui signale a joints elle-même : UniChat ne garde aucune conversation.
        {etat === "ouverts" && " Les plus anciens en premier."}
      </p>

      {erreur && <p className="py-6 text-sm text-danger">{erreur}</p>}
      {!liste && !erreur && <Attente />}
      {liste?.length === 0 && (
        <p className="animate-fade py-12 text-center text-sm text-texte-2">{etat === "ouverts" ? "Aucun signalement à examiner." : "Aucun signalement traité."}</p>
      )}
      <div className="mt-5 space-y-5">
        {liste?.map((s, i) => (
          <CarteSignalement
            key={s.id}
            s={s}
            rang={i}
            onOuvrirCompte={onOuvrirCompte}
            onDecider={(decision) => (decision === "classe" ? decider(s, decision) : setAction({ s, decision }))}
          />
        ))}
      </div>

      <Apparition>
        {action?.decision === "suspendu" && (
          <DialogueAction
            titre={`Suspendre ${action.s.cible.nom} ?`}
            confirmer="Suspendre"
            danger
            motif
            explication={
              action.s.surLaCible > 1
                ? `Les ${action.s.surLaCible} signalements ouverts sur ce compte seront traités ensemble.`
                : "Ses appareils sont déconnectés, la connexion lui est refusée et on ne peut plus lui écrire."
            }
            onAgir={(motif) => decider(action.s, "suspendu", motif)}
            onFermer={() => setAction(null)}
          />
        )}
        {action?.decision === "groupe_ferme" && (
          <DialogueAction
            titre={`Fermer le groupe « ${action.s.cible.nom} » ?`}
            confirmer="Fermer le groupe"
            danger
            motif
            explication="Chaque membre en est averti dans la discussion, puis le groupe et ses fichiers disparaissent. Sans retour possible."
            onAgir={(motif) => decider(action.s, "groupe_ferme", motif)}
            onFermer={() => setAction(null)}
          />
        )}
      </Apparition>
    </div>
  );
}

/** Un signalement : qui, quoi, les messages joints, et la suite donnée. */
export function CarteSignalement({
  s,
  rang = 0,
  compacte,
  onOuvrirCompte,
  onDecider,
}: {
  s: SignalementAdmin;
  rang?: number;
  /** Dans la fiche d'un compte : ni actions, ni lien vers la cible. */
  compacte?: boolean;
  onOuvrirCompte?: (id: string) => void;
  onDecider?: (decision: Decision) => Promise<void> | void;
}) {
  const [enCours, setEnCours] = useState(false);
  const Icone = s.type === "personne" ? UserRound : UsersRound;
  const ouvert = s.traiteLe === null;

  async function classer() {
    setEnCours(true);
    try {
      await onDecider?.("classe");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <article className={clsx("border border-bordure", rang < 6 && `animate-rise stagger-${rang + 1}`)}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-bordure bg-entete px-4 py-3">
        <Icone size={18} className="shrink-0 text-texte-2" />
        {!compacte && s.type === "personne" && s.cible.existe && onOuvrirCompte ? (
          <button type="button" onClick={() => onOuvrirCompte(s.cible.id)} className="text-[15px] text-texte hover:underline">
            {s.cible.nom}
          </button>
        ) : (
          <span className="text-[15px] text-texte">{s.cible.nom}</span>
        )}
        {s.cible.pseudo && <span className="text-[13px] text-texte-2">@{s.cible.pseudo}</span>}
        {s.type === "groupe" && s.cible.existe && <span className="text-[13px] text-texte-2">
            groupe, {s.cible.membres} membre{(s.cible.membres ?? 0) > 1 ? "s" : ""}
          </span>}
        {s.cible.admin && <Pastille ton="accent">Administration</Pastille>}
        {s.cible.suspenduLe && <Pastille ton="danger">Suspendu</Pastille>}
        {ouvert && s.surLaCible > 1 && (
          <Pastille ton="danger">
            <Flag size={11} /> {s.surLaCible} signalements
          </Pastille>
        )}
        <span className="ml-auto text-[12.5px] text-texte-3" title={dateHeure(s.creeLe)}>
          {quand(s.creeLe)}
        </span>
      </header>

      <div className="px-4 py-3">
        <p className="text-[12.5px] text-texte-2">
          Signalé par {s.auteur ? `${s.auteur.nom}${s.auteur.pseudo ? ` (@${s.auteur.pseudo})` : ""}` : "un compte supprimé depuis"}
          {s.messages.length === 0 && ", sans message joint"}
        </p>
        {s.messages.length > 0 && (
          <ol className="mt-3 space-y-2">
            {s.messages.map((m) => (
              <li key={m.id} className="border-l-2 border-bordure pl-3">
                <p className="text-[12px] text-texte-3">
                  {s.auteurs[m.de]} · {dateHeure(m.le)}
                </p>
                {m.media && (
                  <p className="flex items-center gap-1.5 text-[13px] text-texte-2">
                    <Paperclip size={13} /> {m.media.type === "image" ? "Photo" : m.media.type === "video" ? "Vidéo" : m.media.type === "audio" ? "Audio" : "Document"} : {m.media.nom}
                  </p>
                )}
                {m.texte && <p className="text-[14px] whitespace-pre-wrap break-words text-texte">{m.texte}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>

      {!ouvert ? (
        <footer className="flex items-center gap-2 border-t border-bordure px-4 py-2.5 text-[12.5px] text-texte-2">
          <Check size={14} /> {DECISIONS[s.decision ?? "classe"]}
          {s.traitePar && ` par ${s.traitePar}`}, {quand(s.traiteLe!)}
        </footer>
      ) : (
        !compacte &&
        onDecider && (
          <footer className="flex flex-wrap gap-2 border-t border-bordure px-4 py-3">
            <button
              type="button"
              disabled={enCours}
              onClick={() => void classer()}
              className="inline-flex items-center gap-2 rounded-full border border-bordure px-4 py-1.5 text-[13.5px] text-texte transition-colors hover:bg-survol disabled:opacity-60"
            >
              <Check size={15} /> Classer sans suite
            </button>
            {s.cible.existe && s.type === "personne" && !s.cible.suspenduLe && !s.cible.admin && (
              <button
                type="button"
                onClick={() => void onDecider("suspendu")}
                className="inline-flex items-center gap-2 rounded-full border border-danger px-4 py-1.5 text-[13.5px] text-danger transition-colors hover:bg-danger-doux"
              >
                <Ban size={15} /> Suspendre le compte
              </button>
            )}
            {s.cible.existe && s.type === "groupe" && (
              <button
                type="button"
                onClick={() => void onDecider("groupe_ferme")}
                className="inline-flex items-center gap-2 rounded-full border border-danger px-4 py-1.5 text-[13.5px] text-danger transition-colors hover:bg-danger-doux"
              >
                <Ban size={15} /> Fermer le groupe
              </button>
            )}
          </footer>
        )
      )}
    </article>
  );
}
