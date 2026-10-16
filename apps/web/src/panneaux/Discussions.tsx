import type { CarteProfil, EvenementSecurite } from "@unichat/shared";
import clsx from "clsx";
import {
  BellRing,
  Camera,
  EllipsisVertical,
  FileText,
  Headphones,
  LogOut,
  MessageSquarePlus,
  Mic,
  Search,
  Settings,
  ShieldAlert,
  UserPlus,
  Video,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { estGroupe } from "@unichat/shared";
import { Avatar, AvatarGroupe } from "../composants/Avatar";
import { BoutonIcone } from "../composants/BoutonIcone";
import { Coches } from "../composants/Coches";
import { EVENEMENT_CONTACTS, LignePersonne, TitreSection } from "../composants/Lignes";
import { api } from "../lib/api";
import { useCompte, useMoi } from "../lib/compte";
import { dateListe, dureeCourte, libelleMedia, lieu, quand, texteEvenement } from "../lib/format";
import { useMessagerie } from "../lib/messagerie-react";
import type { ConversationLocale } from "../lib/stockage";

interface Props {
  /** Discussion ouverte (identifiant de conversation). */
  selection: string | null;
  onOuvrir: (conversation: string) => void;
  /** Ouvre la discussion à deux avec cette personne. */
  onOuvrirPersonne: (id: string) => void;
  onNouvelle: () => void;
  onParametres: () => void;
  onDeconnexion: () => void;
}

type Filtre = "toutes" | "non-lues";

/** Colonne de gauche : en-tête, recherche, alertes, liste des discussions. */
export function Discussions({ selection, onOuvrir, onOuvrirPersonne, onNouvelle, onParametres, onDeconnexion }: Props) {
  const moi = useMoi();
  const { sessionPerdue } = useCompte();
  const { messagerie, etat } = useMessagerie();
  const [contacts, setContacts] = useState<CarteProfil[] | null>(null);
  const [recherche, setRecherche] = useState("");
  const [filtre, setFiltre] = useState<Filtre>("toutes");
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const charger = () =>
      api
        .contacts()
        .then((r) => setContacts(r.contacts))
        .catch((e) => sessionPerdue(e));
    charger();
    window.addEventListener(EVENEMENT_CONTACTS, charger);
    return () => window.removeEventListener(EVENEMENT_CONTACTS, charger);
  }, [sessionPerdue]);

  useEffect(() => {
    if (!menu) return;
    const fermer = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", fermer);
    return () => document.removeEventListener("mousedown", fermer);
  }, [menu]);

  const nomDe = (c: ConversationLocale) =>
    estGroupe(c.id)
      ? (etat.groupes[c.autre]?.nom ?? "Groupe")
      : c.autre === moi.id
        ? `${moi.nom} (vous)`
        : (etat.personnes[c.autre]?.nom ?? "");
  const texte = recherche.trim().toLowerCase();
  const nonLues = etat.conversations.filter((c) => c.nonLus > 0).length;

  const conversations = useMemo(
    () =>
      etat.conversations.filter(
        (c) =>
          c.dernier !== null &&
          (filtre === "toutes" || c.nonLus > 0) &&
          (!texte || nomDe(c).toLowerCase().includes(texte)),
      ),
    // nomDe ne dépend que des personnes connues et du profil, déjà suivis ici.
    [etat.conversations, etat.personnes, etat.groupes, filtre, texte, moi.id, moi.nom],
  );

  // Pendant une recherche : les contacts sans discussion apparaissent aussi.
  const contactsTrouves = useMemo(() => {
    if (!texte || !contacts) return [];
    const avecDiscussion = new Set(etat.conversations.filter((c) => !estGroupe(c.id)).map((c) => c.autre));
    return contacts.filter(
      (c) =>
        !avecDiscussion.has(c.id) &&
        (c.nom.toLowerCase().includes(texte) || c.pseudo?.includes(texte.replace(/^@/, ""))),
    );
  }, [texte, contacts, etat.conversations]);

  const aucuneDiscussion = etat.conversations.every((c) => c.dernier === null);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-[60px] shrink-0 items-center justify-between pl-5 pr-3">
        <h1 className="text-[22px] font-bold text-texte">Discussions</h1>
        <div className="flex items-center gap-1">
          <BoutonIcone libelle="Nouvelle discussion" onClick={onNouvelle}>
            <MessageSquarePlus size={22} />
          </BoutonIcone>
          <div ref={menuRef} className="relative">
            <BoutonIcone libelle="Menu" actif={menu} onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu}>
              <EllipsisVertical size={22} />
            </BoutonIcone>
            {menu && (
              <div role="menu" className="animate-pop absolute right-0 top-11 z-30 w-56 rounded-lg bg-panneau py-2 shadow-xl ring-1 ring-bordure">
                {[
                  { icone: UserPlus, libelle: "Nouveau contact", action: onNouvelle },
                  { icone: Settings, libelle: "Paramètres", action: onParametres },
                  { icone: LogOut, libelle: "Se déconnecter", action: onDeconnexion },
                ].map(({ icone: Icone, libelle, action }) => (
                  <button
                    key={libelle}
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setMenu(false);
                      action();
                    }}
                    className="flex w-full items-center gap-3 px-5 py-2.5 text-left text-sm text-texte hover:bg-survol"
                  >
                    <Icone size={18} className="text-texte-2" /> {libelle}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="px-3 pb-2">
        <label className="flex h-10 items-center gap-3 rounded-lg bg-champ px-3 focus-within:ring-2 focus-within:ring-primaire/40">
          <Search size={18} className="shrink-0 text-texte-2" />
          <input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher une discussion ou un contact"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-texte outline-none placeholder:text-texte-2"
          />
          {recherche && (
            <button type="button" onClick={() => setRecherche("")} aria-label="Effacer la recherche" className="text-texte-2 hover:text-texte">
              <X size={18} />
            </button>
          )}
        </label>
      </div>

      {!aucuneDiscussion && (
        <div className="flex gap-2 px-3 pb-2" role="tablist" aria-label="Filtrer les discussions">
          {(
            [
              ["toutes", "Toutes"],
              ["non-lues", nonLues > 0 ? `Non lues ${nonLues}` : "Non lues"],
            ] as const
          ).map(([valeur, libelle]) => (
            <button
              key={valeur}
              role="tab"
              type="button"
              aria-selected={filtre === valeur}
              onClick={() => setFiltre(valeur)}
              className={clsx(
                "rounded-full px-3 py-1 text-[14px] transition-colors",
                filtre === valeur ? "bg-primaire-doux text-primaire-texte" : "bg-champ text-texte-2 hover:bg-survol",
              )}
            >
              {libelle}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {etat.connexion === "hors-ligne" && (
          <div role="status" className="animate-fade mx-3 mb-2 flex items-center gap-4 rounded-lg bg-entete px-4 py-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-texte-3 text-sur-primaire">
              <WifiOff size={20} />
            </span>
            <span className="text-sm">
              <span className="block font-medium text-texte">Hors connexion</span>
              <span className="text-texte-2">Vos messages partiront dès le retour du réseau.</span>
            </span>
          </div>
        )}
        <BanniereNotifications />
        <AlerteConnexion />

        {conversations.map((c, i) => {
          const indication = etat.ecrit[c.id];
          const ecrit = indication && indication.fin > Date.now() ? indication.de : null;
          return (
            <LigneConversation
              key={c.id}
              conversation={c}
              nom={nomDe(c)}
              personne={estGroupe(c.id) || c.autre === moi.id ? null : etat.personnes[c.autre]}
              photoMoi={c.autre === moi.id ? moi.photo : null}
              ecrit={ecrit ? (estGroupe(c.id) ? `${messagerie.nom(ecrit, c.id)} écrit…` : "écrit…") : null}
              apercu={apercu(c, (id) => messagerie.nom(id, c.id))}
              selection={selection === c.id}
              onClick={() => onOuvrir(c.id)}
              className={i < 6 ? `animate-fade stagger-${i + 1}` : undefined}
            />
          );
        })}

        {texte && contactsTrouves.length > 0 && (
          <>
            <TitreSection>Contacts</TitreSection>
            {contactsTrouves.map((c) => (
              <LignePersonne key={c.id} carte={c} onClick={() => onOuvrirPersonne(c.id)} />
            ))}
          </>
        )}

        {texte && conversations.length === 0 && contactsTrouves.length === 0 && (
          <p className="animate-fade px-7 py-10 text-center text-sm text-texte-2">Aucun résultat pour « {recherche.trim()} ».</p>
        )}
        {!texte && filtre === "non-lues" && conversations.length === 0 && (
          <p className="animate-fade px-7 py-10 text-center text-sm text-texte-2">Aucune discussion non lue.</p>
        )}

        {!texte && aucuneDiscussion && (
          <div className="animate-rise flex flex-col items-center px-10 py-14 text-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-primaire-doux text-primaire">
              <MessageSquarePlus size={28} />
            </span>
            <p className="mt-5 text-[17px] text-texte">Aucune discussion pour l'instant</p>
            <p className="mt-2 text-sm leading-relaxed text-texte-2">
              {contacts && contacts.length > 0
                ? "Choisissez un contact pour lui écrire."
                : "Ajoutez un contact avec son nom d'utilisateur ou son adresse e-mail pour commencer."}
            </p>
            <button
              type="button"
              onClick={onNouvelle}
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-primaire px-5 py-2.5 text-sm font-medium text-sur-primaire transition-colors hover:bg-primaire-fort"
            >
              <MessageSquarePlus size={18} /> Nouvelle discussion
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Aperçu de la dernière activité : « Ana : message », un événement de groupe, ou un message supprimé. */
const ICONES_MEDIA: Record<string, LucideIcon> = { image: Camera, video: Video, audio: Headphones, document: FileText };

interface Apercu {
  texte: string;
  italique: boolean;
  /** Auteur dans un groupe, devant le pictogramme du fichier : « Bob : [micro] 0:12 ». */
  prefixe?: string;
  icone?: LucideIcon;
}

function apercu(c: ConversationLocale, nom: (id: string) => string): Apercu {
  const d = c.dernier;
  if (!d) return { texte: "", italique: false };
  if (d.evenement) return { texte: texteEvenement(d.evenement, nom), italique: false };
  if (d.supprime) return { texte: d.deMoi ? "Vous avez supprimé ce message" : "Ce message a été supprimé", italique: true };
  const prefixe = estGroupe(c.id) && !d.deMoi ? `${nom(d.de)} : ` : "";
  if (d.media) {
    // Message vocal : sa durée dit plus que son nom.
    const libelle = d.media.vocal && d.media.duree !== undefined ? dureeCourte(d.media.duree) : libelleMedia(d.media);
    return { texte: d.texte || libelle, italique: false, prefixe, icone: d.media.vocal ? Mic : ICONES_MEDIA[d.media.type] };
  }
  return { texte: `${prefixe}${d.texte}`, italique: false };
}

function LigneConversation({
  conversation: c,
  nom,
  personne,
  photoMoi,
  ecrit,
  apercu: resume,
  selection,
  onClick,
  className,
}: {
  conversation: ConversationLocale;
  nom: string;
  personne: CarteProfil | null | undefined;
  photoMoi: string | null;
  ecrit: string | null;
  apercu: Apercu;
  selection: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onClick())}
      className={clsx(
        "flex cursor-pointer items-center gap-3.5 pl-3 transition-colors hover:bg-survol",
        selection && "bg-selection hover:bg-selection",
        className,
      )}
    >
      {estGroupe(c.id) ? (
        <AvatarGroupe taille={49} />
      ) : (
        <Avatar id={c.autre} photo={personne?.photo ?? photoMoi} nom={nom || "Contact"} taille={49} />
      )}
      <div className="min-w-0 flex-1 border-b border-bordure py-3 pr-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-[17px] text-texte">{nom || "…"}</p>
          {c.dernier && (
            <span className={clsx("shrink-0 text-xs", c.nonLus > 0 ? "font-medium text-primaire" : "text-texte-2")}>
              {dateListe(c.dernier.le)}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <p className={clsx("flex min-w-0 flex-1 items-center gap-1 text-[14px]", ecrit ? "text-primaire" : "text-texte-2")}>
            {ecrit ?? (
              <>
                {c.dernier?.deMoi && !c.dernier.supprime && !c.dernier.evenement && <Coches etat={c.dernier.etat} />}
                {resume.prefixe && <span className="shrink-0">{resume.prefixe}</span>}
                {resume.icone && <resume.icone size={16} className="shrink-0" aria-hidden="true" />}
                <span className={clsx("truncate", resume.italique && "italic")}>{resume.texte}</span>
              </>
            )}
          </p>
          {c.nonLus > 0 && (
            <span className="animate-pop flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primaire px-1.5 text-[11px] font-semibold text-sur-primaire">
              {c.nonLus}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

const CLE_NOTIFICATIONS = "unichat.notifications-refusees";

/** Proposition d'activer les notifications, tant que le navigateur n'a pas reçu de réponse. */
function BanniereNotifications() {
  const [visible, setVisible] = useState(() => {
    if (!("Notification" in window) || Notification.permission !== "default") return false;
    try {
      return !localStorage.getItem(CLE_NOTIFICATIONS);
    } catch {
      return true;
    }
  });
  if (!visible) return null;
  return (
    <div className="animate-rise mx-3 mb-2 flex gap-4 rounded-lg bg-entete px-4 py-3.5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primaire text-sur-primaire">
        <BellRing size={20} />
      </span>
      <div className="min-w-0 text-sm">
        <p className="font-medium text-texte">Soyez prévenu des nouveaux messages</p>
        <p className="mt-0.5 text-texte-2">Une notification s'affiche quand UniChat est en arrière-plan.</p>
        <div className="mt-2 flex gap-5 font-medium">
          <button
            type="button"
            onClick={() => void Notification.requestPermission().finally(() => setVisible(false))}
            className="text-primaire-texte hover:underline"
          >
            Activer
          </button>
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.setItem(CLE_NOTIFICATIONS, "1");
              } catch {
                // Sans stockage, la bannière reviendra à la prochaine visite.
              }
              setVisible(false);
            }}
            className="text-texte-2 hover:underline"
          >
            Plus tard
          </button>
        </div>
      </div>
    </div>
  );
}

/** « Nouvelle connexion à votre compte » : affichée sur les autres appareils jusqu'à ce qu'on la traite. */
function AlerteConnexion() {
  const { sessionPerdue } = useCompte();
  const [alerte, setAlerte] = useState<EvenementSecurite | null>(null);
  const [resultat, setResultat] = useState<string | null>(null);

  useEffect(() => {
    const verifier = () =>
      api
        .alertes()
        .then((r) => setAlerte(r.alertes[0] ?? null))
        .catch((e) => sessionPerdue(e));
    verifier();
    // Revenir sur l'onglet suffit à voir une connexion survenue entre-temps.
    window.addEventListener("focus", verifier);
    return () => window.removeEventListener("focus", verifier);
  }, [sessionPerdue]);

  if (!alerte) {
    return resultat ? <p className="animate-fade mx-3 mb-2 rounded-lg bg-entete px-4 py-3 text-sm text-texte-2">{resultat}</p> : null;
  }

  async function traiter(deconnecter: boolean) {
    try {
      if (deconnecter && alerte?.sessionId) await api.deconnecterAppareil(alerte.sessionId);
      await api.alertesVues();
      setAlerte(null);
      setResultat(deconnecter ? "L'appareil a été déconnecté." : null);
    } catch (e) {
      if (!sessionPerdue(e)) setResultat("L'action n'a pas abouti. Réessayez depuis Paramètres, Compte.");
    }
  }

  const ou = lieu(alerte.ville, alerte.pays);
  return (
    <div role="status" className="animate-rise mx-3 mb-2 flex gap-4 rounded-lg bg-primaire-doux px-4 py-4">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primaire text-sur-primaire">
        <ShieldAlert size={22} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium text-texte">Nouvelle connexion à votre compte</p>
        <p className="mt-0.5 text-sm text-texte-2">
          {alerte.appareil ?? "Appareil inconnu"}
          {ou && ` · ${ou}`} · {quand(alerte.creeLe)}
        </p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium">
          <button type="button" onClick={() => void traiter(false)} className="text-primaire-texte hover:underline">
            C'est moi
          </button>
          {alerte.sessionActive && (
            <button type="button" onClick={() => void traiter(true)} className="text-danger hover:underline">
              Ce n'est pas moi : déconnecter
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
