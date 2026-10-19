import { comparerCodeScanne } from "@unichat/chiffrement";
import clsx from "clsx";
import { LoaderCircle, QrCode, ScanLine, ShieldCheck, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { EtatCode } from "../lib/chiffrement";
import { useMessagerie } from "../lib/messagerie-react";
import { CodeQr } from "./CodeQr";
import { Fenetre } from "./Fenetre";
import { LecteurQr } from "./LecteurQr";

type Avis = { ton: "succes" | "erreur"; texte: string };

/**
 * Code de sécurité avec une personne (étape 3, lot 7) : 60 chiffres et un QR
 * code, identiques sur les deux appareils. Les comparer, de vive voix ou en
 * scannant l'écran de l'autre, montre que personne ne s'est glissé entre
 * les deux comptes en substituant ses propres clés.
 */
export function DialogueCode({ compte, nom, onFermer }: { compte: string; nom: string; onFermer: () => void }) {
  const { messagerie } = useMessagerie();
  const [etat, setEtat] = useState<EtatCode | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [scan, setScan] = useState(false);
  const [avis, setAvis] = useState<Avis | null>(null);
  const [enCours, setEnCours] = useState(false);

  const charger = useCallback(() => {
    messagerie.codeSecurite(compte).then(setEtat, () => setErreur("Le code n'a pas pu être calculé. Vérifiez votre connexion et réessayez."));
  }, [messagerie, compte]);

  useEffect(charger, [charger]);

  async function marquer(verifie: boolean) {
    setEnCours(true);
    try {
      await messagerie.marquerCodeVerifie(compte, verifie);
      setEtat((e) => (e?.etat === "pret" ? { ...e, verifie } : e));
    } finally {
      setEnCours(false);
    }
  }

  function lu(texte: string) {
    setScan(false);
    if (etat?.etat !== "pret") return;
    const resultat = comparerCodeScanne(texte, etat.code);
    if (resultat === "identique") {
      void marquer(true);
      setAvis({ ton: "succes", texte: `Les codes correspondent : ${nom} est marqué comme vérifié.` });
    } else if (resultat === "different") {
      setAvis({
        ton: "erreur",
        texte: `Ce code ne correspond pas. Vérifiez qu'il s'agit bien de l'écran de ${nom}, dans votre discussion. S'il correspond chez lui et pas ici, l'un de vous a peut-être réinitialisé ses clés : rouvrez cette fenêtre.`,
      });
    } else {
      setAvis({ ton: "erreur", texte: "Ce QR code n'est pas un code de sécurité UniChat." });
    }
  }

  return (
    <Fenetre titre="Code de sécurité" onFermer={onFermer}>
      {erreur ? (
        <p role="alert" className="animate-fade py-6 text-sm leading-relaxed text-danger">
          {erreur}
        </p>
      ) : !etat ? (
        <p role="status" className="flex items-center gap-3 py-10 text-sm text-texte-2">
          <LoaderCircle size={20} className="shrink-0 animate-spin text-primaire" /> Calcul du code…
        </p>
      ) : etat.etat === "non-relie" ? (
        <p className="animate-fade py-6 text-sm leading-relaxed text-texte-2">
          Cet appareil n'a pas encore ses clés : reliez-le à votre téléphone ou à votre ordinateur depuis la liste des discussions,
          puis revenez ici.
        </p>
      ) : etat.etat === "sans-cles" ? (
        <p className="animate-fade py-6 text-sm leading-relaxed text-texte-2">
          {nom} n'a pas encore de clés : le code apparaîtra lorsqu'il aura ouvert une version récente d'UniChat.
        </p>
      ) : (
        <div className="animate-fade">
          <p className="text-sm leading-relaxed text-texte-2">
            Comparez ces chiffres avec ceux affichés sur l'appareil de {nom}, ou scannez son code. S'ils correspondent, personne ne
            s'est glissé entre vous.
          </p>

          <div className="mt-5 flex flex-col items-center gap-5 sm:flex-row sm:items-start">
            <div className="shrink-0">
              {scan ? (
                <div className="w-[176px]">
                  <LecteurQr onCode={lu} onErreur={(texte) => (setScan(false), setAvis({ ton: "erreur", texte }))} />
                </div>
              ) : (
                <div className="rounded-lg p-2 ring-1 ring-bordure">
                  <CodeQr texte={etat.code.qr} taille={160} libelle={`Code de sécurité avec ${nom}, à scanner sur son appareil`} />
                </div>
              )}
            </div>
            <ol
              aria-label="Code de sécurité en chiffres"
              className="grid flex-1 grid-cols-4 gap-x-3 gap-y-2 self-center text-[16px] tracking-wider text-texte tabular-nums"
            >
              {etat.code.chiffres.match(/\d{5}/g)!.map((bloc, i) => (
                <li key={i}>{bloc}</li>
              ))}
            </ol>
          </div>

          {etat.verifie && (
            <p className="animate-fade mt-5 flex items-center gap-2 text-sm text-primaire-texte">
              <ShieldCheck size={18} className="shrink-0" /> Vous avez vérifié le code de {nom}.
            </p>
          )}
          {avis && (
            <p
              role={avis.ton === "erreur" ? "alert" : "status"}
              className={clsx("animate-fade mt-4 flex items-start gap-2 text-sm leading-relaxed", avis.ton === "erreur" ? "text-danger" : "text-texte")}
            >
              {avis.ton === "erreur" && <TriangleAlert size={17} className="mt-0.5 shrink-0" />}
              {avis.texte}
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-bordure pt-4">
            <button
              type="button"
              onClick={() => (setAvis(null), setScan((s) => !s))}
              className="inline-flex items-center gap-2 rounded-full border border-bordure px-3.5 py-1.5 text-[13.5px] text-texte transition-colors hover:bg-survol"
            >
              {scan ? <QrCode size={16} /> : <ScanLine size={16} />}
              {scan ? "Afficher mon code" : "Scanner son code"}
            </button>
            {etat.verifie ? (
              <button
                type="button"
                disabled={enCours}
                onClick={() => (setAvis(null), void marquer(false))}
                className="ml-auto px-1 text-[13.5px] text-texte-2 underline-offset-2 hover:text-texte hover:underline disabled:opacity-50"
              >
                Retirer la vérification
              </button>
            ) : (
              <button
                type="button"
                disabled={enCours}
                onClick={() => void marquer(true)}
                className="ml-auto inline-flex items-center gap-2 rounded-full bg-primaire px-4 py-1.5 text-[13.5px] font-medium text-sur-primaire transition-colors hover:bg-primaire-fort disabled:opacity-50"
              >
                <ShieldCheck size={16} /> Marquer comme vérifié
              </button>
            )}
          </div>
        </div>
      )}
    </Fenetre>
  );
}
