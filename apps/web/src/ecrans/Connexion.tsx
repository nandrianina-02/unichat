import { CircleAlert, KeyRound, MonitorSmartphone, ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import { BoutonGoogle } from "../composants/BoutonGoogle";
import { Cadre } from "../composants/Cadre";
import { invitationEnAttente } from "../lib/invitation";

const MESSAGES: Record<string, string> = {
  connexion_annulee: "Connexion annulée. Vous pouvez recommencer quand vous voulez.",
  etat_invalide: "La connexion a expiré ou a été ouverte dans un autre navigateur. Recommencez.",
  google: "Google n'a pas pu confirmer votre identité. Réessayez.",
  email_non_verifie: "L'adresse de ce compte Google n'est pas vérifiée. Vérifiez-la chez Google, puis réessayez.",
  trop_de_demandes: "Trop de tentatives de connexion. Patientez quelques minutes avant de réessayer.",
  configuration: "La connexion Google n'est pas encore configurée sur ce serveur.",
  session_compromise:
    "Votre session a été fermée par sécurité : une ancienne clé de connexion a été réutilisée depuis un autre endroit. Reconnectez-vous ; vos autres appareils restent connectés.",
  session_fermee: "Votre session a été fermée depuis un autre appareil, ou a expiré. Reconnectez-vous.",
  reseau: "Le serveur ne répond pas. Vérifiez votre connexion, puis rechargez la page.",
};

const ETAPES = [
  "Cliquez sur « Continuer avec Google ».",
  "Choisissez votre compte Google, ou connectez-vous.",
  "Vos discussions s'ouvrent ici, sur cet appareil.",
];

const GARANTIES = [
  { icone: KeyRound, texte: "Aucun mot de passe UniChat à retenir : Google confirme votre identité." },
  { icone: ShieldCheck, texte: "UniChat ne reçoit que votre nom, votre adresse e-mail et votre photo. Aucun accès à vos données Google." },
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
            <BoutonGoogle href="/api/auth/google" />
            <p className="max-w-xs text-center text-xs leading-relaxed text-texte-3">
              Une fenêtre Google s'ouvre ; vous revenez ensuite automatiquement ici.
            </p>
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
      <p className="mt-8 text-center text-[13px] text-texte-3">UniChat, sur le web, Android et ordinateur.</p>
    </Cadre>
  );
}
