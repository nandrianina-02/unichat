package io.github.nandrianina02.unichat.chiffrement

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/*
 * Liaison d'un appareil, portée de liaison.ts : l'identité du compte passe
 * d'un appareil déjà relié (le « donneur ») à un nouveau (le « receveur »),
 * par le serveur, sans qu'il puisse la lire ni s'interposer. L'un affiche un
 * QR code (canal, clé éphémère, secret de 128 bits) ; l'autre le lit et
 * répond avec sa clé et une preuve qu'il a vu l'écran.
 */

enum class RoleLiaison { DONNEUR, RECEVEUR }

class CodeLiaison(
    val canal: String,
    /** Clé éphémère de l'appareil qui affiche le code. */
    val cle: ByteArray,
    val secret: ByteArray,
    /** Rôle de l'appareil qui affiche le code. */
    val role: RoleLiaison,
)

private const val VERSION_CODE = "UC1"
private const val TAILLE_SECRET = 16
private val MOTIF_CANAL = Regex("^[A-Za-z0-9_-]{22,64}$")

fun encoderCode(c: CodeLiaison): String =
    listOf(VERSION_CODE, c.canal, versBase64(c.cle), versBase64(c.secret), if (c.role == RoleLiaison.DONNEUR) "d" else "r").joinToString(".")

/** Lit un code scanné ou collé ; null s'il ne vient pas d'UniChat. */
fun lireCode(texte: String): CodeLiaison? {
    val parties = texte.trim().split(".")
    if (parties.size != 5 || parties[0] != VERSION_CODE || !MOTIF_CANAL.matches(parties[1]) || parties[4] !in listOf("d", "r")) return null
    return try {
        val cle = depuisBase64(parties[2])
        val secret = depuisBase64(parties[3])
        if (cle.size != TAILLE_CLE || secret.size != TAILLE_SECRET) return null
        CodeLiaison(parties[1], cle, secret, if (parties[4] == "d") RoleLiaison.DONNEUR else RoleLiaison.RECEVEUR)
    } catch (e: IllegalArgumentException) {
        null
    }
}

/** L'appareil qui affiche : une paire éphémère et un secret, tirés pour cette liaison seulement. */
fun preparerCode(canal: String, role: RoleLiaison): Pair<CodeLiaison, Paire> {
    val paire = paireEchange()
    return CodeLiaison(canal, paire.publique, aleatoire(TAILLE_SECRET), role) to paire
}

/** Preuve que l'appareil qui répond a bien lu le code à l'écran. */
fun preuveLiaison(code: CodeLiaison, cleReponse: ByteArray): ByteArray {
    val cleHmac = deriver(code.secret, ByteArray(32), "UniChat-liaison-preuve-v1", 32)
    return authentifier(cleHmac, assembler(texteVersOctets(code.canal), code.cle, cleReponse))
}

fun verifierPreuve(code: CodeLiaison, cleReponse: ByteArray, preuve: ByteArray) = egaux(preuveLiaison(code, cleReponse), preuve)

/** Clé commune : échange X25519 entre les deux paires éphémères, salé par le secret du code. */
fun cleCommune(code: CodeLiaison, maPaire: Paire, autreCle: ByteArray): ByteArray =
    deriver(echanger(maPaire.secrete, autreCle), code.secret, "UniChat-liaison-v1:${code.canal}", 32)

private fun associeLiaison(canal: String) = texteVersOctets("UniChat-liaison:$canal")
private fun associeHistorique(canal: String) = texteVersOctets("UniChat-historique:$canal")

@Serializable
private class IdentiteTransmise(val v: Int, val signature: String, val echange: String, val preuve: String)

private val jsonLiaison = Json { ignoreUnknownKeys = true }

fun scellerIdentite(cle: ByteArray, canal: String, i: IdentitePrivee): ByteArray {
    val contenu = jsonLiaison.encodeToString(
        IdentiteTransmise.serializer(),
        IdentiteTransmise(1, versBase64(i.signature.secrete), versBase64(i.echange.secrete), versBase64(i.preuve)),
    )
    return sceller(cle, texteVersOctets(contenu), associeLiaison(canal))
}

/** Identité reçue : clés publiques recalculées depuis les secrètes, preuve vérifiée. Une identité incohérente est refusée. */
fun ouvrirIdentite(cle: ByteArray, canal: String, scelle: ByteArray): IdentitePrivee {
    val brut = jsonLiaison.decodeFromString(IdentiteTransmise.serializer(), octetsVersTexte(ouvrir(cle, scelle, associeLiaison(canal))))
    if (brut.v != 1) throw IllegalArgumentException("Version de liaison inconnue.")
    val identite = identiteDepuisSecrets(depuisBase64(brut.signature), depuisBase64(brut.echange), depuisBase64(brut.preuve))
    if (!verifierIdentite(identite.publique())) throw IllegalArgumentException("Identité reçue incohérente.")
    return identite
}

/** Clé de l'archive d'historique, scellée sous la clé de la liaison : seul l'appareil relié peut l'ouvrir. */
fun scellerCleHistorique(cle: ByteArray, canal: String, cleArchive: ByteArray) = sceller(cle, cleArchive, associeHistorique(canal))

fun ouvrirCleHistorique(cle: ByteArray, canal: String, scelle: ByteArray): ByteArray {
    val cleArchive = ouvrir(cle, scelle, associeHistorique(canal))
    if (cleArchive.size != TAILLE_CLE) throw IllegalArgumentException("Clé d'historique invalide.")
    return cleArchive
}
