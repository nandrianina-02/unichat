import type { ReactNode } from "react";
import { Logo } from "./Logo";

/** Cadre des pages hors application (connexion, accueil) : marque en haut à gauche, carte au centre. */
export function Cadre({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-fond">
      <header className="mx-auto flex w-full max-w-[1000px] items-center gap-2.5 px-5 pt-8 pb-6 sm:pt-12">
        <Logo className="size-9" />
        <span className="text-lg font-semibold tracking-tight text-texte">UniChat</span>
      </header>
      <main className="mx-auto w-full max-w-[1000px] flex-1 px-4 pb-10">{children}</main>
    </div>
  );
}
