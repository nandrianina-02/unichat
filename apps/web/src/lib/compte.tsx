import type { Moi } from "@unichat/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ErreurApi, api } from "./api";
import { desactiverPush } from "./notifications";

type Etat =
  | { etat: "chargement" }
  | { etat: "deconnecte"; motif: string | null }
  | { etat: "connecte"; moi: Moi };

interface Compte {
  etat: Etat;
  /** Remplace le profil après une modification (la réponse de l'API fait foi). */
  remplacer: (moi: Moi) => void;
  deconnecter: () => Promise<void>;
  /** Après la suppression du compte : retour à l'accueil et effacement de l'historique local. */
  compteSupprime: (utilisateurId: string) => void;
  /** Appelé quand l'API répond 401 en cours de route : la session a été fermée ailleurs. */
  sessionPerdue: (erreur: unknown) => boolean;
}

const Contexte = createContext<Compte | null>(null);

/**
 * Profil gardé sur l'appareil, comme l'historique : sans réseau, l'application
 * s'ouvre quand même (comme WhatsApp) ; la session est revérifiée au retour
 * du réseau, et une session fermée entre-temps ramène à la connexion.
 */
const CLE_MOI = "unichat.moi";

function moiGarde(): Moi | null {
  try {
    const garde = JSON.parse(localStorage.getItem(CLE_MOI) ?? "null") as Moi | null;
    return garde && typeof garde.id === "string" ? garde : null;
  } catch {
    return null;
  }
}

function garderMoi(moi: Moi | null): void {
  try {
    if (moi) localStorage.setItem(CLE_MOI, JSON.stringify(moi));
    else localStorage.removeItem(CLE_MOI);
  } catch {
    // Stockage refusé : pas d'ouverture hors connexion, rien d'autre ne change.
  }
}

export function FournisseurCompte({ children }: { children: ReactNode }) {
  const [etat, setEtat] = useState<Etat>({ etat: "chargement" });

  useEffect(() => {
    const connecter = (moi: Moi) => {
      garderMoi(moi);
      setEtat({ etat: "connecte", moi });
    };
    api
      .moi()
      .then(connecter)
      .catch((erreur) => {
        if (erreur instanceof ErreurApi && erreur.statut === 401) {
          garderMoi(null);
          setEtat({ etat: "deconnecte", motif: null });
          return;
        }
        const garde = moiGarde();
        if (!garde) {
          setEtat({ etat: "deconnecte", motif: "reseau" });
          return;
        }
        setEtat({ etat: "connecte", moi: garde });
        // Au retour du réseau, le profil est relu (il a pu changer sur un autre appareil).
        window.addEventListener("online", () => void api.moi().then(connecter, () => {}), { once: true });
      });
  }, []);

  const sessionPerdue = useCallback((erreur: unknown) => {
    if (erreur instanceof ErreurApi && erreur.statut === 401) {
      garderMoi(null);
      setEtat({ etat: "deconnecte", motif: erreur.code === "session_compromise" ? "session_compromise" : "session_fermee" });
      return true;
    }
    return false;
  }, []);

  const valeur = useMemo<Compte>(
    () => ({
      etat,
      remplacer: (moi) => {
        garderMoi(moi);
        setEtat({ etat: "connecte", moi });
      },
      deconnecter: async () => {
        garderMoi(null);
        await desactiverPush();
        await api.deconnexion().catch(() => {});
        setEtat({ etat: "deconnecte", motif: null });
      },
      compteSupprime: (utilisateurId) => {
        garderMoi(null);
        setEtat({ etat: "deconnecte", motif: "compte_supprime" });
        // La base locale est fermée en quittant l'application ; sa suppression
        // attend cette fermeture, puis efface les messages gardés ici.
        indexedDB.deleteDatabase(`unichat-${utilisateurId}`);
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
