import type { TableauAdmin } from "@unichat/shared";
import clsx from "clsx";
import { Flag } from "lucide-react";
import { useState } from "react";
import { tailleFichier } from "../../lib/format";
import { dateCourte, nombre } from "./outils";

/** Offre gratuite de D1 : 500 Mo par base. */
const BASE_MAX = 500 * 1024 * 1024;

/** Chiffres chargés par l'en-tête de l'administration, qui en tire aussi le nombre de signalements. */
export function Tableau({ t, onSignalements }: { t: TableauAdmin; onSignalements: () => void }) {

  const tuiles: { libelle: string; valeur: string; detail?: string }[] = [
    { libelle: "Actifs sur 24 heures", valeur: nombre(t.actifs24h) },
    { libelle: "Actifs sur 7 jours", valeur: nombre(t.actifs7j) },
    { libelle: "Nouveaux comptes, 7 jours", valeur: nombre(t.nouveaux7j) },
    { libelle: "Appareils connectés", valeur: nombre(t.appareils) },
    { libelle: "Groupes", valeur: nombre(t.groupes) },
    { libelle: "Fichiers stockés", valeur: nombre(t.fichiers), detail: tailleFichier(t.octetsFichiers) },
    { libelle: "Notifications activées", valeur: nombre(t.abonnementsPush), detail: "appareils abonnés" },
    { libelle: "Comptes avec clés", valeur: nombre(t.comptesChiffres), detail: "chiffrement préparé" },
  ];
  const part = Math.min(1, t.octetsBase / BASE_MAX);

  return (
    <div className="space-y-8 pb-10">
      <section className="animate-rise grid gap-8 border-b border-bordure pb-8 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div>
          <p className="text-[13px] text-texte-2">Comptes</p>
          <p className="mt-1 text-[52px] leading-none font-semibold text-texte">{nombre(t.comptes)}</p>
          <p className="mt-3 text-[13px] text-texte-2">
            dont {nombre(t.inacheves)} inscription{t.inacheves > 1 ? "s" : ""} inachevée{t.inacheves > 1 ? "s" : ""}, {nombre(t.suspendus)} suspendu
            {t.suspendus > 1 ? "s" : ""}
          </p>
          <button
            type="button"
            onClick={onSignalements}
            className={clsx(
              "mt-6 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
              t.signalementsOuverts > 0 ? "bg-danger-doux text-danger hover:opacity-90" : "bg-entete text-texte-2 hover:text-texte",
            )}
          >
            <Flag size={16} />
            {t.signalementsOuverts > 0 ? `${t.signalementsOuverts} signalement${t.signalementsOuverts > 1 ? "s" : ""} à examiner` : "Aucun signalement à examiner"}
          </button>
        </div>
        <Inscriptions jours={t.inscriptions} />
      </section>

      <section className="animate-rise stagger-1 grid grid-cols-2 border-t border-l border-bordure md:grid-cols-4">
        {tuiles.map((tuile) => (
          <div key={tuile.libelle} className="border-r border-b border-bordure px-4 py-4">
            <p className="text-[12.5px] text-texte-2">{tuile.libelle}</p>
            <p className="mt-1.5 text-[24px] leading-tight font-semibold text-texte tabular-nums">{tuile.valeur}</p>
            {tuile.detail && <p className="mt-0.5 text-[12px] text-texte-3">{tuile.detail}</p>}
          </div>
        ))}
      </section>

      <section className="animate-rise stagger-2 max-w-xl">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-[14px] text-texte">Base de données</p>
          <p className="text-[13px] text-texte-2 tabular-nums">
            {tailleFichier(t.octetsBase)} sur 500 Mo
          </p>
        </div>
        <div
          role="meter"
          aria-label="Place occupée par la base de données"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(part * 100)}
          className="mt-2 h-2 overflow-hidden rounded-full bg-primaire-doux"
        >
          <div className={clsx("h-full rounded-full", part > 0.8 ? "bg-danger" : "bg-primaire")} style={{ width: `${Math.max(part * 100, 1)}%` }} />
        </div>
        <p className="mt-2 text-[12.5px] text-texte-3">Offre gratuite de Cloudflare D1. Les messages n'y sont pas : ils restent sur les appareils.</p>
      </section>
    </div>
  );
}

