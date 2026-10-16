import { AJOUTS_GROUPES, VISIBILITES, VISIBILITES_EN_LIGNE, type AjoutGroupes, type MajProfil, type Visibilite, type VisibiliteEnLigne } from "@unichat/shared";
import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Interrupteur } from "../composants/Interrupteur";
import { TitreSection } from "../composants/Lignes";
import { EnTetePanneau } from "../composants/Panneau";
import { ErreurApi, api } from "../lib/api";
import { useCompte, useMoi } from "../lib/compte";
import type { Vue } from "./vues";

const LIBELLES: Record<Visibilite, string> = {
  tous: "Tout le monde",
  contacts: "Mes contacts",
  personne: "Personne",
};

function useEnregistrement() {
  const { remplacer, sessionPerdue } = useCompte();
  const [erreur, setErreur] = useState<string | null>(null);
  const enregistrer = async (changement: MajProfil) => {
    setErreur(null);
    try {
      remplacer(await api.majProfil(changement));
    } catch (e) {
      if (!sessionPerdue(e)) setErreur(e instanceof ErreurApi ? e.message : "Le réglage n'a pas été enregistré.");
    }
  };
  return { enregistrer, erreur };
}

export function Confidentialite({ onRetour, onOuvrir }: { onRetour: () => void; onOuvrir: (vue: Vue) => void }) {
  const moi = useMoi();
  const { enregistrer, erreur } = useEnregistrement();
  const [bloques, setBloques] = useState<number | null>(null);

  useEffect(() => {
    api.bloques().then(
      (r) => setBloques(r.bloques.length),
      () => setBloques(null),
    );
  }, []);

  const ligne = (titre: string, valeur: string, vue: Vue) => (
    <button type="button" onClick={() => onOuvrir(vue)} className="flex w-full items-center px-7 text-left transition-colors hover:bg-survol">
      <span className="flex-1 border-b border-bordure py-4">
        <span className="block text-[16px] text-texte">{titre}</span>
        <span className="mt-0.5 block text-[14px] text-texte-2">{valeur}</span>
      </span>
    </button>
  );
  const vuEtEnLigne =
    moi.enLigne === "tous" && moi.visibiliteVu !== "tous" ? `${LIBELLES[moi.visibiliteVu]}, en ligne : tout le monde` : LIBELLES[moi.visibiliteVu];

  return (
    <>
      <EnTetePanneau titre="Confidentialité" onRetour={onRetour} />
      <div className="animate-fade min-h-0 flex-1 overflow-y-auto">
        <TitreSection>Qui peut voir mes informations personnelles</TitreSection>
        {ligne("Dernière connexion et en ligne", vuEtEnLigne, "visibilite-vu")}
        {ligne("Photo de profil", LIBELLES[moi.visibilitePhoto], "visibilite-photo")}
        {ligne("Infos", LIBELLES[moi.visibiliteInfos], "visibilite-infos")}
        {ligne("Groupes", AJOUTS[moi.ajoutGroupes], "ajout-groupes")}
        <div className="flex items-center gap-4 px-7">
          <div className="flex-1 border-b border-bordure py-4">
            <p className="text-[16px] text-texte">Confirmations de lecture</p>
            <p className="mt-0.5 text-[14px] leading-relaxed text-texte-2">
              Désactivées, vous n'envoyez ni ne voyez de confirmations de lecture dans les discussions à deux. Elles restent
              envoyées dans les groupes.
            </p>
          </div>
          <Interrupteur
            libelle="Confirmations de lecture"
            actif={moi.confirmationsLecture}
            onChange={(confirmationsLecture) => void enregistrer({ confirmationsLecture })}
          />
        </div>
        <TitreSection>Recherche</TitreSection>
        <div className="flex items-center gap-4 px-7">
          <div className="flex-1 border-b border-bordure py-4">
            <p className="text-[16px] text-texte">Me trouver avec mon adresse e-mail</p>
            <p className="mt-0.5 text-[14px] leading-relaxed text-texte-2">
              Désactivé, seules les personnes qui connaissent votre nom d'utilisateur peuvent vous trouver.
            </p>
          </div>
          <Interrupteur
            libelle="Me trouver avec mon adresse e-mail"
            actif={moi.trouvableParEmail}
            onChange={(trouvableParEmail) => void enregistrer({ trouvableParEmail })}
          />
        </div>
        <TitreSection>Contacts</TitreSection>
        <button
          type="button"
          onClick={() => onOuvrir("bloques")}
          className="flex w-full items-center gap-3 px-7 text-left transition-colors hover:bg-survol"
        >
          <span className="flex-1 border-b border-bordure py-4">
            <span className="block text-[16px] text-texte">Contacts bloqués</span>
            <span className="mt-0.5 block text-[14px] text-texte-2">{bloques === null ? "…" : bloques === 0 ? "Aucun" : bloques}</span>
          </span>
          <ChevronRight size={18} className="text-texte-3" />
        </button>
        {erreur && <p className="animate-fade px-7 py-3 text-sm text-danger">{erreur}</p>}
      </div>
    </>
  );
}

const AJOUTS: Record<AjoutGroupes, string> = { tous: "Tout le monde", contacts: "Mes contacts" };
const EN_LIGNE: Record<VisibiliteEnLigne, string> = { tous: "Tout le monde", comme_vu: "Identique à la dernière connexion" };

