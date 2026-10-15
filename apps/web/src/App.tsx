import { Chargement } from "./composants/Chargement";
import { Application } from "./ecrans/Application";
import { Bienvenue } from "./ecrans/Bienvenue";
import { Connexion } from "./ecrans/Connexion";
import { useCompte } from "./lib/compte";
import { FournisseurMessagerie } from "./lib/messagerie-react";

export function App() {
  const { etat } = useCompte();
  if (etat.etat === "chargement") return <Chargement />;
  if (etat.etat === "deconnecte") return <Connexion motif={etat.motif} />;
  // L'accueil n'est terminé qu'une fois un nom d'utilisateur choisi.
  if (!etat.moi.pseudo) return <Bienvenue />;
  return (
    <FournisseurMessagerie>
      <Application />
    </FournisseurMessagerie>
  );
}
