import { ShieldCheck, UserPlus } from "lucide-react";

/** Illustration au trait : un ordinateur et un téléphone qui échangent. */
function Illustration() {
  return (
    <svg viewBox="0 0 320 200" className="w-full max-w-[320px]" aria-hidden="true">
      <rect x="40" y="38" width="190" height="122" rx="8" className="fill-panneau stroke-texte-3" strokeWidth="2" />
      <rect x="52" y="50" width="166" height="98" rx="3" className="fill-discussion" />
      <path d="M22 168h226l-10 10H32z" className="fill-bordure" />
      <rect x="66" y="64" width="78" height="16" rx="8" className="fill-panneau" />
      <rect x="120" y="88" width="84" height="16" rx="8" className="fill-primaire-doux" />
      <rect x="66" y="112" width="58" height="16" rx="8" className="fill-panneau" />
      <rect x="236" y="70" width="64" height="112" rx="10" className="fill-panneau stroke-texte-3" strokeWidth="2" />
      <rect x="244" y="84" width="48" height="80" rx="3" className="fill-discussion" />
      <rect x="250" y="94" width="28" height="9" rx="4.5" className="fill-panneau" />
      <rect x="258" y="109" width="28" height="9" rx="4.5" className="fill-primaire-doux" />
      <rect x="250" y="124" width="22" height="9" rx="4.5" className="fill-panneau" />
      <circle cx="268" cy="173" r="3" className="fill-texte-3" />
      <circle cx="232" cy="30" r="14" className="fill-primaire" />
      <path d="M226 30.5l4 4 8-8" fill="none" className="stroke-sur-primaire" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Accueil({ onAjouter }: { onAjouter: () => void }) {
  return (
    <section className="relative flex h-full w-full flex-col items-center justify-center bg-entete px-10 text-center">
      <div className="animate-rise flex flex-col items-center">
        <Illustration />
        <h1 className="mt-10 text-[32px] font-light text-texte">UniChat Web</h1>
        <p className="mt-4 max-w-md text-sm leading-6 text-texte-2">
          Discutez depuis votre ordinateur, avec les mêmes contacts que sur votre téléphone Android. Commencez par retrouver
          vos proches avec leur nom d'utilisateur.
        </p>
        <button
          type="button"
          onClick={onAjouter}
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-primaire px-6 py-2.5 text-sm font-medium text-sur-primaire transition-colors hover:bg-primaire-fort"
        >
          <UserPlus size={18} /> Ajouter un contact
        </button>
      </div>
      <p className="absolute bottom-10 flex items-center gap-1.5 text-[13px] text-texte-3">
        <ShieldCheck size={15} /> Connexion vérifiée par Google, aucun mot de passe stocké
      </p>
    </section>
  );
}
