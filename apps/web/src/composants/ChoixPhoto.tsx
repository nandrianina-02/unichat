import { Camera, ImagePlus, LoaderCircle, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import type { Moi } from "@unichat/shared";
import { api } from "../lib/api";
import { useCompte } from "../lib/compte";
import { preparerPhoto } from "../lib/images";
import { Avatar } from "./Avatar";

/**
 * Photo de profil cliquable : au survol, « Changer la photo » ; un menu
 * propose d'en importer une nouvelle ou de supprimer l'actuelle.
 */
export function ChoixPhoto({ moi, taille }: { moi: Moi; taille: number }) {
  const { remplacer, sessionPerdue } = useCompte();
  const [menu, setMenu] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const fichier = useRef<HTMLInputElement>(null);

  async function envoyer(f: File) {
    setEnCours(true);
    setErreur(null);
    try {
      const { grande, petite } = await preparerPhoto(f);
      remplacer(await api.envoyerPhoto(grande, petite));
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
      remplacer(await api.supprimerPhoto());
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
          title="Changer la photo de profil"
        >
          <Avatar id={moi.id} photo={moi.photo} nom={moi.nom} taille={taille} />
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
            {moi.photo && (
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
