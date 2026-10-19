import type { RoleLiaison } from "@unichat/chiffrement";
import clsx from "clsx";
import { CircleCheck, ClipboardPaste, Copy, LoaderCircle, QrCode, ScanLine, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { estTactile } from "../lib/appui";
import { afficherCode, estAnnulation, lireCode, messageLiaison, type FinLiaison } from "../lib/liaison";
import { useMessagerie } from "../lib/messagerie-react";
import { reconnecter, reconnexionRequise } from "../lib/reconnexion";
import { CodeQr } from "./CodeQr";
import { Dialogue } from "./Dialogue";
import { Fenetre } from "./Fenetre";
import { LecteurQr } from "./LecteurQr";

type Mode = "afficher" | "lire" | "coller";

const MODES: Record<Mode, { libelle: string; icone: typeof QrCode }> = {
  afficher: { libelle: "Afficher un code", icone: QrCode },
  lire: { libelle: "Lire un code", icone: ScanLine },
  coller: { libelle: "Coller un code", icone: ClipboardPaste },
};

/**
 * Relier deux appareils du même compte. Le nouvel appareil affiche un code
 * et l'appareil relié le lit, comme pour WhatsApp Web ; l'inverse marche
 * aussi (ordinateur sans appareil photo), et le code peut se copier-coller.
 */
export function Liaison({ role, onFermer, onReinitialiser }: { role: RoleLiaison; onFermer: () => void; onReinitialiser?: () => void }) {
  const { messagerie } = useMessagerie();
  const [mode, setMode] = useState<Mode>(role === "receveur" ? "afficher" : "lire");
  const [essai, setEssai] = useState(0);
  const [etape, setEtape] = useState<string | null>(null);
  const [fin, setFin] = useState<FinLiaison | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const annulation = useRef<AbortController | null>(null);

  useEffect(() => () => annulation.current?.abort(), []);

  /** Lance une étape de la liaison ; une seule à la fois, abandonnée à la fermeture. */
  async function mener(tache: (signal: AbortSignal) => Promise<FinLiaison>) {
    annulation.current?.abort();
    const controleur = new AbortController();
    annulation.current = controleur;
    try {
      const resultat = await tache(controleur.signal);
      if (!controleur.signal.aborted) setFin(resultat);
    } catch (e) {
      if (!estAnnulation(e) && !controleur.signal.aborted) setErreur(messageLiaison(e));
    }
  }

  function changer(nouveau: Mode) {
    annulation.current?.abort();
    setErreur(null);
    setEtape(null);
    setMode(nouveau);
    setEssai((n) => n + 1);
  }

  const lu = (texte: string) => {
    setEtape("Vérification du code…");
    void mener((signal) => lireCode(texte, role, messagerie, { etape: setEtape, signal }));
  };

  const titre = role === "receveur" ? "Relier cet appareil" : "Relier un appareil";
  return (
    <Fenetre titre={titre} onFermer={onFermer}>
      {fin ? (
        <div className="animate-rise flex flex-col items-center py-4 text-center">
          <CircleCheck size={44} className="text-primaire" />
          <p className="mt-4 text-[17px] text-texte">{role === "receveur" ? "Cet appareil est relié" : "Appareil relié"}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-texte-2">
            {role === "receveur" ? "Il a reçu les clés de votre compte" : `${fin.autre ?? "L'autre appareil"} a reçu les clés de votre compte`}
            {fin.historique ? ` et l'historique de vos discussions (${fin.historique.toLocaleString("fr-FR")} messages).` : "."}
          </p>
          {fin.historique === null && (
            <p className="animate-fade mt-3 text-sm leading-relaxed text-texte-2">
              L'historique n'a pas pu être transmis : les nouveaux messages arriveront bien sur {role === "receveur" ? "cet appareil" : "l'autre appareil"}.
            </p>
          )}
          <button type="button" onClick={onFermer} className="mt-6 rounded-full bg-primaire px-6 py-2 text-sm font-medium text-sur-primaire transition-colors hover:bg-primaire-fort">
            Terminé
          </button>
        </div>
      ) : erreur ? (
        <div className="animate-fade flex flex-col items-center py-4 text-center">
          <TriangleAlert size={36} className="text-danger" />
          <p role="alert" className="mt-4 text-sm leading-relaxed text-texte">
            {erreur}
          </p>
          <button type="button" onClick={() => changer(mode)} className="mt-6 rounded-full bg-primaire px-6 py-2 text-sm font-medium text-sur-primaire transition-colors hover:bg-primaire-fort">
            Recommencer
          </button>
        </div>
      ) : etape ? (
        <p role="status" className="animate-fade flex items-center gap-3 py-10 text-sm text-texte-2">
          <LoaderCircle size={20} className="shrink-0 animate-spin text-primaire" /> {etape}
        </p>
      ) : (
        <div key={essai} className="animate-fade">
          {mode === "afficher" && (
            <Affichage
              role={role}
              onDebut={(poursuivre) => void mener((signal) => poursuivre({ etape: setEtape, signal }))}
              onErreur={setErreur}
              onNouveau={() => changer("afficher")}
            />
          )}
          {mode === "lire" && (
            <>
              <p className="mb-4 text-sm leading-relaxed text-texte-2">
                {role === "donneur"
                  ? "Sur le nouvel appareil, ouvrez Paramètres, Compte, Appareils connectés, puis « Relier cet appareil ». Visez le code qui s'affiche."
                  : "Sur un appareil déjà relié, ouvrez Paramètres, Compte, Appareils connectés, puis « Relier un appareil » et « Afficher un code ». Visez ce code."}
              </p>
              <LecteurQr onCode={lu} onErreur={setErreur} />
            </>
          )}
          {mode === "coller" && <Collage onCode={lu} />}
        </div>
      )}

      {!fin && !etape && (
        <div className="mt-6 flex flex-wrap gap-2 border-t border-bordure pt-4">
          {(Object.keys(MODES) as Mode[])
            .filter((m) => m !== mode)
            .map((m) => {
              const { libelle, icone: Icone } = MODES[m];
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => changer(m)}
                  className="inline-flex items-center gap-2 rounded-full border border-bordure px-3.5 py-1.5 text-[13.5px] text-texte transition-colors hover:bg-survol"
                >
                  <Icone size={15} /> {libelle}
                </button>
              );
            })}
          {onReinitialiser && (
            <button type="button" onClick={onReinitialiser} className="ml-auto px-1 text-[13px] text-texte-2 underline-offset-2 hover:text-texte hover:underline">
              Je n'ai plus mes autres appareils
            </button>
          )}
        </div>
      )}
    </Fenetre>
  );
}

