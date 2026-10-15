import type { Moi } from "@unichat/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ErreurApi, api } from "./api";

type Etat =
  | { etat: "chargement" }
  | { etat: "deconnecte"; motif: string | null }
  | { etat: "connecte"; moi: Moi };

interface Compte {
  etat: Etat;
  /** Remplace le profil après une modification (la réponse de l'API fait foi). */
  remplacer: (moi: Moi) => void;
  deconnecter: () => Promise<void>;
  /** Appelé quand l'API répond 401 en cours de route : la session a été fermée ailleurs. */
  sessionPerdue: (erreur: unknown) => boolean;
}

const Contexte = createContext<Compte | null>(null);

export function FournisseurCompte({ children }: { children: ReactNode }) {
  const [etat, setEtat] = useState<Etat>({ etat: "chargement" });

  useEffect(() => {
    api
      .moi()
      .then((moi) => setEtat({ etat: "connecte", moi }))
      .catch((erreur) =>
        setEtat({ etat: "deconnecte", motif: erreur instanceof ErreurApi && erreur.statut === 401 ? null : "reseau" }),
      );
  }, []);

  const sessionPerdue = useCallback((erreur: unknown) => {
    if (erreur instanceof ErreurApi && erreur.statut === 401) {
      setEtat({ etat: "deconnecte", motif: erreur.code === "session_compromise" ? "session_compromise" : "session_fermee" });
      return true;
    }
    return false;
  }, []);

  const valeur = useMemo<Compte>(
    () => ({
      etat,
      remplacer: (moi) => setEtat({ etat: "connecte", moi }),
      deconnecter: async () => {
        await api.deconnexion().catch(() => {});
        setEtat({ etat: "deconnecte", motif: null });
      },
      sessionPerdue,
    }),
    [etat, sessionPerdue],
  );
  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

export function useCompte(): Compte {
  const compte = useContext(Contexte);
  if (!compte) throw new Error("useCompte hors de FournisseurCompte");
  return compte;
}

/** Le profil de la personne connectée ; à n'utiliser que dans l'application connectée. */
export function useMoi(): Moi {
  const { etat } = useCompte();
  if (etat.etat !== "connecte") throw new Error("useMoi sans session");
  return etat.moi;
}
