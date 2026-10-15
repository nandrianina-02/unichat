import { LIMITES_GROUPE, schemaNomGroupe, type CarteProfil, type Groupe } from "@unichat/shared";
import clsx from "clsx";
import { ArrowRight, Check, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Avatar, AvatarGroupe } from "../composants/Avatar";
import { Case } from "../composants/Case";
import { EnTetePanneau } from "../composants/Panneau";
import { ErreurApi, api } from "../lib/api";
import { useCompte } from "../lib/compte";

/**
 * Création d'un groupe en deux temps, comme dans les messageries de
 * référence : on choisit les membres parmi ses contacts, puis on nomme le groupe.
 */
export function NouveauGroupe({
  onRetour,
  onCree,
  exclure = [],
  titre = "Nouveau groupe",
  onAjouter,
}: {
  onRetour: () => void;
  onCree?: (groupe: Groupe) => void;
  /** Ajout à un groupe existant : membres actuels, et action à la place de la création. */
  exclure?: string[];
  titre?: string;
  onAjouter?: (ids: string[]) => Promise<string | null>;
}) {
  const { sessionPerdue } = useCompte();
  const [contacts, setContacts] = useState<CarteProfil[] | null>(null);
  const [choisis, setChoisis] = useState<string[]>([]);
  const [recherche, setRecherche] = useState("");
  const [etape, setEtape] = useState<"membres" | "nom">("membres");
  const [nom, setNom] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const maximum = LIMITES_GROUPE.membres - 1 - (onAjouter ? exclure.length - 1 : 0);

  useEffect(() => {
    api
      .contacts()
      .then((r) => setContacts(r.contacts.filter((c) => !exclure.includes(c.id))))
      .catch((e) => !sessionPerdue(e) && setErreur("Vos contacts n'ont pas pu être chargés."));
    // La liste d'exclusion est lue à l'ouverture du panneau seulement.
  }, [sessionPerdue]);

  const visibles = useMemo(() => {
    const texte = recherche.trim().toLowerCase();
    return (contacts ?? []).filter((c) => !texte || c.nom.toLowerCase().includes(texte) || c.pseudo?.includes(texte.replace(/^@/, "")));
  }, [contacts, recherche]);

  const parId = new Map((contacts ?? []).map((c) => [c.id, c]));
  const basculer = (id: string) =>
    setChoisis((liste) => (liste.includes(id) ? liste.filter((x) => x !== id) : liste.length >= maximum ? liste : [...liste, id]));

  async function valider() {
    setEnCours(true);
    setErreur(null);
    try {
      if (onAjouter) {
        const probleme = await onAjouter(choisis);
        if (probleme) setErreur(probleme);
        return;
      }
      const verification = schemaNomGroupe.safeParse(nom);
      if (!verification.success) {
        setErreur(verification.error.issues[0]?.message ?? "Nom invalide.");
        return;
      }
      onCree?.(await api.creerGroupe(verification.data, choisis));
    } catch (e) {
      if (!sessionPerdue(e)) setErreur(e instanceof ErreurApi ? e.message : "Le groupe n'a pas pu être créé.");
    } finally {
      setEnCours(false);
    }
  }

  if (etape === "nom") {
    return (
      <>
        <EnTetePanneau titre="Nouveau groupe" onRetour={() => setEtape("membres")} />
        <div className="animate-fade min-h-0 flex-1 overflow-y-auto">
          <div className="flex justify-center py-7">
            <AvatarGroupe taille={140} />
          </div>
          <label className="block px-7">
            <span className="text-sm text-primaire">Nom du groupe</span>
            <div className="mt-2 flex items-center gap-2 border-b-2 border-bordure pb-1 focus-within:border-primaire">
              <input
                autoFocus
                value={nom}
                maxLength={LIMITES_GROUPE.nom}
                onChange={(e) => {
                  setNom(e.target.value);
                  setErreur(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && void valider()}
                className="min-w-0 flex-1 bg-transparent py-1.5 text-[16px] text-texte outline-none"
              />
              <span className="text-xs tabular-nums text-texte-3">{LIMITES_GROUPE.nom - nom.length}</span>
            </div>
          </label>
          <p className="px-7 pt-6 text-[13px] text-texte-2">
            {choisis.length} membre{choisis.length > 1 ? "s" : ""} en plus de vous :{" "}
            {choisis.map((id) => parId.get(id)?.nom).filter(Boolean).join(", ")}
          </p>
          {erreur && <p className="animate-fade px-7 pt-3 text-sm text-danger">{erreur}</p>}
          <div className="flex justify-center py-8">
            <button
              type="button"
              onClick={() => void valider()}
              disabled={enCours || !nom.trim()}
              aria-label="Créer le groupe"
              title="Créer le groupe"
              className="flex size-14 items-center justify-center rounded-full bg-primaire text-sur-primaire shadow-lg transition-colors hover:bg-primaire-fort disabled:opacity-40"
            >
              {enCours ? <LoaderCircle size={24} className="animate-spin" /> : <Check size={26} />}
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <EnTetePanneau titre={titre} onRetour={onRetour} />
      {choisis.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-2">
          {choisis.map((id) => {
            const c = parId.get(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => basculer(id)}
                className="animate-pop inline-flex items-center gap-1.5 rounded-full bg-champ py-1 pr-2 pl-1 text-sm text-texte hover:bg-survol"
                title="Retirer"
              >
                {c && <Avatar id={c.id} photo={c.photo} nom={c.nom} taille={22} />}
                {c?.nom}
                <X size={14} className="text-texte-2" />
              </button>
            );
          })}
        </div>
      )}
      <div className="px-3 pb-2">
        <label className="flex h-10 items-center gap-3 rounded-lg bg-champ px-3 focus-within:ring-2 focus-within:ring-primaire/40">
          <Search size={18} className="shrink-0 text-texte-2" />
          <input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher un contact"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-texte outline-none placeholder:text-texte-2"
          />
        </label>
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto pb-24">
        {contacts === null && !erreur && (
          <p className="flex items-center gap-3 px-7 py-4 text-sm text-texte-2">
            <LoaderCircle size={18} className="animate-spin" /> Chargement…
          </p>
        )}
        {contacts?.length === 0 && (
          <p className="px-7 py-6 text-sm leading-relaxed text-texte-2">
            {onAjouter ? "Tous vos contacts font déjà partie du groupe." : "Ajoutez d'abord des contacts : un groupe se crée avec eux."}
          </p>
        )}
        {visibles.map((c, i) => (
          <Case
            key={c.id}
            coche={choisis.includes(c.id)}
            onChange={() => basculer(c.id)}
            className={clsx("pl-4 pr-4 hover:bg-survol", i < 6 && `animate-fade stagger-${i + 1}`)}
          >
            <Avatar id={c.id} photo={c.photo} nom={c.nom} taille={44} />
            <span className="min-w-0 flex-1 border-b border-bordure py-3">
              <span className="block truncate text-[16px] text-texte">{c.nom}</span>
              <span className="block truncate text-[13px] text-texte-2">{c.infos ?? (c.pseudo ? `@${c.pseudo}` : "")}</span>
            </span>
          </Case>
        ))}
        {erreur && <p className="animate-fade px-7 py-3 text-sm text-danger">{erreur}</p>}
        {choisis.length >= maximum && (
          <p className="px-7 py-3 text-[13px] text-texte-3">Limite atteinte : {LIMITES_GROUPE.membres} membres par groupe.</p>
        )}
      </div>
      {choisis.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
          <button
            type="button"
            onClick={() => (onAjouter ? void valider() : setEtape("nom"))}
            disabled={enCours}
            aria-label={onAjouter ? "Ajouter au groupe" : "Suivant"}
            title={onAjouter ? "Ajouter au groupe" : "Suivant"}
            className="animate-pop pointer-events-auto flex size-14 items-center justify-center rounded-full bg-primaire text-sur-primaire shadow-lg transition-colors hover:bg-primaire-fort disabled:opacity-60"
          >
            {enCours ? <LoaderCircle size={24} className="animate-spin" /> : onAjouter ? <Check size={26} /> : <ArrowRight size={26} />}
          </button>
        </div>
      )}
    </>
  );
}