/** Choix exclusif, présenté comme les réglages de WhatsApp. */
function Options<V extends string>({
  nom,
  titre,
  valeurs,
  libelles,
  actuelle,
  onChoisir,
}: {
  nom: string;
  titre: string;
  valeurs: readonly V[];
  libelles: Record<V, string>;
  actuelle: V;
  onChoisir: (v: V) => void;
}) {
  return (
    <>
      <TitreSection>{titre}</TitreSection>
      <div role="radiogroup" aria-label={titre}>
        {valeurs.map((v) => (
          <label key={v} className="flex cursor-pointer items-center gap-6 px-7 py-3.5 transition-colors hover:bg-survol">
            <input type="radio" name={nom} checked={actuelle === v} onChange={() => onChoisir(v)} className="sr-only" />
            <span
              aria-hidden="true"
              className={clsx(
                "flex size-5 items-center justify-center rounded-full border-2 transition-colors",
                actuelle === v ? "border-primaire" : "border-texte-3",
              )}
            >
              {actuelle === v && <span className="animate-fade size-2.5 rounded-full bg-primaire" />}
            </span>
            <span className="text-[16px] text-texte">{libelles[v]}</span>
          </label>
        ))}
      </div>
    </>
  );
}

export function ChoixVu({ onRetour }: { onRetour: () => void }) {
  const moi = useMoi();
  const { enregistrer, erreur } = useEnregistrement();
  return (
    <>
      <EnTetePanneau titre="Dernière connexion et en ligne" onRetour={onRetour} />
      <div className="animate-fade min-h-0 flex-1 overflow-y-auto">
        <Options
          nom="visibilite-vu"
          titre="Qui peut voir ma dernière connexion"
          valeurs={VISIBILITES}
          libelles={LIBELLES}
          actuelle={moi.visibiliteVu}
          onChoisir={(visibiliteVu) => void enregistrer({ visibiliteVu })}
        />
        <Options
          nom="en-ligne"
          titre="Qui peut voir quand je suis en ligne"
          valeurs={VISIBILITES_EN_LIGNE}
          libelles={EN_LIGNE}
          actuelle={moi.enLigne}
          onChoisir={(enLigne) => void enregistrer({ enLigne })}
        />
        <p className="px-7 py-4 text-[13px] leading-relaxed text-texte-3">
          Si vous ne partagez pas votre dernière connexion, vous ne pourrez pas voir celle des autres.
        </p>
        {erreur && <p className="animate-fade px-7 text-sm text-danger">{erreur}</p>}
      </div>
    </>
  );
}

export function ChoixAjoutGroupes({ onRetour }: { onRetour: () => void }) {
  const moi = useMoi();
  const { enregistrer, erreur } = useEnregistrement();
  return (
    <>
      <EnTetePanneau titre="Groupes" onRetour={onRetour} />
      <div className="animate-fade min-h-0 flex-1 overflow-y-auto">
        <Options
          nom="ajout-groupes"
          titre="Qui peut m'ajouter aux groupes"
          valeurs={AJOUTS_GROUPES}
          libelles={AJOUTS}
          actuelle={moi.ajoutGroupes}
          onChoisir={(ajoutGroupes) => void enregistrer({ ajoutGroupes })}
        />
        <p className="px-7 py-4 text-[13px] leading-relaxed text-texte-3">
          « Mes contacts » : seules les personnes que vous avez ajoutées peuvent vous ajouter directement. Les autres
          peuvent vous envoyer le lien d'invitation du groupe.
        </p>
        {erreur && <p className="animate-fade px-7 text-sm text-danger">{erreur}</p>}
      </div>
    </>
  );
}

export function ChoixVisibilite({ champ, onRetour }: { champ: "photo" | "infos"; onRetour: () => void }) {
  const moi = useMoi();
  const { enregistrer, erreur } = useEnregistrement();
  const actuelle = champ === "photo" ? moi.visibilitePhoto : moi.visibiliteInfos;
  const titre = champ === "photo" ? "Photo de profil" : "Infos";

  return (
    <>
      <EnTetePanneau titre={titre} onRetour={onRetour} />
      <div className="animate-fade min-h-0 flex-1 overflow-y-auto">
        <TitreSection>Qui peut voir {champ === "photo" ? "ma photo de profil" : "mes infos"}</TitreSection>
        <div role="radiogroup" aria-label={titre}>
          {VISIBILITES.map((v) => (
            <label key={v} className="flex cursor-pointer items-center gap-6 px-7 py-3.5 transition-colors hover:bg-survol">
              <input
                type="radio"
                name={`visibilite-${champ}`}
                checked={actuelle === v}
                onChange={() => void enregistrer(champ === "photo" ? { visibilitePhoto: v } : { visibiliteInfos: v })}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={clsx(
                  "flex size-5 items-center justify-center rounded-full border-2 transition-colors",
                  actuelle === v ? "border-primaire" : "border-texte-3",
                )}
              >
                {actuelle === v && <span className="animate-fade size-2.5 rounded-full bg-primaire" />}
              </span>
              <span className="text-[16px] text-texte">{LIBELLES[v]}</span>
            </label>
          ))}
        </div>
        <p className="px-7 py-4 text-[13px] leading-relaxed text-texte-3">
          « Mes contacts » désigne les personnes que vous avez ajoutées. Ajouter quelqu'un ne donne pas accès à ses
          informations : c'est lui qui en décide.
        </p>
        {erreur && <p className="animate-fade px-7 text-sm text-danger">{erreur}</p>}
      </div>
    </>
  );
}
