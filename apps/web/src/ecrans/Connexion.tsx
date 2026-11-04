import { CircleAlert, KeyRound, MonitorSmartphone, Phone, ShieldCheck, Smartphone } from "lucide-react";
import { useMemo, useState } from "react";
import { BoutonGoogle } from "../composants/BoutonGoogle";
import { ConnexionTelephone } from "../composants/ConnexionTelephone";
import { Cadre } from "../composants/Cadre";
import { estAndroid, estApplication, useInstallation } from "../lib/installation";
import { invitationEnAttente } from "../lib/invitation";

const MESSAGES: Record<string, string> = {
  connexion_annulee: "Connexion annulée. Vous pouvez recommencer quand vous voulez.",
  etat_invalide: "La connexion a expiré ou a été ouverte dans un autre navigateur. Recommencez.",
  google: "Google n'a pas pu confirmer votre identité. Réessayez.",
  email_non_verifie: "L'adresse de ce compte Google n'est pas vérifiée. Vérifiez-la chez Google, puis réessayez.",
  trop_de_demandes: "Trop de tentatives de connexion. Patientez quelques minutes avant de réessayer.",
  configuration: "La connexion Google n'est pas encore configurée sur ce serveur. La connexion par numéro reste possible.",
  session_compromise:
    "Votre session a été fermée par sécurité : une ancienne clé de connexion a été réutilisée depuis un autre endroit. Reconnectez-vous ; vos autres appareils restent connectés.",
  session_fermee: "Votre session a été fermée depuis un autre appareil, ou a expiré. Reconnectez-vous.",
  reseau: "Le serveur ne répond pas. Vérifiez votre connexion, puis rechargez la page.",
  compte_supprime: "Votre compte a été supprimé, ainsi que les messages gardés dans ce navigateur.",
  compte_suspendu: "Ce compte est suspendu pour non-respect des conditions d'utilisation d'UniChat. Les conditions indiquent comment contester la décision.",
};

const ETAPES = [
  "Choisissez Google (votre adresse e-mail) ou votre numéro de téléphone.",
  "Confirmez : compte Google, ou code reçu par SMS.",
  "Vos discussions s'ouvrent ici, sur cet appareil.",
];

const GARANTIES = [
  { icone: KeyRound, texte: "Aucun mot de passe UniChat à retenir : Google ou un code SMS confirme votre identité." },
  { icone: ShieldCheck, texte: "Avec Google, UniChat ne reçoit que votre nom, votre adresse e-mail et votre photo. Votre numéro n'est jamais affiché aux autres." },
  { icone: MonitorSmartphone, texte: "Chaque appareil connecté est visible dans vos paramètres, et se déconnecte à distance." },
];

export function Connexion({ motif }: { motif: string | null }) {
  const erreur = useMemo(() => {
    const code = new URLSearchParams(window.location.search).get("erreur") ?? motif;
    // L'erreur est lue une fois puis retirée de l'adresse : un rechargement ne la réaffiche pas.
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
    return code ? (MESSAGES[code] ?? MESSAGES.google!) : null;
  }, [motif]);
  const invitation = invitationEnAttente();
  const [parNumero, setParNumero] = useState(false);

  return (
    <Cadre>
      {erreur && (
        <div role="alert" className="animate-rise mb-4 flex items-start gap-3 rounded-lg bg-danger-doux px-4 py-3 text-sm text-texte">
          <CircleAlert size={18} className="mt-0.5 shrink-0 text-danger" />
          <p>{erreur}</p>
        </div>
      )}
      <section className="animate-rise overflow-hidden rounded-lg bg-panneau shadow-sm">
        <div className="grid gap-10 p-8 sm:p-12 md:grid-cols-[1fr_auto] md:gap-16">
          <div>
            <h1 className="text-[26px] font-light leading-tight text-texte sm:text-[30px]">Connectez-vous à UniChat</h1>
            {invitation && (
              <p className="mt-3 text-[15px] text-primaire-texte">
                Connectez-vous pour ajouter <span className="font-medium">@{invitation}</span> à vos contacts.
              </p>
            )}
            <ol className="mt-8 space-y-5">
              {ETAPES.map((etape, i) => (
                <li key={etape} className={`animate-rise stagger-${i + 1} flex items-start gap-4 text-[17px] text-texte`}>
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-texte-3 text-sm text-texte-2">
                    {i + 1}
                  </span>
                  <span className="pt-0.5">{etape}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="flex flex-col items-center justify-center gap-4 md:w-72 md:border-l md:border-bordure md:pl-12">
            {parNumero ? (
              <ConnexionTelephone onRetour={() => setParNumero(false)} />
            ) : (
              <>
                <BoutonGoogle href="/api/auth/google" />
                <div className="flex w-full max-w-xs items-center gap-3 text-xs text-texte-3">
                  <span className="h-px flex-1 bg-bordure" />
                  ou
                  <span className="h-px flex-1 bg-bordure" />
                </div>
                <button
                  type="button"
                  onClick={() => setParNumero(true)}
                  className="inline-flex h-11 w-full max-w-xs items-center justify-center gap-3 rounded-full border border-bordure px-4 text-[15px] font-medium text-texte transition-colors hover:bg-survol"
                >
                  <Phone size={18} /> Continuer avec un numéro
                </button>
                <p className="max-w-xs text-center text-xs leading-relaxed text-texte-3">
                  Inscription ou connexion : la même démarche, avec Google ou avec un code reçu par SMS.
                </p>
              </>
            )}
          </div>
        </div>
        <ul className="grid gap-5 border-t border-bordure bg-entete/50 px-8 py-6 sm:px-12 md:grid-cols-3">
          {GARANTIES.map(({ icone: Icone, texte }, i) => (
            <li key={texte} className={`animate-rise stagger-${i + 4} flex items-start gap-3 text-[13px] leading-relaxed text-texte-2`}>
              <Icone size={18} className="mt-0.5 shrink-0 text-primaire" />
              {texte}
            </li>
          ))}
        </ul>
      </section>
      <footer className="mt-8 flex flex-col items-center gap-2 text-center text-[13px] text-texte-3">
        <p>UniChat, messagerie gratuite sur le web, Android et ordinateur.</p>
        <BoutonInstaller />
        <p className="flex gap-4">
          <a href="/confidentialite" className="hover:text-texte-2 hover:underline">
            Règles de confidentialité
          </a>
          <a href="/conditions" className="hover:text-texte-2 hover:underline">
            Conditions d'utilisation
          </a>
        </p>
      </footer>
    </Cadre>
  );
}

/** Sur Android : installer UniChat comme application, directement depuis Chrome. */
function BoutonInstaller() {
  const installation = useInstallation();
  if (!estAndroid() || estApplication()) return null;
  if (!installation.possible) {
    return (
      <p className="inline-flex items-center gap-1.5">
        <Smartphone size={15} /> Pour l'installer : menu ⋮ de Chrome, puis « Installer l'application ».
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void installation.installer()}
      className="inline-flex items-center gap-1.5 font-medium text-primaire-texte hover:underline"
    >
      <Smartphone size={15} /> Installer l'application
    </button>
  );
}
