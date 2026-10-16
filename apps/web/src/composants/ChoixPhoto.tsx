import { Camera, ImagePlus, LoaderCircle, Trash2 } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import type { Groupe, Moi } from "@unichat/shared";
import { api } from "../lib/api";
import { useCompte } from "../lib/compte";
import { preparerPhoto } from "../lib/images";
import { useMessagerie } from "../lib/messagerie-react";
import { Avatar, AvatarGroupe } from "./Avatar";

/**
 * Image ronde cliquable : au survol, « Changer la photo » ; un menu propose
 * d'en importer une nouvelle ou de supprimer l'actuelle. Sert au profil et
 * aux groupes.
 */
function ChoixImage({
  image,
  aPhoto,
  libelle,
  onEnvoyer,
  onSupprimer,
}: {
  image: ReactNode;
  aPhoto: boolean;
  libelle: string;
  onEnvoyer: (grande: Blob, petite: Blob) => Promise<void>;
  onSupprimer: () => Promise<void>;
}) {
  const { sessionPerdue } = useCompte();
  const [menu, setMenu] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const fichier = useRef<HTMLInputElement>(null);

  async function envoyer(f: File) {
    setEnCours(true);
    setErreur(null);
    try {
      const { grande, petite } = await preparerPhoto(f);
      await onEnvoyer(grande, petite);
    } catch (e) {
      if (!sessionPerdue(e)) setErreur(e instanceof Error ? e.message : "La photo n'a pas pu être enregistrée.");
    } finally {
      setEnCours(false);
    }
  }

  async function supprimer() {
    setMenu(false);
    setEnCours(true);
    try {
      await onSupprimer();
    } catch (e) {
      if (!sessionPerdue(e)) setErreur("La photo n'a pas pu être supprimée.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <button
          type="button"
          onClick={() => setMenu((m) => !m)}
          aria-haspopup="menu"
          aria-expanded={menu}
          className="group relative block rounded-full"
          title={libelle}
        >
          {image}
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-full bg-voile text-center text-xs uppercase leading-snug text-sur-primaire opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            {enCours ? <LoaderCircle size={24} className="animate-spin" /> : <Camera size={24} />}
            <span className="px-6">Changer la photo</span>
          </span>
          {enCours && (
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-voile text-sur-primaire">
              <LoaderCircle size={28} className="animate-spin" />
            </span>
          )}
        </button>
        {menu && (
          <div
            role="menu"
            className="animate-pop absolute top-1/2 left-1/2 z-20 w-56 rounded-lg bg-panneau py-2 shadow-xl ring-1 ring-bordure"
          >
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setMenu(false);
                fichier.current?.click();
              }}
              className="flex w-full items-center gap-3 px-5 py-2.5 text-left text-sm text-texte hover:bg-survol"
            >
              <ImagePlus size={18} className="text-texte-2" /> Importer une photo
            </button>
            {aPhoto && (
              <button
                role="menuitem"
                type="button"
                onClick={() => void supprimer()}
                className="flex w-full items-center gap-3 px-5 py-2.5 text-left text-sm text-texte hover:bg-survol"
              >
                <Trash2 size={18} className="text-texte-2" /> Supprimer la photo
              </button>
            )}
          </div>
        )}
      </div>
      <input
        ref={fichier}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void envoyer(f);
        }}
      />
      {erreur && <p className="animate-fade mt-3 text-center text-xs text-danger">{erreur}</p>}
    </div>
  );
}

export function ChoixPhoto({ moi, taille }: { moi: Moi; taille: number }) {
  const { remplacer } = useCompte();
  return (
    <ChoixImage
      image={<Avatar id={moi.id} photo={moi.photo} nom={moi.nom} taille={taille} />}
      aPhoto={Boolean(moi.photo)}
      libelle="Changer la photo de profil"
      onEnvoyer={async (grande, petite) => remplacer(await api.envoyerPhoto(grande, petite))}
      onSupprimer={async () => remplacer(await api.supprimerPhoto())}
    />
  );
}

/** Photo d'un groupe, modifiable par ses administrateurs. */
export function ChoixPhotoGroupe({ groupe, taille }: { groupe: Groupe; taille: number }) {
  const { messagerie } = useMessagerie();
  return (
    <ChoixImage
      image={<AvatarGroupe taille={taille} groupeId={groupe.id} photo={groupe.photo} />}
      aPhoto={Boolean(groupe.photo)}
      libelle="Changer la photo du groupe"
      onEnvoyer={async (grande, petite) => messagerie.retenirGroupe(await api.envoyerPhotoGroupe(groupe.id, grande, petite))}
      onSupprimer={async () => messagerie.retenirGroupe(await api.supprimerPhotoGroupe(groupe.id))}
    />
  );
}
