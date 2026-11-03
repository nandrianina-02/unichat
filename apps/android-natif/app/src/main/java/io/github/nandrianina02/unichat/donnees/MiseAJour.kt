package io.github.nandrianina02.unichat.donnees

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import io.github.nandrianina02.unichat.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Une version plus récente que celle installée, publiée sur GitHub. */
data class VersionDisponible(val version: String, val adresse: String, val tailleMo: Double?)

/** « 2.10.0 » contre « 2.9.1 » : chiffre par chiffre, pas en texte. */
fun plusRecente(candidate: String, installee: String): Boolean {
    fun nombres(v: String) = v.trim().removePrefix("v").split('.', '-').map { it.toIntOrNull() ?: 0 }
    val a = nombres(candidate)
    val b = nombres(installee)
    for (i in 0 until maxOf(a.size, b.size)) {
        val x = a.getOrElse(i) { 0 }
        val y = b.getOrElse(i) { 0 }
        if (x != y) return x > y
    }
    return false
}

/** Le fichier joint à chaque publication de l'appli native (workflow android-natif.yml). */
const val FICHIER_APK = "unichat.apk"
/** Les publications de l'appli native ; « android-v… » était l'ancienne appli, qu'il ne faut pas proposer. */
private const val PREFIXE_TAG = "natif-v"
private const val API_PUBLICATIONS = "https://api.github.com/repos/nandrianina-02/unichat/releases?per_page=15"

@Serializable
private data class Publication(
    @SerialName("tag_name") val tag: String = "",
    val draft: Boolean = false,
    val prerelease: Boolean = false,
    val assets: List<FichierPublie> = emptyList(),
)

@Serializable
private data class FichierPublie(
    val name: String = "",
    @SerialName("browser_download_url") val adresse: String = "",
    val size: Long = 0,
)

/**
 * La plus récente version publiée de l'appli native, dans la liste des
 * publications GitHub. Les pré-versions (les APK d'essai) et les brouillons
 * ne comptent pas, pas plus qu'une publication sans APK.
 */
fun dernierePubliee(json: String): VersionDisponible? {
    val liste = runCatching { JsonUniChat.decodeFromString(ListSerializer(Publication.serializer()), json) }.getOrNull() ?: return null
    return liste
        .filter { !it.draft && !it.prerelease && it.tag.startsWith(PREFIXE_TAG) }
        .mapNotNull { p ->
            val apk = p.assets.firstOrNull { it.name == FICHIER_APK } ?: return@mapNotNull null
            VersionDisponible(p.tag.removePrefix(PREFIXE_TAG), apk.adresse, apk.size.takeIf { it > 0 }?.let { it / 1_048_576.0 })
        }
        .reduceOrNull { a, b -> if (plusRecente(b.version, a.version)) b else a }
}

/**
 * Tant que l'appli n'est pas sur le Play Store, rien ne la met à jour toute
 * seule. Elle consulte les publications du dépôt, propose une version une
 * fois (« Plus tard » l'écarte jusqu'à la suivante), la télécharge elle-même
 * et ouvre l'installateur d'Android, qui la pose par-dessus : même
 * identifiant, même signature, données gardées.
 *
 * Un client à part, sans le jeton de session : GitHub n'a pas à le recevoir.
 */
class MiseAJour(private val contexte: Context) {
    private val client = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).build()
    private val preferences = contexte.getSharedPreferences("mise-a-jour", Context.MODE_PRIVATE)
    private val dossier get() = File(contexte.cacheDir, "mise-a-jour")

    /**
     * `demandee` : la recherche lancée à la main (Compte, ou la notification
     * touchée). Elle passe outre « Plus tard », qui ne vaut que pour la
     * proposition faite au démarrage.
     */
    suspend fun disponible(demandee: Boolean = false): VersionDisponible? {
        val candidate = publiee() ?: return null
        if (!plusRecente(candidate.version, BuildConfig.VERSION_NAME)) return null
        if (!demandee && preferences.getString("ignoree", null) == candidate.version) return null
        return candidate
    }

    /** Un échec (réseau, limite d'appels de GitHub) vaut « rien de nouveau » : on retentera plus tard. */
    private suspend fun publiee(): VersionDisponible? = withContext(Dispatchers.IO) {
        runCatching {
            val requete = Request.Builder().url(API_PUBLICATIONS).header("Accept", "application/vnd.github+json").build()
            client.newCall(requete).execute().use { r -> if (r.isSuccessful) dernierePubliee(r.body?.string().orEmpty()) else null }
        }.getOrNull()
    }

    /** « Plus tard » : on ne reparle de cette version qu'à la suivante. */
    fun ignorer(version: String) = preferences.edit().putString("ignoree", version).apply()

    /** La notification d'une version n'est envoyée qu'une fois. */
    fun dejaAnnoncee(version: String) = preferences.getString("annoncee", null) == version
    fun annoncee(version: String) = preferences.edit().putString("annoncee", version).apply()

    /**
     * Télécharge l'APK dans le cache de l'appli, en signalant la progression
     * (0 à 1, ou null quand la taille est inconnue). Le fichier n'est rangé
     * sous son nom final qu'une fois complet : un téléchargement coupé ne
     * laisse jamais un APK tronqué à installer.
     */
    suspend fun telecharger(v: VersionDisponible, progression: (Float?) -> Unit): File = withContext(Dispatchers.IO) {
        dossier.mkdirs()
        dossier.listFiles()?.forEach { it.delete() }
        val partiel = File(dossier, "unichat-${v.version}.part")
        val final = File(dossier, "unichat-${v.version}.apk")
        client.newCall(Request.Builder().url(v.adresse).build()).execute().use { r ->
            if (!r.isSuccessful) throw IOException("Téléchargement refusé (${r.code}).")
            val corps = r.body ?: throw IOException("Téléchargement vide.")
            val total = corps.contentLength().takeIf { it > 0 }
            var recu = 0L
            var dernier = -1
            corps.byteStream().use { entree ->
                partiel.outputStream().use { sortie ->
                    val tampon = ByteArray(64 * 1024)
                    while (true) {
                        ensureActive()
                        val n = entree.read(tampon)
                        if (n < 0) break
                        sortie.write(tampon, 0, n)
                        recu += n
                        // Un signal par pour cent : assez pour une barre fluide, sans inonder l'interface.
                        val pourcent = total?.let { (recu * 100 / it).toInt() } ?: -1
                        if (pourcent != dernier) {
                            dernier = pourcent
                            withContext(Dispatchers.Main) { progression(total?.let { recu.toFloat() / it }) }
                        }
                    }
                }
            }
            if (total != null && recu != total) throw IOException("Téléchargement incomplet.")
        }
        if (!partiel.renameTo(final)) throw IOException("Le fichier téléchargé n'a pas pu être rangé.")
        final
    }

    /** Android 8 et plus demande d'autoriser l'appli à installer des applications, une fois. */
    fun peutInstaller(): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.O || contexte.packageManager.canRequestPackageInstalls()

    /** La page des réglages où l'on accorde cette autorisation à UniChat. */
    fun intentionAutorisation(): Intent =
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${contexte.packageName}"))

    /** L'installateur d'Android, sur l'APK téléchargé (partagé par FileProvider, jamais par un chemin brut). */
    fun intentionInstallation(apk: File): Intent {
        val uri = FileProvider.getUriForFile(contexte, "${contexte.packageName}.fichiers", apk)
        return Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    }
}
