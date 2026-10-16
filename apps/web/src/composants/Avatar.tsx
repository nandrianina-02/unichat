import clsx from "clsx";
import { User, UsersRound } from "lucide-react";
import { useState } from "react";
import { urlPhoto, urlPhotoGroupe } from "../lib/api";

interface Props {
  id: string;
  photo: string | null;
  nom: string;
  taille: number;
  className?: string;
}

/** Photo d'un groupe, ou pictogramme quand il n'en a pas. */
export function AvatarGroupe({
  taille,
  className,
  groupeId,
  photo,
}: {
  taille: number;
  className?: string;
  groupeId?: string;
  photo?: string | null;
}) {
  const [echec, setEchec] = useState<string | null>(null);
  const afficherPhoto = groupeId && photo && echec !== photo;
  return (
    <span
      className={clsx("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-avatar", className)}
      style={{ width: taille, height: taille }}
      aria-hidden="true"
    >
      {afficherPhoto ? (
        <img
          src={urlPhotoGroupe(groupeId, photo, taille > 96 ? "grande" : "petite")}
          alt=""
          width={taille}
          height={taille}
          loading="lazy"
          decoding="async"
          onError={() => setEchec(photo)}
          className="size-full object-cover"
        />
      ) : (
        <UsersRound className="text-avatar-icone" style={{ width: taille * 0.55, height: taille * 0.55 }} />
      )}
    </span>
  );
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
