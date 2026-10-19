import type { FicheAdmin, UtilisateurAdmin } from "@unichat/shared";
import clsx from "clsx";
import { ArrowLeft, Ban, Flag, Globe, Laptop, LogOut, Search, ShieldCheck, Smartphone, Trash2, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Apparition } from "../../composants/Apparition";
import { Avatar } from "../../composants/Avatar";
import { api } from "../../lib/api";
import { lieu, quand } from "../../lib/format";
import { CarteSignalement } from "./Signalements";
import { Attente, DialogueAction, Pastille, dateCourte, dateHeure, nombre, useChargement } from "./outils";

type Filtre = "tous" | "signales" | "suspendus";
const FILTRES: { id: Filtre; libelle: string }[] = [
  { id: "tous", libelle: "Tous" },
  { id: "signales", libelle: "Signalés" },
  { id: "suspendus", libelle: "Suspendus" },
];
const ICONES = { web: Globe, android: Smartphone, desktop: Laptop } as const;

export function Comptes({ ouvert, onOuvrir }: { ouvert: string | null; onOuvrir: (id: string | null) => void }) {
  if (ouvert) return <Fiche key={ouvert} id={ouvert} onRetour={() => onOuvrir(null)} />;
  return <Liste onOuvrir={onOuvrir} />;
}

