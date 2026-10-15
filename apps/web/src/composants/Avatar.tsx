import clsx from "clsx";
import { User } from "lucide-react";
import { useState } from "react";
import { urlPhoto } from "../lib/api";

interface Props {
  id: string;
  photo: string | null;
  nom: string;
  taille: number;
  className?: string;
}

/** Photo de profil, ou silhouette neutre quand il n'y en a pas (ou qu'elle n'est pas visible). */
export function Avatar({ id, photo, nom, taille, className }: Props) {
  const [echec, setEchec] = useState<string | null>(null);
  const variante = taille > 96 ? "grande" : "petite";
  const afficherPhoto = photo && echec !== photo;
  return (
    <span
      className={clsx("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-avatar", className)}
      style={{ width: taille, height: taille }}
    >
      {afficherPhoto ? (
        <img
          src={urlPhoto(id, photo, variante)}
          alt={`Photo de ${nom}`}
          width={taille}
          height={taille}
          loading="lazy"
          decoding="async"
          onError={() => setEchec(photo)}
          className="size-full object-cover"
        />
      ) : (
        <User aria-hidden="true" className="text-avatar-icone" style={{ width: taille * 0.6, height: taille * 0.6 }} fill="currentColor" strokeWidth={0} />
      )}
    </span>
  );
}
