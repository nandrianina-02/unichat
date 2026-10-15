import clsx from "clsx";

/** Bulle de discussion portant un « U » : le symbole d'UniChat. */
export function Logo({ className, plein = true }: { className?: string; plein?: boolean }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={clsx(plein ? "text-primaire" : "text-texte-3", className)}>
      <path
        fill="currentColor"
        d="M24 3C12.4 3 3 11.5 3 22c0 5.6 2.7 10.6 7 14.1L8.4 45l9-4.8c2.1.6 4.3.8 6.6.8 11.6 0 21-8.5 21-19S35.6 3 24 3z"
      />
      <path
        className={plein ? "stroke-sur-primaire" : "stroke-fond"}
        fill="none"
        strokeLinecap="round"
        strokeWidth="3.4"
        d="M16.5 14.5v8.2a7.5 7.5 0 0 0 15 0v-8.2"
      />
    </svg>
  );
}