function Liste({ onOuvrir }: { onOuvrir: (id: string) => void }) {
  const [texte, setTexte] = useState("");
  const [recherche, setRecherche] = useState("");
  const [filtre, setFiltre] = useState<Filtre>("tous");
  const [suite, setSuite] = useState<UtilisateurAdmin[]>([]);
  const [curseur, setCurseur] = useState<number | null>(null);
  const [enCours, setEnCours] = useState(false);

  // La recherche part une fois la frappe arrêtée.
  useEffect(() => {
    const minuterie = setTimeout(() => setRecherche(texte.trim()), 300);
    return () => clearTimeout(minuterie);
  }, [texte]);

  const { donnees, erreur } = useChargement(() => api.admin.utilisateurs(recherche, filtre), `${recherche}|${filtre}`);
  useEffect(() => {
    setSuite([]);
    setCurseur(donnees?.suite ?? null);
  }, [donnees]);

  async function plus() {
    if (curseur === null) return;
    setEnCours(true);
    try {
      const r = await api.admin.utilisateurs(recherche, filtre, curseur);
      setSuite((s) => [...s, ...r.utilisateurs]);
      setCurseur(r.suite);
    } finally {
      setEnCours(false);
    }
  }

  const liste = donnees ? [...donnees.utilisateurs, ...suite] : null;
  return (
    <div className="pb-10">
      <div className="animate-rise flex flex-col gap-3 md:flex-row md:items-center">
        <label className="flex min-w-0 flex-1 items-center gap-3 rounded-lg bg-champ px-3.5 py-2.5">
          <Search size={18} className="shrink-0 text-texte-2" />
          <input
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            placeholder="Nom, nom d'utilisateur ou adresse e-mail"
            aria-label="Rechercher un compte"
            className="min-w-0 flex-1 bg-transparent text-[14.5px] text-texte outline-none placeholder:text-texte-3"
          />
        </label>
        <div className="flex gap-2">
          {FILTRES.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFiltre(f.id)}
              aria-pressed={filtre === f.id}
              className={clsx(
                "rounded-full px-3.5 py-1.5 text-[13.5px] transition-colors",
                filtre === f.id ? "bg-primaire-doux text-primaire-texte" : "bg-entete text-texte-2 hover:text-texte",
              )}
            >
              {f.libelle}
            </button>
          ))}
        </div>
      </div>

      {erreur && <p className="py-6 text-sm text-danger">{erreur}</p>}
      {!liste && !erreur && <Attente />}
      {liste?.length === 0 && <p className="animate-fade py-10 text-center text-sm text-texte-2">Aucun compte ne correspond.</p>}
      {liste && liste.length > 0 && (
        <ul className="mt-5 border-t border-bordure">
          {liste.map((u, i) => (
            <li key={u.id} className={clsx(i < 6 && `animate-fade stagger-${i + 1}`)}>
              <button type="button" onClick={() => onOuvrir(u.id)} className="flex w-full items-center gap-4 border-b border-bordure px-2 py-3 text-left transition-colors hover:bg-survol">
                <Avatar id={u.id} photo={null} nom={u.nom} taille={40} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[15px] text-texte">{u.nom}</span>
                    {u.admin && <Pastille ton="accent">Administration</Pastille>}
                    {u.suspenduLe && <Pastille ton="danger">Suspendu</Pastille>}
                  </span>
                  <span className="block truncate text-[13px] text-texte-2">
                    {u.pseudo ? `@${u.pseudo}` : "Inscription inachevée"} · {u.email}
                  </span>
                </span>
                <span className="hidden shrink-0 text-right text-[12.5px] text-texte-3 md:block">
                  <span className="block">Inscrit le {dateCourte(u.creeLe)}</span>
                  <span className="block">{u.vuLe ? `Vu ${quand(u.vuLe)}` : "Jamais vu"}</span>
                </span>
                {u.signalements > 0 && (
                  <span className="flex shrink-0 items-center gap-1 text-[13px] text-danger" title="Signalements reçus">
                    <Flag size={14} /> {u.signalements}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {curseur !== null && (
        <div className="py-5 text-center">
          <button type="button" onClick={() => void plus()} disabled={enCours} className="rounded-full bg-entete px-5 py-2 text-sm text-texte-2 transition-colors hover:text-texte disabled:opacity-60">
            {enCours ? "Chargement…" : "Afficher plus"}
          </button>
        </div>
      )}
    </div>
  );
}

type Action = "suspendre" | "lever" | "deconnecter" | "supprimer";

function Fiche({ id, onRetour }: { id: string; onRetour: () => void }) {
  const { donnees: f, setDonnees, erreur } = useChargement(() => api.admin.fiche(id), id);
  const [action, setAction] = useState<Action | null>(null);
  const [supprime, setSupprime] = useState(false);
  const [avis, setAvis] = useState<string | null>(null);

  const retour = (
    <button type="button" onClick={onRetour} className="mb-5 inline-flex items-center gap-2 text-[13.5px] text-texte-2 transition-colors hover:text-texte">
      <ArrowLeft size={16} /> Tous les comptes
    </button>
  );
  if (supprime) {
    return (
      <div className="pb-10">
        {retour}
        <p className="animate-fade text-sm text-texte-2">Compte supprimé. L'action figure au journal.</p>
      </div>
    );
  }
  if (erreur) return <div>{retour}<p className="text-sm text-danger">{erreur}</p></div>;
  if (!f) return <div>{retour}<Attente /></div>;

  const majFiche = (nouvelle: FicheAdmin, texte: string) => {
    setDonnees(nouvelle);
    setAvis(texte);
  };

  return (
    <div className="pb-10">
      {retour}
      <section className="animate-rise flex flex-col gap-5 border-b border-bordure pb-6 md:flex-row md:items-start">
        <Avatar id={f.id} photo={null} nom={f.nom} taille={72} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[22px] text-texte">{f.nom}</h2>
            {f.admin && <Pastille ton="accent">Administration</Pastille>}
            {f.suspenduLe && <Pastille ton="danger">Suspendu</Pastille>}
          </div>
          <p className="mt-0.5 text-[14px] text-texte-2">
            {f.pseudo ? `@${f.pseudo}` : "Inscription inachevée"} · {f.email}
          </p>
          {f.infos && <p className="mt-2 text-[14px] text-texte-2">« {f.infos} »</p>}
        </div>
      </section>

      {f.suspenduLe && (
        <div role="status" className="animate-fade mt-6 border-l-2 border-danger bg-danger-doux px-4 py-3 text-[14px]">
          <p className="text-danger">Suspendu le {dateHeure(f.suspenduLe)}</p>
          {f.motifSuspension && <p className="mt-1 text-texte">{f.motifSuspension}</p>}
        </div>
      )}

      <dl className="animate-rise stagger-1 mt-6 grid grid-cols-2 border-t border-l border-bordure md:grid-cols-5">
        {[
          ["Inscription", dateCourte(f.creeLe)],
          ["Dernière activité", f.vuLe ? quand(f.vuLe) : "Jamais"],
          ["Contacts", nombre(f.contacts)],
          ["Signalements reçus", nombre(f.signalements)],
          ["Signalements faits", nombre(f.signalementsFaits)],
        ].map(([libelle, valeur]) => (
          <div key={libelle} className="border-r border-b border-bordure px-4 py-3">
            <dt className="text-[12.5px] text-texte-2">{libelle}</dt>
            <dd className="mt-1 text-[15px] text-texte">{valeur}</dd>
          </div>
        ))}
      </dl>

      {f.admin ? (
        <p className="mt-6 flex items-center gap-2 text-[13.5px] text-texte-2">
          <ShieldCheck size={16} /> Compte d'administration : il se gère depuis ses propres paramètres.
        </p>
      ) : (
        <div className="animate-rise stagger-2 mt-6 flex flex-wrap gap-2">
          <BoutonAction icone={LogOut} onClick={() => setAction("deconnecter")} disabled={f.sessions.length === 0}>
            Déconnecter ses appareils
          </BoutonAction>
          {f.suspenduLe ? (
            <BoutonAction icone={Ban} onClick={() => setAction("lever")}>
              Lever la suspension
            </BoutonAction>
          ) : (
            <BoutonAction icone={Ban} danger onClick={() => setAction("suspendre")}>
              Suspendre
            </BoutonAction>
          )}
          <BoutonAction icone={Trash2} danger onClick={() => setAction("supprimer")}>
            Supprimer le compte
          </BoutonAction>
        </div>
      )}
      <Apparition>{avis && <p role="status" className="animate-fade mt-3 text-[13px] text-texte-2">{avis}</p>}</Apparition>

      <Section titre={`Appareils connectés (${f.sessions.length})`}>
        {f.sessions.length === 0 ? (
          <Vide>Aucun appareil connecté.</Vide>
        ) : (
          f.sessions.map((s) => {
            const Icone = ICONES[s.plateforme];
            return (
              <div key={s.id} className="flex items-center gap-4 border-b border-bordure px-2 py-3">
                <Icone size={20} className="shrink-0 text-texte-2" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] text-texte">{s.appareil}</span>
                  <span className="block text-[12.5px] text-texte-2">
                    {[lieu(s.ville, s.pays), `connecté le ${dateCourte(s.creeLe)}`, `vu ${quand(s.vuLe)}`].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </div>
            );
          })
        )}
      </Section>

      <Section titre={`Groupes (${f.groupes.length})`}>
        {f.groupes.length === 0 ? (
          <Vide>Membre d'aucun groupe.</Vide>
        ) : (
          f.groupes.map((g) => (
            <div key={g.id} className="flex items-center gap-4 border-b border-bordure px-2 py-3">
              <UsersRound size={20} className="shrink-0 text-texte-2" />
              <span className="min-w-0 flex-1 truncate text-[14.5px] text-texte">{g.nom}</span>
              {g.role === "admin" && <Pastille>Administrateur du groupe</Pastille>}
              <span className="shrink-0 text-[12.5px] text-texte-3">
                {g.membres} membre{g.membres > 1 ? "s" : ""}
              </span>
            </div>
          ))
        )}
      </Section>

      <Section titre="Signalements reçus">
        {f.recus.length === 0 ? <Vide>Aucun signalement.</Vide> : <div className="space-y-4 pt-3">{f.recus.map((s) => <CarteSignalement key={s.id} s={s} compacte />)}</div>}
      </Section>

      <Apparition>
        {action === "suspendre" && (
          <DialogueAction
            titre={`Suspendre ${f.nom} ?`}
            confirmer="Suspendre"
            danger
            motif
            explication="Ses appareils sont déconnectés, la connexion lui est refusée et on ne peut plus lui écrire. La suspension se lève à tout moment."
            onAgir={async (motif) => majFiche(await api.admin.suspendre(f.id, motif), "Compte suspendu.")}
            onFermer={() => setAction(null)}
          />
        )}
        {action === "lever" && (
          <DialogueAction
            titre="Lever la suspension ?"
            confirmer="Lever la suspension"
            explication={`${f.nom} pourra de nouveau se connecter avec Google et recevoir des messages.`}
            onAgir={async () => majFiche(await api.admin.leverSuspension(f.id), "Suspension levée.")}
            onFermer={() => setAction(null)}
          />
        )}
        {action === "deconnecter" && (
          <DialogueAction
            titre="Déconnecter tous ses appareils ?"
            confirmer="Déconnecter"
            danger
            explication="Pour un compte qu'on croit volé : chaque appareil devra repasser par Google, et être relié de nouveau pour le chiffrement."
            onAgir={async () => majFiche(await api.admin.deconnecter(f.id), "Appareils déconnectés.")}
            onFermer={() => setAction(null)}
          />
        )}
        {action === "supprimer" && (
          <DialogueAction
            titre={`Supprimer le compte de ${f.nom} ?`}
            confirmer="Supprimer définitivement"
            danger
            saisie={{ etiquette: `Recopiez « ${f.pseudo ?? f.email} » pour confirmer`, attendu: f.pseudo ?? f.email }}
            explication="Profil, contacts, sessions et messages en attente sont effacés, sans retour possible. Les messages déjà remis restent chez leurs destinataires."
            onAgir={async () => {
              await api.admin.supprimer(f.id, f.pseudo ?? f.email);
              setSupprime(true);
            }}
            onFermer={() => setAction(null)}
          />
        )}
      </Apparition>
    </div>
  );
}

function BoutonAction({
  icone: Icone,
  danger,
  children,
  onClick,
  disabled,
}: {
  icone: typeof Ban;
  danger?: boolean;
  children: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50",
        danger ? "border-danger text-danger enabled:hover:bg-danger-doux" : "border-bordure text-texte enabled:hover:bg-survol",
      )}
    >
      <Icone size={16} /> {children}
    </button>
  );
}

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section className="animate-rise stagger-3 mt-9">
      <h3 className="border-b border-bordure pb-2 text-[13px] font-medium tracking-wide text-primaire-texte uppercase">{titre}</h3>
      {children}
    </section>
  );
}

const Vide = ({ children }: { children: string }) => <p className="px-2 py-4 text-[13.5px] text-texte-3">{children}</p>;
