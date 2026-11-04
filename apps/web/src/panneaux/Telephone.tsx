import {
  afficherTelephone,
  normaliserTelephone,
  MESSAGE_TELEPHONE,
} from "@unichat/shared";
import {
  LoaderCircle,
  MessageSquareText,
  Phone,
  PhoneOff,
  RotateCw,
} from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { EnTetePanneau } from "../composants/Panneau";
import { ErreurApi, api } from "../lib/api";
import { useCompte, useMoi } from "../lib/compte";

/** Délai avant de pouvoir redemander un code : le SMS met parfois une minute à arriver. */
const ATTENTE_RENVOI = 60;

/**
 * Le numéro du profil, vérifié par un code SMS. Il sert à être trouvé par
 * ses contacts ; il n'est jamais montré aux autres.
 */
export function Telephone({ onRetour }: { onRetour: () => void }) {
  const moi = useMoi();
  const { remplacer, sessionPerdue } = useCompte();
  const attente = moi.verificationTelephone;
  const [saisie, setSaisie] = useState(!moi.telephone && !attente);
  const [numero, setNumero] = useState("");
  const [code, setCode] = useState("");
  const [enCours, setEnCours] = useState<"demande" | "code" | "retrait" | null>(
    null,
  );
  const [erreur, setErreur] = useState<string | null>(null);
  const [renvoi, setRenvoi] = useState(0);

  useEffect(() => {
    if (renvoi <= 0) return;
    const t = setTimeout(() => setRenvoi((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [renvoi]);

  async function executer(
    etape: NonNullable<typeof enCours>,
    action: () => Promise<void>,
  ) {
    setEnCours(etape);
    setErreur(null);
    try {
      await action();
    } catch (e) {
      if (!sessionPerdue(e))
        setErreur(
          e instanceof ErreurApi ? e.message : "L'action a échoué. Réessayez.",
        );
    } finally {
      setEnCours(null);
    }
  }

  const demander = (n: string) =>
    executer("demande", async () => {
      remplacer(await api.demanderTelephone(n));
      setSaisie(false);
      setCode("");
      setRenvoi(ATTENTE_RENVOI);
    });

  function envoyerNumero(e: FormEvent) {
    e.preventDefault();
    void demander(numero);
  }

  function verifier(e: FormEvent) {
    e.preventDefault();
    void executer("code", async () =>
      remplacer(await api.verifierTelephone(code)),
    );
  }

  const numeroValide = normaliserTelephone(numero) !== null;

  return (
    <>
      <EnTetePanneau titre="Numéro de téléphone" onRetour={onRetour} />
      <div className="animate-fade min-h-0 flex-1 overflow-y-auto px-7 pb-8">
        <div className="flex justify-center py-6">
          <span className="flex size-20 items-center justify-center rounded-full bg-primaire-doux text-primaire">
            <Phone size={34} />
          </span>
        </div>

        {attente ? (
          <form key="code" onSubmit={verifier} className="animate-rise">
            <p className="text-center text-[15px] leading-relaxed text-texte">
              Un code a été envoyé par SMS au{" "}
              <span className="font-medium whitespace-nowrap">
                {afficherTelephone(attente.numero)}
              </span>
              .
            </p>
            <p className="mt-1 text-center text-sm text-texte-2">
              Il est valable 10 minutes.
            </p>
            <label className="mt-7 block">
              <span className="text-sm text-texte">Code reçu</span>
              <input
                autoFocus
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 8));
                  setErreur(null);
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="••••••"
                className="mt-3 w-full border-b-2 border-bordure bg-transparent py-2 text-center font-mono text-2xl tracking-[0.4em] text-texte outline-none focus:border-primaire"
              />
            </label>
            {erreur && (
              <p className="animate-fade mt-3 text-sm text-danger">{erreur}</p>
            )}
            <BoutonPrincipal
              enCours={enCours === "code"}
              desactive={code.length < 4}
            >
              Vérifier
            </BoutonPrincipal>
            <div className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm">
              <button
                type="button"
                disabled={renvoi > 0 || enCours !== null}
                onClick={() => void demander(attente.numero)}
                className="inline-flex items-center gap-1.5 font-medium text-primaire-texte disabled:text-texte-3"
              >
                <RotateCw size={15} />{" "}
                {renvoi > 0
                  ? `Renvoyer le code (${renvoi} s)`
                  : "Renvoyer le code"}
              </button>
              <button
                type="button"
                disabled={enCours !== null}
                onClick={() =>
                  void executer("demande", async () => {
                    remplacer(await api.annulerVerificationTelephone());
                    setSaisie(true);
                  })
                }
                className="font-medium text-texte-2 hover:text-texte"
              >
                Changer de numéro
              </button>
            </div>
          </form>
        ) : saisie ? (
          <form key="numero" onSubmit={envoyerNumero} className="animate-rise">
            <p className="text-center text-[15px] leading-relaxed text-texte-2">
              Vos contacts pourront vous trouver avec ce numéro. Il n'est jamais
              affiché sur votre profil.
            </p>
            <label className="mt-7 block">
              <span className="text-sm text-texte">Numéro de mobile</span>
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
                className="mt-3 w-full border-b-2 border-bordure bg-transparent py-2 text-[17px] text-texte outline-none focus:border-primaire"
              />
              <span className="mt-2 block text-[13px] text-texte-2">
                {numero && !numeroValide
                  ? MESSAGE_TELEPHONE
                  : "Un code de vérification vous sera envoyé par SMS."}
              </span>
            </label>
            {erreur && (
              <p className="animate-fade mt-3 text-sm text-danger">{erreur}</p>
            )}
            <BoutonPrincipal
              enCours={enCours === "demande"}
              desactive={!numeroValide}
            >
              <MessageSquareText size={17} /> Recevoir le code
            </BoutonPrincipal>
            {moi.telephone && (
              <button
                type="button"
                onClick={() => setSaisie(false)}
                className="mt-5 block w-full text-center text-sm font-medium text-texte-2 hover:text-texte"
              >
                Garder le {afficherTelephone(moi.telephone)}
              </button>
            )}
          </form>
        ) : (
          moi.telephone && (
            <div key="verifie" className="animate-rise">
              <p className="text-center font-mono text-2xl text-texte">
                {afficherTelephone(moi.telephone)}
              </p>
              <p className="mt-2 text-center text-sm text-texte-2">
                Numéro vérifié.{" "}
                {moi.trouvableParTelephone
                  ? "Vos contacts peuvent vous trouver avec lui."
                  : "La recherche par numéro est désactivée dans Confidentialité."}
              </p>
              {erreur && (
                <p className="animate-fade mt-3 text-center text-sm text-danger">
                  {erreur}
                </p>
              )}
              <div className="mt-8 flex flex-col items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setNumero("");
                    setSaisie(true);
                  }}
                  className="rounded-full border border-bordure px-5 py-2.5 text-sm font-medium text-texte transition-colors hover:bg-survol"
                >
                  Changer de numéro
                </button>
                {moi.connexion === "telephone" ? (
                  <p className="max-w-xs text-center text-[13px] leading-relaxed text-texte-3">
                    Ce numéro sert à vous connecter : il peut être remplacé, pas
                    retiré.
                  </p>
                ) : (
                  <button
                    type="button"
                    disabled={enCours !== null}
                    onClick={() =>
                      void executer("retrait", async () =>
                        remplacer(await api.retirerTelephone()),
                      )
                    }
                    className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium text-danger transition-colors hover:bg-danger-doux disabled:opacity-60"
                  >
                    {enCours === "retrait" ? (
                      <LoaderCircle size={16} className="animate-spin" />
                    ) : (
                      <PhoneOff size={16} />
                    )}
                    Retirer le numéro
                  </button>
                )}
              </div>
            </div>
          )
        )}
      </div>
    </>
  );
}

function BoutonPrincipal({
  children,
  enCours,
  desactive,
}: {
  children: ReactNode;
  enCours: boolean;
  desactive: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={desactive || enCours}
      className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-full bg-primaire px-5 py-3 text-sm font-medium text-sur-primaire transition-opacity disabled:opacity-40"
    >
      {enCours && <LoaderCircle size={17} className="animate-spin" />}
      {children}
    </button>
  );
}
