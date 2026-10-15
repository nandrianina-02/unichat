import { schemaPseudo } from "@unichat/shared";
import { useEffect, useState } from "react";
import { ErreurApi, api } from "./api";

/** Nom d'utilisateur proposé d'après le nom : « Ana Rakoto » donne « ana.rakoto ». */
export function suggestionPseudo(nom: string): string {
  const base = nom
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^[^a-z]+/, "")
    .replace(/\.+$/, "")
    .slice(0, 30)
    .replace(/\.+$/, "");
  return schemaPseudo.safeParse(base).success ? base : "";
}

export type EtatPseudo =
  | { etat: "vide" }
  | { etat: "verification" }
  | { etat: "disponible"; pseudo: string }
  | { etat: "indisponible"; message: string };

/** Vérifie la disponibilité pendant la saisie, une demi-seconde après la dernière frappe. */
export function useDisponibilite(saisie: string, actuel: string | null = null): EtatPseudo {
  const [etat, setEtat] = useState<EtatPseudo>({ etat: "vide" });

  useEffect(() => {
    const texte = saisie.trim().replace(/^@/, "");
    if (!texte) {
      setEtat({ etat: "vide" });
      return;
    }
    const local = schemaPseudo.safeParse(texte);
    if (!local.success) {
      setEtat({ etat: "indisponible", message: local.error.issues[0]?.message ?? "Nom invalide." });
      return;
    }
    if (local.data === actuel) {
      setEtat({ etat: "disponible", pseudo: local.data });
      return;
    }
    setEtat({ etat: "verification" });
    const controle = new AbortController();
    const minuterie = setTimeout(() => {
      api
        .pseudoDisponible(local.data, controle.signal)
        .then((r) =>
          setEtat(
            r.disponible
              ? { etat: "disponible", pseudo: local.data }
              : { etat: "indisponible", message: r.message ?? "Ce nom d'utilisateur est déjà pris." },
          ),
        )
        .catch((e) => {
          if (controle.signal.aborted) return;
          setEtat({ etat: "indisponible", message: e instanceof ErreurApi ? e.message : "Vérification impossible." });
        });
    }, 450);
    return () => {
      clearTimeout(minuterie);
      controle.abort();
    };
  }, [saisie, actuel]);

  return etat;
}
