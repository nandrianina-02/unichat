import { afficherTelephone, normaliserTelephone, MESSAGE_TELEPHONE, type DemandeConnexionTelephone } from "@unichat/shared";
import { ArrowLeft, LoaderCircle, Phone } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { ErreurApi, api } from "../lib/api";

/** Délai avant de pouvoir redemander un code : le SMS met parfois une minute à arriver. */
const ATTENTE_RENVOI = 60;

/**
 * Inscription ou connexion par numéro : un code arrive par SMS, sa saisie
 * ouvre le compte de ce numéro (ou le crée). La session part en cookie,
 * comme après Google ; la page se recharge sur l'application.
 */
export function ConnexionTelephone({ onRetour }: { onRetour: () => void }) {
  const [numero, setNumero] = useState("");
  const [demande, setDemande] = useState<DemandeConnexionTelephone | null>(null);
  const [code, setCode] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [renvoi, setRenvoi] = useState(0);
  const valide = normaliserTelephone(numero) !== null;

  useEffect(() => {
    if (renvoi <= 0) return;
    const t = setTimeout(() => setRenvoi((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [renvoi]);

  async function executer(action: () => Promise<void>) {
    setEnCours(true);
    setErreur(null);
    try {
      await action();
    } catch (e) {
      setErreur(e instanceof ErreurApi ? e.message : "L'action a échoué. Réessayez.");
    } finally {
      setEnCours(false);
    }
  }

  const demander = (n: string) =>
    executer(async () => {
      setDemande(await api.demanderConnexionTelephone(n));
      setCode("");
      setRenvoi(ATTENTE_RENVOI);
    });

  function envoyerNumero(e: FormEvent) {
    e.preventDefault();
    void demander(numero);
  }

  function verifier(e: FormEvent) {
    e.preventDefault();
    if (!demande) return;
    void executer(async () => {
      await api.connexionTelephone(demande.demande, code);
      // Le cookie de session est posé : l'application se charge depuis le début.
      window.location.assign("/");
    });
  }

  return (
    <div className="animate-rise w-full max-w-xs">
      <button
        type="button"
        onClick={demande ? () => setDemande(null) : onRetour}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-texte-2 hover:text-texte"
      >
        <ArrowLeft size={16} /> {demande ? "Changer de numéro" : "Autres façons de se connecter"}
      </button>

      {!demande ? (
        <form key="numero" onSubmit={envoyerNumero} className="animate-fade">
          <label className="block">
            <span className="text-sm text-texte">Votre numéro de mobile</span>
            <input
              autoFocus
              value={numero}
              onChange={(e) => {
                setNumero(e.target.value);
                setErreur(null);
              }}
              inputMode="tel"
              autoComplete="tel"
              placeholder="034 12 345 67"
              className="mt-2 w-full border-b-2 border-bordure bg-transparent py-2 text-[17px] text-texte outline-none focus:border-primaire"
            />
          </label>
          <p className="mt-2 text-[13px] leading-relaxed text-texte-3">
            {numero && !valide ? MESSAGE_TELEPHONE : "Nouveau sur UniChat ? Le compte se crée avec ce numéro."}
          </p>
          {erreur && <p className="animate-fade mt-3 text-sm text-danger">{erreur}</p>}
          <button
            type="submit"
            disabled={!valide || enCours}
            className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primaire text-[15px] font-medium text-sur-primaire transition-opacity disabled:opacity-40"
          >
            {enCours ? <LoaderCircle size={17} className="animate-spin" /> : <Phone size={17} />}
            Recevoir un code par SMS
          </button>
        </form>
      ) : (
        <form key="code" onSubmit={verifier} className="animate-fade">
          <p className="text-[15px] leading-relaxed text-texte">
            Code envoyé au <span className="font-medium whitespace-nowrap">{afficherTelephone(demande.numero)}</span>.
          </p>
          <input
            autoFocus
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, "").slice(0, 8));
              setErreur(null);
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="Code reçu par SMS"
            placeholder="••••••"
            className="mt-4 w-full border-b-2 border-bordure bg-transparent py-2 text-center font-mono text-2xl tracking-[0.4em] text-texte outline-none focus:border-primaire"
          />
          {erreur && <p className="animate-fade mt-3 text-sm text-danger">{erreur}</p>}
          <button
            type="submit"
            disabled={code.length < 4 || enCours}
            className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primaire text-[15px] font-medium text-sur-primaire transition-opacity disabled:opacity-40"
          >
            {enCours && <LoaderCircle size={17} className="animate-spin" />}
            Se connecter
          </button>
          <button
            type="button"
            disabled={renvoi > 0 || enCours}
            onClick={() => void demander(demande.numero)}
            className="mt-4 block w-full text-center text-sm font-medium text-primaire-texte disabled:text-texte-3"
          >
            {renvoi > 0 ? `Renvoyer le code (${renvoi} s)` : "Renvoyer le code"}
          </button>
        </form>
      )}
    </div>
  );
}
