package io.github.nandrianina02.unichat.chiffrement

/*
 * Code de sécurité, porté de code.ts, sur le modèle du numéro de sécurité
 * de Signal : une empreinte par personne (identité et compte), les deux
 * réunies, la plus petite d'abord, pour que chacun lise les mêmes 60
 * chiffres. Les 5 200 tours de SHA-512 rendent très coûteuse la fabrication
 * d'une autre identité qui donnerait les mêmes chiffres.
 */

private const val VERSION_CODE_SECURITE: Byte = 0
private const val TOURS = 5200
private const val TAILLE_EMPREINTE = 32
/** Préfixe du QR code : un autre QR code (liaison d'appareil, lien) est reconnu comme tel. */
private const val PREFIXE_QR = "unichat-code:"

class Partie(val compte: String, val identite: IdentitePublique)

class CodeDeSecurite(
    /** 60 chiffres, identiques des deux côtés. */
    val chiffres: String,
    /** Contenu du QR code : version, mon empreinte, puis la sienne. */
    val qr: String,
)

enum class ResultatScan { IDENTIQUE, DIFFERENT, INVALIDE }

private fun empreinte(p: Partie): ByteArray {
    val cle = encoderIdentite(p.identite)
    var h = sha512(assembler(byteArrayOf(0, VERSION_CODE_SECURITE), cle, texteVersOctets(p.compte)))
    repeat(TOURS) { h = sha512(assembler(h, cle)) }
    return h.tranche(0, TAILLE_EMPREINTE)
}

/** Six blocs de 5 octets, chacun ramené à 5 chiffres : 30 chiffres par personne. */
private fun chiffres(e: ByteArray): String {
    val texte = StringBuilder()
    for (i in 0 until 30 step 5) {
        var n = 0L
        for (j in 0 until 5) n = n * 256 + (e[i + j].toLong() and 0xff)
        texte.append((n % 100000).toString().padStart(5, '0'))
    }
    return texte.toString()
}

fun codeSecurite(moi: Partie, autre: Partie): CodeDeSecurite {
    val a = empreinte(moi)
    val b = empreinte(autre)
    val ca = chiffres(a)
    val cb = chiffres(b)
    return CodeDeSecurite(
        if (ca < cb) ca + cb else cb + ca,
        PREFIXE_QR + versBase64(assembler(byteArrayOf(VERSION_CODE_SECURITE), a, b)),
    )
}

/** Le code affiché par l'autre porte son empreinte puis la mienne : l'inverse du mien. */
fun comparerCodeScanne(scanne: String, mien: CodeDeSecurite): ResultatScan {
    if (!scanne.startsWith(PREFIXE_QR)) return ResultatScan.INVALIDE
    val lu = try {
        depuisBase64(scanne.removePrefix(PREFIXE_QR))
    } catch (e: IllegalArgumentException) {
        return ResultatScan.INVALIDE
    }
    if (lu.size != 1 + 2 * TAILLE_EMPREINTE || lu[0] != VERSION_CODE_SECURITE) return ResultatScan.INVALIDE
    val m = depuisBase64(mien.qr.removePrefix(PREFIXE_QR))
    fun sien(o: ByteArray) = o.tranche(1, 1 + TAILLE_EMPREINTE)
    fun autre(o: ByteArray) = o.tranche(1 + TAILLE_EMPREINTE)
    return if (egaux(sien(lu), autre(m)) && egaux(autre(lu), sien(m))) ResultatScan.IDENTIQUE else ResultatScan.DIFFERENT
}
