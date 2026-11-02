package io.github.nandrianina02.unichat.chiffrement

import org.bouncycastle.crypto.digests.SHA256Digest
import org.bouncycastle.crypto.generators.HKDFBytesGenerator
import org.bouncycastle.crypto.params.HKDFParameters
import org.bouncycastle.math.ec.rfc7748.X25519
import org.bouncycastle.math.ec.rfc8032.Ed25519
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/*
 * Primitives, portées de packages/chiffrement/src/primitives.ts : X25519 et
 * Ed25519 par BouncyCastle (licence de type MIT, comme noble côté web),
 * HKDF sur SHA-256 par BouncyCastle, HMAC-SHA256, SHA-512 et AES-256-GCM
 * par la plateforme. Mêmes tailles, mêmes étiquettes : les octets produits
 * sont ceux du web.
 */

class Paire(val secrete: ByteArray, val publique: ByteArray)

const val TAILLE_CLE = 32
const val TAILLE_SIGNATURE = 64
private const val TAILLE_NONCE = 12

private val hasard = SecureRandom()

fun aleatoire(taille: Int): ByteArray = ByteArray(taille).also(hasard::nextBytes)

fun paireEchange(): Paire {
    val secrete = ByteArray(TAILLE_CLE)
    X25519.generatePrivateKey(hasard, secrete)
    return Paire(secrete, publiqueEchange(secrete))
}

fun paireSignature(): Paire {
    val secrete = ByteArray(TAILLE_CLE)
    Ed25519.generatePrivateKey(hasard, secrete)
    return Paire(secrete, publiqueSignature(secrete))
}

/** Clés publiques recalculées depuis les secrètes : une identité reçue doit être cohérente. */
fun publiqueEchange(secrete: ByteArray): ByteArray = ByteArray(TAILLE_CLE).also { X25519.generatePublicKey(secrete, 0, it, 0) }

fun publiqueSignature(secrete: ByteArray): ByteArray = ByteArray(TAILLE_CLE).also { Ed25519.generatePublicKey(secrete, 0, it, 0) }

/** Secret partagé X25519. Une clé publique de petit ordre (secret nul) est refusée, comme noble. */
fun echanger(secrete: ByteArray, publique: ByteArray): ByteArray {
    if (publique.size != TAILLE_CLE) throw IllegalArgumentException("Clé publique invalide.")
    val partage = ByteArray(TAILLE_CLE)
    if (!X25519.calculateAgreement(secrete, 0, publique, 0, partage, 0)) throw IllegalArgumentException("Clé publique invalide.")
    return partage
}

fun signer(message: ByteArray, secrete: ByteArray): ByteArray =
    ByteArray(TAILLE_SIGNATURE).also { Ed25519.sign(secrete, 0, message, 0, message.size, it, 0) }

fun verifierSignature(signature: ByteArray, message: ByteArray, publique: ByteArray): Boolean {
    if (signature.size != TAILLE_SIGNATURE || publique.size != TAILLE_CLE) return false
    return runCatching { Ed25519.verify(signature, 0, publique, 0, message, 0, message.size) }.getOrDefault(false)
}

fun deriver(ikm: ByteArray, sel: ByteArray, info: String, taille: Int): ByteArray {
    val generateur = HKDFBytesGenerator(SHA256Digest())
    generateur.init(HKDFParameters(ikm, sel, texteVersOctets(info)))
    return ByteArray(taille).also { generateur.generateBytes(it, 0, taille) }
}

fun authentifier(cle: ByteArray, message: ByteArray): ByteArray =
    Mac.getInstance("HmacSHA256").run {
        init(SecretKeySpec(cle, "HmacSHA256"))
        doFinal(message)
    }

fun empreinteSha256(octets: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(octets)

fun sha512(octets: ByteArray): ByteArray = MessageDigest.getInstance("SHA-512").digest(octets)

/** Le contenu ne s'ouvre pas : altéré, tronqué ou clé incorrecte. */
class ErreurAltere(message: String = "Message altéré ou clé incorrecte.") : Exception(message)

/** AES-256-GCM avec un nonce donné : réservé aux clés à usage unique (clés de message). */
fun chiffrerAead(cle: ByteArray, nonce: ByteArray, clair: ByteArray, associe: ByteArray): ByteArray =
    Cipher.getInstance("AES/GCM/NoPadding").run {
        init(Cipher.ENCRYPT_MODE, SecretKeySpec(cle, "AES"), GCMParameterSpec(128, nonce))
        updateAAD(associe)
        doFinal(clair)
    }

fun dechiffrerAead(cle: ByteArray, nonce: ByteArray, chiffre: ByteArray, associe: ByteArray): ByteArray = try {
    Cipher.getInstance("AES/GCM/NoPadding").run {
        init(Cipher.DECRYPT_MODE, SecretKeySpec(cle, "AES"), GCMParameterSpec(128, nonce))
        updateAAD(associe)
        doFinal(chiffre)
    }
} catch (e: AEADBadTagException) {
    throw ErreurAltere()
} catch (e: IllegalArgumentException) {
    throw ErreurAltere()
}

/** Chiffrement sous une clé aléatoire (corps d'un message) : nonce tiré au hasard, placé devant. */
fun sceller(cle: ByteArray, clair: ByteArray, associe: ByteArray): ByteArray {
    val nonce = aleatoire(TAILLE_NONCE)
    return assembler(nonce, chiffrerAead(cle, nonce, clair, associe))
}

fun ouvrir(cle: ByteArray, scelle: ByteArray, associe: ByteArray): ByteArray {
    if (scelle.size < TAILLE_NONCE + 16) throw ErreurAltere("Contenu tronqué.")
    return dechiffrerAead(cle, scelle.tranche(0, TAILLE_NONCE), scelle.tranche(TAILLE_NONCE), associe)
}