type Poursuite = Awaited<ReturnType<typeof afficherCode>>["poursuivre"];

/** Code affiché : il vaut cinq minutes, puis on en propose un nouveau. */
function Affichage({
  role,
  onDebut,
  onErreur,
  onNouveau,
}: {
  role: RoleLiaison;
  onDebut: (poursuivre: Poursuite) => void;
  onErreur: (message: string) => void;
  onNouveau: () => void;
}) {
  const { messagerie } = useMessagerie();
  const [code, setCode] = useState<{ texte: string; expireLe: number } | null>(null);
  const [reste, setReste] = useState(0);
  const [copie, setCopie] = useState(false);
  const rappels = useRef({ onDebut, onErreur });
  rappels.current = { onDebut, onErreur };

  useEffect(() => {
    let actif = true;
    afficherCode(role, messagerie).then(
      (c) => {
        if (!actif) return;
        setCode({ texte: c.texte, expireLe: c.expireLe });
        // L'attente de l'autre appareil commence ; l'écran reste sur le code.
        rappels.current.onDebut(c.poursuivre);
      },
      (e) => actif && rappels.current.onErreur(messageLiaison(e)),
    );
    return () => {
      actif = false;
    };
  }, [role, messagerie]);

  useEffect(() => {
    if (!code) return;
    const tic = () => setReste(Math.max(0, Math.round((code.expireLe - Date.now()) / 1000)));
    tic();
    const minuterie = setInterval(tic, 1000);
    return () => clearInterval(minuterie);
  }, [code]);

  if (!code) {
    return (
      <p className="flex justify-center py-16 text-texte-2">
        <LoaderCircle size={22} className="animate-spin" />
      </p>
    );
  }
  return (
    <div className="flex flex-col items-center">
      <p className="mb-5 self-stretch text-sm leading-relaxed text-texte-2">
        {role === "receveur"
          ? "Sur un appareil déjà relié, ouvrez Paramètres, Compte, Appareils connectés, puis « Relier un appareil ». Visez ce code."
          : "Sur le nouvel appareil, choisissez « Relier cet appareil », puis « Lire un code », et visez ce code."}
      </p>
      <div className={clsx("rounded-lg p-3 ring-1 ring-bordure transition-opacity", reste === 0 && "opacity-30")}>
        <CodeQr texte={code.texte} libelle="Code de liaison de cet appareil" taille={estTactile() ? 220 : 240} />
      </div>
      {reste > 0 ? (
        <p className="mt-3 text-[13px] text-texte-2 tabular-nums">Valable encore {Math.floor(reste / 60)}:{String(reste % 60).padStart(2, "0")}</p>
      ) : (
        <button type="button" onClick={onNouveau} className="mt-3 rounded-full bg-primaire px-5 py-2 text-sm font-medium text-sur-primaire transition-colors hover:bg-primaire-fort">
          Code expiré : en afficher un nouveau
        </button>
      )}
      <button
        type="button"
        onClick={() =>
          void navigator.clipboard.writeText(code.texte).then(
            () => setCopie(true),
            () => setCopie(false),
          )
        }
        className="mt-3 inline-flex items-center gap-2 text-[13.5px] text-primaire-texte hover:underline"
      >
        <Copy size={15} /> {copie ? "Code copié" : "Copier le code"}
      </button>
    </div>
  );
}

