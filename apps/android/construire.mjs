// Construit l'application Android d'UniChat : la PWA en ligne, enveloppée
// dans une Trusted Web Activity par Bubblewrap (la méthode de Google).
//
//   cd apps/android && npm install && npm run construire
//
// Produit sortie/UniChat.apk (installation directe) et sortie/UniChat.aab
// (Play Store), signés avec la clé du dossier UNICHAT_CLES (par défaut
// ~/.unichat-android). Cette clé est créée au premier lancement : elle doit
// être sauvegardée, car une application ne se met à jour qu'avec la même clé.

import { AndroidSdkTools, Config, ConsoleLog, DigitalAssetLinks, JdkHelper, TwaGenerator, TwaManifest } from "@bubblewrap/core";
import Color from "color";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const ORIGINE = process.env.UNICHAT_ORIGINE ?? "https://unichat.unichat-server.workers.dev";
// Identifiant définitif sur Android : rattaché au compte GitHub du projet, que l'on maîtrise.
const PAQUET = "io.github.nandrianina02.unichat";
const ALIAS = "unichat";
const CLES = process.env.UNICHAT_CLES ?? path.join(os.homedir(), ".unichat-android");
const MAGASIN = path.join(CLES, "unichat.keystore");
const FICHIER_SECRET = path.join(CLES, "motdepasse.txt");
const JDK = process.env.UNICHAT_JDK ?? "C:\\Program Files\\Android\\Android Studio\\jbr";
const SDK = process.env.ANDROID_HOME ?? path.join(process.env.LOCALAPPDATA ?? os.homedir(), "Android", "Sdk");
const OUTILS = path.join(SDK, "build-tools", "36.1.0");
const JAVA = path.join(JDK, "bin");
const PROJET = path.join(ICI, "projet");
const SORTIE = path.join(ICI, "sortie");

const log = new ConsoleLog("unichat");
const executer = promisify(execFile);

/**
 * Lance un outil du JDK ou du SDK. Le mot de passe de la clé ne passe que
 * par une variable d'environnement (`:env`) : jamais en argument, donc ni
 * dans la liste des processus ni dans un message d'erreur.
 */
