// Publie sortie/UniChat.apk comme version GitHub du dépôt : hébergement
// gratuit, et l'adresse …/releases/latest/download/UniChat.apk mène
// toujours à la dernière version (lien de l'application web).
//
//   npm run construire && node publier.mjs
//
// Le jeton vient de GITHUB_TOKEN, ou de l'aide aux identifiants de git ; il
// n'est jamais affiché.

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const DEPOT = "nandrianina-02/unichat";
const version = JSON.parse(await fs.readFile(path.join(ICI, "version.json"), "utf8"));
const etiquette = `android-v${version.nom}`;

function jeton() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const sortie = execFileSync("git", ["credential", "fill"], { input: "protocol=https\nhost=github.com\n\n", encoding: "utf8" });
  const motDePasse = /^password=(.+)$/m.exec(sortie)?.[1];
  if (!motDePasse) throw new Error("Aucun jeton GitHub : définissez GITHUB_TOKEN.");
  return motDePasse.trim();
}

const enTetes = { Authorization: `Bearer ${jeton()}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };

async function api(chemin, init = {}) {
  const reponse = await fetch(`https://api.github.com${chemin}`, { ...init, headers: { ...enTetes, ...init.headers } });
  if (!reponse.ok && reponse.status !== 404) throw new Error(`GitHub ${chemin} : ${reponse.status} ${await reponse.text()}`);
  return reponse.status === 404 ? null : reponse.json();
}

let version_ = await api(`/repos/${DEPOT}/releases/tags/${etiquette}`);
if (!version_) {
  version_ = await api(`/repos/${DEPOT}/releases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: etiquette,
      target_commitish: "main",
      name: `UniChat pour Android ${version.nom}`,
      body: [
        "Application Android d'UniChat (Trusted Web Activity) : la même application que sur le web, avec ses notifications.",
        "",
        "Installation : téléchargez UniChat.apk sur le téléphone, ouvrez-le, puis autorisez l'installation depuis cette source si Android le demande.",
      ].join("\n"),
    }),
  });
}
// Un fichier du même nom déjà publié pour cette version est remplacé.
for (const ancien of version_.assets ?? []) {
  if (ancien.name === "UniChat.apk") await api(`/repos/${DEPOT}/releases/assets/${ancien.id}`, { method: "DELETE" });
}
const apk = await fs.readFile(path.join(ICI, "sortie", "UniChat.apk"));
const envoi = await fetch(`https://uploads.github.com/repos/${DEPOT}/releases/${version_.id}/assets?name=UniChat.apk`, {
  method: "POST",
  headers: { ...enTetes, "Content-Type": "application/vnd.android.package-archive" },
  body: apk,
});
if (!envoi.ok) throw new Error(`Envoi de l'APK : ${envoi.status} ${await envoi.text()}`);
console.log(`Publié : https://github.com/${DEPOT}/releases/tag/${etiquette} (${Math.round(apk.length / 1024)} Ko)`);