function Collage({ onCode }: { onCode: (texte: string) => void }) {
  const [texte, setTexte] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (texte.trim()) onCode(texte.trim());
      }}
    >
      <p className="mb-3 text-sm leading-relaxed text-texte-2">
        Sur l'autre appareil, choisissez « Afficher un code », puis « Copier le code », et collez-le ici. Faites-le passer par un moyen que vous seul utilisez.
      </p>
      <textarea
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        rows={3}
        spellCheck={false}
        aria-label="Code de liaison"
        className="w-full resize-none rounded-lg bg-champ px-3 py-2.5 font-mono text-[12.5px] break-all text-texte outline-none focus:ring-2 focus:ring-primaire"
      />
      <button type="submit" disabled={!texte.trim()} className="mt-3 rounded-full bg-primaire px-5 py-2 text-sm font-medium text-sur-primaire transition-colors hover:bg-primaire-fort disabled:opacity-50">
        Relier
      </button>
    </form>
  );
}

/**
 * Nouvelles clés pour le compte : quand aucun autre appareil ne peut plus
 * transmettre les siennes (perdu, effacé). Les autres devront être reliés à
 * celui-ci.
 */
export function DialogueNouvellesCles({ aucunAppareil, onFermer }: { aucunAppareil: boolean; onFermer: () => void }) {
  const { messagerie } = useMessagerie();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [aReconnecter, setAReconnecter] = useState(false);

  async function confirmer() {
    if (aReconnecter) return reconnecter();
    setEnCours(true);
    setErreur(null);
    try {
      await messagerie.reinitialiserCles();
      onFermer();
    } catch (e) {
      setAReconnecter(reconnexionRequise(e));
      setErreur(messageLiaison(e));
      setEnCours(false);
    }
  }

  return (
    <Dialogue
      titre="Créer de nouvelles clés ?"
      confirmer={aReconnecter ? "Se reconnecter" : "Créer de nouvelles clés"}
      danger={!aReconnecter}
      enCours={enCours}
      onConfirmer={() => void confirmer()}
      onFermer={onFermer}
    >
      <p>
        {aucunAppareil
          ? "Aucun appareil ne détient plus les clés de votre compte. Celui-ci en crée de nouvelles."
          : "À n'utiliser que si vous n'avez plus accès à vos autres appareils. Ils perdront les clés du compte et devront être reliés à celui-ci."}
      </p>
      {erreur && (
        <p role="alert" className="animate-fade mt-3 text-danger">
          {erreur}
        </p>
      )}
    </Dialogue>
  );
}