async function lancer(programme, args, secret) {
  try {
    const { stdout } = await executer(programme, args, {
      env: { ...process.env, UNICHAT_SECRET: secret ?? "", JAVA_HOME: JDK },
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } catch (erreur) {
    throw new Error(`${path.basename(programme)} a échoué : ${String(erreur.stderr || erreur.stdout || "").slice(0, 800)}`);
  }
}

const version = JSON.parse(await fs.readFile(path.join(ICI, "version.json"), "utf8"));
const config = new Config(JDK, SDK);
const jdk = new JdkHelper(process, config);
// Construit directement : `create` exige l'arborescence du SDK que Bubblewrap
// télécharge lui-même (dossier `tools` ou `bin`), absente du SDK d'Android
// Studio. Les outils utilisés ici (build-tools 36.1.0, Android 36) y sont.
const sdk = new AndroidSdkTools(process, config, jdk, log);
if (!(await sdk.checkBuildTools())) throw new Error("build-tools 36.1.0 manquants : installez-les depuis Android Studio (SDK Manager).");

// --- Clé de signature ------------------------------------------------------------
await fs.mkdir(CLES, { recursive: true });
let secret = await fs.readFile(FICHIER_SECRET, "utf8").then((t) => t.trim(), () => "");
if (!secret) {
  secret = randomBytes(24).toString("base64url");
  await lancer(path.join(JAVA, "keytool.exe"), [
    "-genkeypair",
    "-keystore", MAGASIN,
    "-storetype", "PKCS12",
    "-alias", ALIAS,
    "-keyalg", "RSA",
    "-keysize", "3072",
    "-validity", "25000",
    "-dname", "CN=UniChat, OU=UniChat, O=UniChat, C=MG",
    "-storepass:env", "UNICHAT_SECRET",
    "-keypass:env", "UNICHAT_SECRET",
  ], secret);
  await fs.writeFile(FICHIER_SECRET, `${secret}\n`, { mode: 0o600 });
  log.warn(`Clé de signature créée dans ${CLES} : sauvegardez ce dossier, il est indispensable pour publier une mise à jour.`);
}
const liste = await lancer(path.join(JAVA, "keytool.exe"), ["-list", "-v", "-keystore", MAGASIN, "-alias", ALIAS, "-storepass:env", "UNICHAT_SECRET"], secret);
// « SHA256: » en anglais, « SHA 256: » en français : le motif accepte les deux.
const empreinte = /SHA[ -]?256\s*:\s*([0-9A-F:]{95})/i.exec(liste)?.[1];
if (!empreinte) throw new Error("Empreinte SHA-256 de la clé introuvable.");

// --- Projet Android, à partir du manifeste en ligne -------------------------------
const manifeste = await TwaManifest.fromWebManifest(`${ORIGINE}/manifest.webmanifest`);
Object.assign(manifeste, {
  packageId: PAQUET,
  name: "UniChat",
  launcherName: "UniChat",
  startUrl: "/?source=application",
  // Les notifications de la PWA passent par l'application (icône et nom d'UniChat).
  enableNotifications: true,
  // Couleurs de l'en-tête de l'application, en clair et en sombre.
  themeColor: new Color("#f0f2f5"),
  themeColorDark: new Color("#1b1c25"),
  navigationColor: new Color("#ffffff"),
  navigationColorDark: new Color("#12131a"),
  navigationDividerColor: new Color("#e6e8ef"),
  navigationDividerColorDark: new Color("#262733"),
  backgroundColor: new Color("#eff1f5"),
  appVersionCode: version.code,
  appVersionName: version.nom,
  signingKey: { path: MAGASIN, alias: ALIAS },
  fallbackType: "customtabs",
  enableSiteSettingsShortcut: false,
  orientation: "default",
  // Android 7.0 au minimum : exigé par la bibliothèque de Google (androidbrowserhelper).
  minSdkVersion: 24,
  fingerprints: [{ name: "unichat", value: empreinte }],
  generatorApp: "unichat-construire",
});
const probleme = manifeste.validate();
if (probleme) throw new Error(`Manifeste invalide : ${probleme}`);

await fs.rm(PROJET, { recursive: true, force: true });
await new TwaGenerator().createTwaProject(PROJET, manifeste, log);
await manifeste.saveToFile(path.join(PROJET, "twa-manifest.json"));

// --- Construction et signature ----------------------------------------------------
// Gradle signe lui-même (APK alignée et AAB) : la clé est désignée par des
// variables d'environnement, jamais écrite dans le projet. Cela évite aussi
// zipalign.exe, que certains antivirus bloquent à tort.
const gradle = path.join(PROJET, "app", "build.gradle");
const script = await fs.readFile(gradle, "utf8");
const signature = `    signingConfigs {
        release {
            storeFile file(System.getenv("UNICHAT_MAGASIN"))
            storePassword System.getenv("UNICHAT_SECRET")
            keyAlias System.getenv("UNICHAT_ALIAS")
            keyPassword System.getenv("UNICHAT_SECRET")
        }
    }

    buildTypes {
        release {
            signingConfig signingConfigs.release
`;
if (!script.includes("    buildTypes {\n        release {\n")) throw new Error("build.gradle inattendu : section buildTypes introuvable.");
await fs.writeFile(gradle, script.replace("    buildTypes {\n        release {\n", signature));

// Gradle lancé depuis le dossier du projet : le lanceur de Bubblewrap ne
// trouve pas gradlew.bat sous Windows.
await new Promise((resoudre, rejeter) => {
  const windows = process.platform === "win32";
  const enfant = spawn(windows ? "cmd.exe" : "./gradlew", windows ? ["/d", "/c", `${path.join(PROJET, "gradlew.bat")} assembleRelease bundleRelease --no-daemon`] : ["assembleRelease", "bundleRelease", "--no-daemon"], {
    cwd: PROJET,
    env: { ...process.env, ...sdk.getEnv(), JAVA_HOME: JDK, UNICHAT_MAGASIN: MAGASIN, UNICHAT_ALIAS: ALIAS, UNICHAT_SECRET: secret },
    stdio: "inherit",
    windowsHide: true,
  });
  enfant.on("error", rejeter);
  enfant.on("exit", (code) => (code === 0 ? resoudre() : rejeter(new Error(`Gradle a échoué (code ${code}).`))));
});

await fs.rm(SORTIE, { recursive: true, force: true });
await fs.mkdir(SORTIE, { recursive: true });
const apk = path.join(SORTIE, "UniChat.apk");
await fs.copyFile(path.join(PROJET, "app", "build", "outputs", "apk", "release", "app-release.apk"), apk);
await fs.copyFile(path.join(PROJET, "app", "build", "outputs", "bundle", "release", "app-release.aab"), path.join(SORTIE, "UniChat.aab"));
// Vérification par apksigner (une archive Java, lancée par java : rien d'exécutable à part).
const verification = await lancer(path.join(JAVA, "java.exe"), ["-jar", path.join(OUTILS, "lib", "apksigner.jar"), "verify", "--print-certs", apk]);
if (!verification.replace(/:/g, "").toUpperCase().includes(empreinte.replace(/:/g, "").toUpperCase())) {
  throw new Error("L'APK n'est pas signée avec la clé attendue.");
}
await fs.writeFile(path.join(SORTIE, "assetlinks.json"), DigitalAssetLinks.generateAssetLinks(PAQUET, empreinte));

log.info(`Paquet : ${PAQUET}, version ${version.nom} (${version.code})`);
log.info(`Empreinte SHA-256 à déclarer (ANDROID_EMPREINTES) : ${empreinte}`);
log.info(`Fichiers : ${SORTIE}`);
