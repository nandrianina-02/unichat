import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Chargement } from "../composants/Chargement";
import { ErreurApi } from "./api";
import { useCompte, useMoi } from "./compte";
import { Messagerie, type Instantane } from "./messagerie";
import type { MessageLocal } from "./stockage";

const Contexte = createContext<Messagerie | null>(null);

export function FournisseurMessagerie({ children }: { children: ReactNode }) {
  const moi = useMoi();
  const { sessionPerdue } = useCompte();
  const [messagerie, setMessagerie] = useState<Messagerie | null>(null);

  useEffect(() => {
    const instance = new Messagerie(moi.id, () => sessionPerdue(new ErreurApi("session_fermee", "Session fermée.", 401)));
    let active = true;
    void instance.demarrer().then(() => active && setMessagerie(instance));
    return () => {
      active = false;
      instance.arreter();
    };
  }, [moi.id, sessionPerdue]);

  if (!messagerie) return <Chargement />;
  return <Contexte.Provider value={messagerie}>{children}</Contexte.Provider>;
}

export function useMessagerie(): { messagerie: Messagerie; etat: Instantane } {
  const messagerie = useContext(Contexte);
  if (!messagerie) throw new Error("useMessagerie hors de FournisseurMessagerie");
  const etat = useSyncExternalStore(messagerie.abonner, messagerie.instantane);
  return { messagerie, etat };
}

/** Messages d'une discussion, relus à chaque changement signalé par la messagerie. */
export function useMessages(conversation: string): MessageLocal[] | null {
  const { messagerie, etat } = useMessagerie();
  const version = etat.versions[conversation] ?? 0;
  const [messages, setMessages] = useState<MessageLocal[] | null>(null);
  useEffect(() => {
    let actif = true;
    void messagerie.messages(conversation).then((liste) => actif && setMessages(liste));
    return () => {
      actif = false;
    };
  }, [messagerie, conversation, version]);
  return messages;
}
