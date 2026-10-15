import { LIMITES, schemaNom } from "@unichat/shared";
import clsx from "clsx";
import { ArrowRight, AtSign, Check, CircleAlert, LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Cadre } from "../composants/Cadre";
import { ChoixPhoto } from "../composants/ChoixPhoto";
import { ErreurApi, api } from "../lib/api";
import { useCompte, useMoi } from "../lib/compte";
import { suggestionPseudo, useDisponibilite } from "../lib/pseudo";

/** Première connexion : nom, photo et nom d'utilisateur, avant d'entrer dans l'application. */
export function Bienvenue() {
  const moi = useMoi();
  const { remplacer, deconnecter, sessionPerdue } = useCompte();
  const [nom, setNom] = useState(moi.nom);
  const [pseudo, setPseudo] = useState(() => suggestionPseudo(moi.nom));
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const disponibilite = useDisponibilite(pseudo);
  const nomValide = schemaNom.safeParse(nom);

  async function continuer(e: FormEvent) {
    e.preventDefault();
    if (!nomValide.success || disponibilite.etat !== "disponible") return;
    setEnCours(true);
    setErreur(null);
    try {
      remplacer(await api.majProfil({ nom: nomValide.data, pseudo: disponibilite.pseudo }));
    } catch (erreurApi) {
      if (!sessionPerdue(erreurApi)) {
        setErreur(erreurApi instanceof ErreurApi ? erreurApi.message : "L'enregistrement a échoué. Réessayez.");
      }
      setEnCours(false);
    }
  }

  return (
    <Cadre>
      <form onSubmit={continuer} className="animate-rise mx-auto max-w-xl rounded-lg bg-panneau p-8 shadow-sm sm:p-12">
        <h1 className="text-[26px] font-light text-texte">Votre profil</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-texte-2">
          Indiquez votre nom et choisissez un nom d'utilisateur : c'est avec lui que vos proches vous trouvent sur UniChat.
        </p>

        <div className="mt-8 flex justify-center">
          <ChoixPhoto moi={moi} taille={128} />
        </div>

        <label className="animate-rise stagger-2 mt-8 block">
          <span className="text-sm text-primaire">Votre nom</span>
          <div className="mt-2 flex items-center gap-2 border-b-2 border-bordure pb-1 focus-within:border-primaire">
            <input
              value={nom}
              maxLength={LIMITES.nom}
              onChange={(e) => setNom(e.target.value)}
              autoComplete="name"
              className="min-w-0 flex-1 bg-transparent py-1.5 text-[16px] text-texte outline-none"
            />
            <span className="text-xs tabular-nums text-texte-3">{LIMITES.nom - nom.length}</span>
          </div>
          <span className="mt-2 block text-[13px] text-texte-3">Visible par les personnes avec qui vous discutez.</span>
        </label>

        <label className="animate-rise stagger-3 mt-7 block">
          <span className="text-sm text-primaire">Nom d'utilisateur</span>
          <div
            className={clsx(
              "mt-2 flex items-center gap-2 border-b-2 pb-1",
              disponibilite.etat === "indisponible" ? "border-danger" : "border-bordure focus-within:border-primaire",
            )}
          >
            <AtSign size={18} className="text-texte-3" />
            <input
              value={pseudo}
              maxLength={LIMITES.pseudoMax + 1}
              onChange={(e) => setPseudo(e.target.value.toLowerCase())}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent py-1.5 text-[16px] text-texte outline-none"
            />
            {disponibilite.etat === "verification" && <LoaderCircle size={18} className="animate-spin text-texte-3" />}
            {disponibilite.etat === "disponible" && <Check size={18} className="text-primaire" />}
            {disponibilite.etat === "indisponible" && <CircleAlert size={18} className="text-danger" />}
          </div>
          <span
            className={clsx(
              "mt-2 block min-h-5 text-[13px]",
              disponibilite.etat === "indisponible" ? "text-danger" : "text-texte-3",
            )}
          >
            {disponibilite.etat === "indisponible"
              ? disponibilite.message
              : disponibilite.etat === "disponible"
                ? "Disponible."
                : "Lettres, chiffres, point ou tiret bas. Vous pourrez le changer plus tard."}
          </span>
        </label>

        {erreur && (
          <p role="alert" className="animate-fade mt-4 text-sm text-danger">
            {erreur}
          </p>
        )}

        <div className="mt-8 flex items-center justify-between gap-4">
          <button type="button" onClick={() => void deconnecter()} className="text-sm text-texte-2 hover:text-texte">
            Se déconnecter
          </button>
          <button
            type="submit"
            disabled={enCours || !nomValide.success || disponibilite.etat !== "disponible"}
            className="inline-flex items-center gap-2 rounded-full bg-primaire px-6 py-2.5 text-sm font-medium text-sur-primaire transition-colors hover:bg-primaire-fort disabled:opacity-50"
          >
            {enCours ? <LoaderCircle size={18} className="animate-spin" /> : <ArrowRight size={18} />}
            Continuer
          </button>
        </div>
      </form>
    </Cadre>
  );
}
