import { afficherTelephone, normaliserTelephone, MESSAGE_TELEPHONE } from "@unichat/shared";
import { LoaderCircle, Pencil, Phone, PhoneOff } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { LigneReglage } from "../composants/Lignes";
import { EnTetePanneau } from "../composants/Panneau";
import { ErreurApi, api } from "../lib/api";
import { useCompte, useMoi } from "../lib/compte";

/** Délai avant de pouvoir redemander un code : le SMS met parfois une minute à arriver. */
const ATTENTE_RENVOI = 60;

/**
 * Le numéro du profil, vérifié par un code SMS. Il sert à être trouvé par
 * ses contacts ; il n'est jamais montré aux autres. Même allure que les
 * autres réglages : des lignes, un texte court, l'action en bas.
 */
export function Telephone({ onRetour }: { onRetour: () => void }) {
  const moi = useMoi();
  const { remplacer, sessionPerdue } = useCompte();
  const attente = moi.verificationTelephone;
  const [saisie, setSaisie] = useState(!moi.telephone && !attente);
  const [numero, setNumero] = useState("");
  const [code, setCode] = useState("");
  const [enCours, setEnCours] = useState<"demande" | "code" | "retrait" | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [renvoi, setRenvoi] = useState(0);

  useEffect(() => {
    if (renvoi <= 0) return;
    const t = setTimeout(() => setRenvoi((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [renvoi]);

  async function executer(etape: NonNullable<typeof enCours>, action: () => Promise<void>) {
    setEnCours(etape);
    setErreur(null);
    try {
      await action();
    } catch (e) {
      if (!sessionPerdue(e)) setErreur(e instanceof ErreurApi ? e.message : "L'action a échoué. Réessayez.");
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
    void executer("code", async () => remplacer(await api.verifierTelephone(code)));
  }

  const numeroValide = normaliserTelephone(numero) !== null;
  const messageErreur = erreur && <p className="animate-fade mt-3 text-sm text-danger">{erreur}</p>;

  return (
    <>
      <EnTetePanneau titre="Numéro de téléphone" onRetour={onRetour} />
      <div className="animate-fade min-h-0 flex-1 overflow-y-auto pb-8">
        {attente ? (
          <form key="code" onSubmit={verifier} className="px-7 pt-4">
            <p className="text-[15px] leading-relaxed text-texte">
              Saisissez le code envoyé par SMS au <span className="font-medium whitespace-nowrap">{afficherTelephone(attente.numero)}</span>.
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
              placeholder="••• •••"
              className="mt-6 w-full border-b-2 border-bordure bg-transparent py-2 text-center font-mono text-2xl tracking-[0.35em] text-texte outline-none focus:border-primaire"
            />
            <p className="mt-2 text-center text-[13px] text-texte-2">Valable 10 minutes</p>
            {messageErreur}
            <BoutonPrincipal enCours={enCours === "code"} desactive={code.length < 4}>
              Vérifier
            </BoutonPrincipal>
            <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium">
              <button
                type="button"
                disabled={renvoi > 0 || enCours !== null}
                onClick={() => void demander(attente.numero)}
                className="text-primaire-texte disabled:text-texte-3"
              >
                {renvoi > 0 ? `Renvoyer le code dans ${renvoi} s` : "Renvoyer le code"}
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
                className="text-texte-2 hover:text-texte"
              >
                Changer de numéro
              </button>
            </div>
          </form>
        ) : saisie ? (
          <form key="numero" onSubmit={envoyerNumero} className="px-7 pt-4">
            <p className="text-[15px] leading-relaxed text-texte-2">
              Vos contacts pourront vous trouver avec ce numéro. Il n'apparaît pas sur votre profil.
            </p>
            <label className="mt-6 block">
              <span className="text-sm text-primaire-texte">Numéro de mobile</span>
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
                className="mt-1 w-full border-b-2 border-bordure bg-transparent py-2 text-[17px] text-texte outline-none focus:border-primaire"
              />
            </label>
            <p className="mt-2 text-[13px] text-texte-2">{numero && !numeroValide ? MESSAGE_TELEPHONE : "Vous recevrez un code par SMS."}</p>
            {messageErreur}
            <BoutonPrincipal enCours={enCours === "demande"} desactive={!numeroValide}>
              Suivant
            </BoutonPrincipal>
            {moi.telephone && (
              <button type="button" onClick={() => setSaisie(false)} className="mt-5 text-sm font-medium text-texte-2 hover:text-texte">
                Garder le {afficherTelephone(moi.telephone)}
              </button>
            )}
          </form>
        ) : (
          moi.telephone && (
            <div key="verifie">
              <LigneReglage
                icone={Phone}
                titre={afficherTelephone(moi.telephone)}
                detail={moi.trouvableParTelephone ? "Vérifié · vos contacts peuvent vous trouver" : "Vérifié · recherche par numéro désactivée"}
              />
              <LigneReglage
                icone={Pencil}
                titre="Changer de numéro"
                onClick={() => {
                  setNumero("");
                  setSaisie(true);
                }}
              />
              {moi.connexion === "telephone" ? (
                <p className="px-7 pt-4 text-[13px] leading-relaxed text-texte-2">Ce numéro sert à vous connecter : il peut être remplacé, pas retiré.</p>
              ) : (
                <LigneReglage
                  icone={PhoneOff}
                  titre="Retirer le numéro"
                  danger
                  droite={enCours === "retrait" ? <LoaderCircle size={18} className="animate-spin text-texte-3" /> : undefined}
                  onClick={() => {
                    if (enCours === null) void executer("retrait", async () => remplacer(await api.retirerTelephone()));
                  }}
                />
              )}
              {erreur && <p className="animate-fade px-7 pt-3 text-sm text-danger">{erreur}</p>}
            </div>
          )
        )}
      </div>
    </>
  );
}

function BoutonPrincipal({ children, enCours, desactive }: { children: ReactNode; enCours: boolean; desactive: boolean }) {
  return (
    <button
      type="submit"
      disabled={desactive || enCours}
      className="mt-8 inline-flex items-center justify-center gap-2 rounded-full bg-primaire px-6 py-2.5 text-sm font-medium text-sur-primaire transition-opacity disabled:opacity-40"
    >
      {enCours && <LoaderCircle size={17} className="animate-spin" />}
      {children}
    </button>
  );
}