/** Graduation ronde au-dessus du plus haut jour : 1, 2, 5, 10, 20, 50… */
function plafond(max: number): number {
  if (max <= 5) return Math.max(1, max);
  const puissance = 10 ** Math.floor(Math.log10(max));
  return [1, 2, 5, 10].map((p) => p * puissance).find((v) => v >= max)!;
}

/** Inscriptions par jour : une série, des colonnes fines, une bulle au survol. */
function Inscriptions({ jours }: { jours: TableauAdmin["inscriptions"] }) {
  const [survol, setSurvol] = useState<number | null>(null);
  const haut = plafond(Math.max(...jours.map((j) => j.nombre)));
  const total = jours.reduce((n, j) => n + j.nombre, 0);
  const etiquette = (jour: number) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(new Date(jour));

  return (
    <figure className="min-w-0">
      <figcaption className="flex items-baseline justify-between gap-4">
        <span className="text-[14px] text-texte">Inscriptions, 14 derniers jours</span>
        <span className="text-[13px] text-texte-2 tabular-nums">{nombre(total)} au total</span>
      </figcaption>
      <div className="mt-4 flex gap-3">
        <div className="flex h-36 flex-col justify-between text-right text-[11px] text-texte-3 tabular-nums" aria-hidden="true">
          <span className="-translate-y-1.5">{haut}</span>
          <span className="translate-y-1.5">0</span>
        </div>
        <div className="relative h-36 min-w-0 flex-1 border-t border-b border-bordure" onMouseLeave={() => setSurvol(null)}>
          <div className="flex h-full items-end">
            {jours.map((j, i) => (
              <div
                key={j.jour}
                tabIndex={0}
                role="img"
                aria-label={`${dateCourte(j.jour)} : ${j.nombre} inscription${j.nombre > 1 ? "s" : ""}`}
                onMouseEnter={() => setSurvol(i)}
                onFocus={() => setSurvol(i)}
                onBlur={() => setSurvol(null)}
                className="relative flex h-full flex-1 items-end justify-center outline-none focus-visible:bg-survol"
              >
                {j.nombre > 0 && (
                  <span
                    className={clsx("w-full max-w-[24px] rounded-t-[4px] transition-opacity", survol !== null && survol !== i ? "bg-primaire/45" : "bg-primaire")}
                    style={{ height: `${(j.nombre / haut) * 100}%` }}
                  />
                )}
                {survol === i && (
                  <span
                    className={clsx(
                      "animate-fade pointer-events-none absolute bottom-full z-10 mb-2 whitespace-nowrap rounded-md bg-panneau px-2.5 py-1.5 text-[12px] text-texte shadow-lg ring-1 ring-bordure",
                      i < 3 ? "left-0" : i > jours.length - 4 ? "right-0" : "left-1/2 -translate-x-1/2",
                    )}
                  >
                    <span className="text-texte-2">{dateCourte(j.jour)}</span> · {j.nombre} inscription{j.nombre > 1 ? "s" : ""}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-1.5 flex justify-between pl-7 text-[11px] text-texte-3" aria-hidden="true">
        <span>{etiquette(jours[0]!.jour)}</span>
        <span>{etiquette(jours[7]!.jour)}</span>
        <span>{etiquette(jours.at(-1)!.jour)}</span>
      </div>
      <table className="sr-only">
        <caption>Inscriptions par jour</caption>
        <tbody>
          {jours.map((j) => (
            <tr key={j.jour}>
              <th scope="row">{dateCourte(j.jour)}</th>
              <td>{j.nombre}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
