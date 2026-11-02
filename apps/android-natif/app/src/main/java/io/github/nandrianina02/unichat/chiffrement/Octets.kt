package io.github.nandrianina02.unichat.chiffrement

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

/*
 * Outils sur les octets, portés de packages/chiffrement/src/octets.ts : les
 * deux implémentations doivent produire exactement les mêmes octets (jeux
 * d'essai croisés dans les tests).
 */

private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
private val VALEURS = IntArray(128) { -1 }.also { t -> ALPHABET.forEachIndexed { i, c -> t[c.code] = i } }

/** Base64 « URL » sans remplissage : passe tel quel dans du JSON et dans une adresse. */
fun versBase64(octets: ByteArray): String {
    val texte = StringBuilder()
    var i = 0
    while (i < octets.size) {
        val a = octets[i].toInt() and 0xff
        val b = if (i + 1 < octets.size) octets[i + 1].toInt() and 0xff else null
        val c = if (i + 2 < octets.size) octets[i + 2].toInt() and 0xff else null
        texte.append(ALPHABET[a shr 2]).append(ALPHABET[((a and 3) shl 4) or ((b ?: 0) shr 4)])
        if (b != null) texte.append(ALPHABET[((b and 15) shl 2) or ((c ?: 0) shr 6)])
        if (c != null) texte.append(ALPHABET[c and 63])
        i += 3
    }
    return texte.toString()
}

fun depuisBase64(texte: String): ByteArray {
    if (texte.length % 4 == 1) throw IllegalArgumentException("Base64 invalide.")
    val octets = ByteArray(texte.length * 3 / 4)
    var tampon = 0
    var bits = 0
    var j = 0
    for (c in texte) {
        val v = if (c.code < 128) VALEURS[c.code] else -1
        if (v < 0) throw IllegalArgumentException("Base64 invalide.")
        tampon = (tampon shl 6) or v
        bits += 6
        if (bits >= 8) {
            bits -= 8
            octets[j++] = ((tampon shr bits) and 0xff).toByte()
        }
    }
    return octets
}

fun assembler(vararg parties: ByteArray): ByteArray {
    val resultat = ByteArray(parties.sumOf { it.size })
    var decalage = 0
    for (p in parties) {
        p.copyInto(resultat, decalage)
        decalage += p.size
    }
    return resultat
}

/** Comparaison en temps constant : la durée ne dit rien de l'endroit où les octets diffèrent. */
fun egaux(a: ByteArray, b: ByteArray): Boolean {
    if (a.size != b.size) return false
    var difference = 0
    for (i in a.indices) difference = difference or (a[i].toInt() xor b[i].toInt())
    return difference == 0
}

fun texteVersOctets(texte: String): ByteArray = texte.toByteArray(Charsets.UTF_8)

/** Décodage strict, comme TextDecoder({ fatal: true }) : un octet invalide est une erreur, pas un caractère de remplacement. */
fun octetsVersTexte(octets: ByteArray): String =
    Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(octets))
        .toString()

fun entier32(n: Long): ByteArray {
    if (n < 0 || n > 0xffffffffL) throw IllegalArgumentException("Entier hors limites.")
    return byteArrayOf((n shr 24).toByte(), (n shr 16).toByte(), (n shr 8).toByte(), n.toByte())
}

fun lireEntier32(octets: ByteArray, decalage: Int): Long {
    if (decalage + 4 > octets.size) throw IllegalArgumentException("Message tronqué.")
    var n = 0L
    for (i in 0 until 4) n = (n shl 8) or (octets[decalage + i].toLong() and 0xff)
    return n
}

fun versHex(octets: ByteArray): String = octets.joinToString("") { "%02x".format(it.toInt() and 0xff) }

fun ByteArray.tranche(debut: Int, fin: Int = size): ByteArray = copyOfRange(debut, fin)
