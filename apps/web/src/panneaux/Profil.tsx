import { LIMITES, schemaInfos, schemaNom, schemaPseudo } from "@unichat/shared";
import type { MajProfil } from "@unichat/shared";
import { ChampModifiable } from "../composants/ChampModifiable";
import { ChoixPhoto } from "../composants/ChoixPhoto";
import { EnTetePanneau } from "../composants/Panneau";
import { ErreurApi, api } from "../lib/api";
import { useCompte, useMoi } from "../lib/compte";

export function Profil({ onRetour }: { onRetour: () => void }) {
  const moi = useMoi();
  const { remplacer, sessionPerdue } = useCompte();

  async function enregistrer(changement: MajProfil): Promise<string | null> {
    try {
      remplacer(await api.majProfil(changement));
      return null;
    } catch (e) {
      if (sessionPerdue(e)) return null;
      return e instanceof ErreurApi ? e.message : "L'enregistrement a échoué.";
    }
  }

  const premiereErreur = (resultat: { success: boolean; error?: { issues: { message: string }[] } }) =>
    resultat.success ? null : (resultat.error?.issues[0]?.message ?? "Valeur invalide.");

  return (
    <>
      <EnTetePanneau titre="Profil" onRetour={onRetour} />
      <div className="min-h-0 flex-1 overflow-y-auto bg-fond">
        <div className="animate-fade flex justify-center py-7">
          <ChoixPhoto moi={moi} taille={200} />
        </div>
        <div className="animate-rise stagger-1 bg-panneau">
          <ChampModifiable
            libelle="Votre nom"
            valeur={moi.nom}
            maximum={LIMITES.nom}
            valider={(v) => premiereErreur(schemaNom.safeParse(v))}
            enregistrer={(nom) => enregistrer({ nom })}
          />
        </div>
        <p className="px-8 py-4 text-[13px] leading-relaxed text-texte-3">
          Ce n'est ni un nom d'utilisateur ni un code : ce nom est visible par les personnes avec qui vous discutez.
        </p>
        <div className="animate-rise stagger-2 bg-panneau">
          <ChampModifiable
            libelle="Infos"
            valeur={moi.infos}
            maximum={LIMITES.infos}
            valider={(v) => premiereErreur(schemaInfos.safeParse(v))}
            enregistrer={(infos) => enregistrer({ infos })}
          />
        </div>
        <div className="animate-rise stagger-3 mt-2.5 bg-panneau">
          <ChampModifiable
            libelle="Nom d'utilisateur"
            valeur={moi.pseudo ?? ""}
            prefixe="@"
            maximum={LIMITES.pseudoMax}
            valider={(v) => premiereErreur(schemaPseudo.safeParse(v))}
            enregistrer={(pseudo) => enregistrer({ pseudo })}
          />
        </div>
        <p className="px-8 py-4 text-[13px] leading-relaxed text-texte-3">
          Vos contacts vous trouvent avec ce nom d'utilisateur. Un changement est noté dans l'activité du compte.
        </p>
      </div>
    </>
  );
}
