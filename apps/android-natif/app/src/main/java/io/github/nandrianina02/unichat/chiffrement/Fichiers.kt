package io.github.nandrianina02.unichat.chiffrement

/*
 * Fichier chiffré sur l'appareil avant l'envoi, porté de fichier.ts : une
 * clé propre au fichier, AES-256-GCM, le nonce devant le texte chiffré. La
 * clé ne voyage que dans le message chiffré qui accompagne le fichier.
 */

private const val TAILLE_NONCE_FICHIER = 12

/** Nonce devant, étiquette d'authentification derrière. */
const val SURCOUT_FICHIER = TAILLE_NONCE_FICHIER + 16

class FichierScelle(val scelle: ByteArray, val cle: ByteArray)

fun chiffrerOctets(clair: ByteArray): FichierScelle {
    val cle = aleatoire(32)
    val nonce = aleatoire(TAILLE_NONCE_FICHIER)
    return FichierScelle(assembler(nonce, chiffrerAead(cle, nonce, clair, ByteArray(0))), cle)
}

/** Un fichier altéré, tronqué ou ouvert avec une autre clé est refusé (étiquette GCM). */
fun dechiffrerOctets(scelle: ByteArray, cle: ByteArray): ByteArray {
    if (scelle.size < SURCOUT_FICHIER || cle.size != 32) throw ErreurAltere("Fichier chiffré invalide.")
    return try {
        dechiffrerAead(cle, scelle.tranche(0, TAILLE_NONCE_FICHIER), scelle.tranche(TAILLE_NONCE_FICHIER), ByteArray(0))
    } catch (e: ErreurAltere) {
        throw ErreurAltere("Fichier altéré ou clé incorrecte.")
    }
}
