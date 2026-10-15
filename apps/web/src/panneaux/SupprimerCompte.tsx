import { CircleAlert, LoaderCircle, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { EnTetePanneau } from "../composants/Panneau";
import { ErreurApi, api } from "../lib/api";
import { useCompte, useMoi } from "../lib/compte";

const EFFETS = [
  "votre profil, votre photo et votre nom d'utilisateur ;",
  "votre liste de contacts, et votre présence dans celle des autres ;",
  "les messages encore en attente de remise ;",
  "la connexion de tous vos appareils, et l'historique gardé dans ce navigateur.",
];

export function SupprimerCompte({ onRetour }: { onRetour: () => void }) {
  const moi = useMoi();
  const { compteSupprime, sessionPerdue } = useCompte();
  const [confirmation, setConfirmation] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const valide = confirmation.trim().toLowerCase().replace(/^@/, "") === moi.pseudo;

  async function supprimer(e: FormEvent) {
    e.preventDefault();
    if (!valide) return;
    setEnCours(true);
    setErreur(null);
    try {
      await api.supprimerCompte(confirmation.trim().replace(/^@/, ""));
      compteSupprime(moi.id);
    } catch (erreurApi) {
      if (!sessionPerdue(erreurApi)) setErreur(erreurApi instanceof ErreurApi ? erreurApi.message : "La suppression a échoué.");
      setEnCours(false);
    }
  }

  return (
    <>
      <EnTetePanneau titre="Supprimer mon compte" onRetour={onRetour} />
      <form onSubmit={supprimer} className="animate-fade min-h-0 flex-1 overflow-y-auto px-7 pb-8">
        <div className="flex gap-4 rounded-lg bg-danger-doux px-4 py-4">
          <CircleAlert size={22} className="mt-0.5 shrink-0 text-danger" />
          <div className="text-sm leading-relaxed text-texte">
            <p className="font-medium">La suppression est définitive. Elle efface :</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-texte-2">
              {EFFETS.map((effet) => (
                <li key={effet}>{effet}</li>
              ))}
            </ul>
          </div>
        </div>
        <p className="mt-5 text-sm leading-relaxed text-texte-2">
          Les messages déjà remis restent sur les appareils de leurs destinataires, comme une lettre reçue. Vous pourrez
          créer un nouveau compte plus tard avec le même compte Google ; il partira de zéro.
        </p>
        <label className="mt-7 block">
          <span className="text-sm text-texte">
            Pour confirmer, saisissez votre nom d'utilisateur : <span className="font-medium">@{moi.pseudo}</span>
          </span>
          <input
            value={confirmation}
            onChange={(e) => {
              setConfirmation(e.target.value);
              setErreur(null);
            }}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            className="mt-3 w-full border-b-2 border-bordure bg-transparent py-2 text-[15px] text-texte outline-none focus:border-danger"
          />
        </label>
        {erreur && <p className="animate-fade mt-3 text-sm text-danger">{erreur}</p>}
        <button
          type="submit"
          disabled={!valide || enCours}
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-danger px-5 py-2.5 text-sm font-medium text-sur-primaire transition-opacity disabled:opacity-40"
        >
          {enCours ? <LoaderCircle size={17} className="animate-spin" /> : <Trash2 size={17} />}
          Supprimer définitivement mon compte
        </button>
      </form>
    </>
  );
}
