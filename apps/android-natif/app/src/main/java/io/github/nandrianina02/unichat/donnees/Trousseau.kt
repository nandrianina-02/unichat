package io.github.nandrianina02.unichat.donnees

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import io.github.nandrianina02.unichat.chiffrement.empreinteSha256
import io.github.nandrianina02.unichat.chiffrement.versHex
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Où vivent les clés privées : le trousseau chiffré en vrai, une table en mémoire dans les tests. */
interface Rangement {
    fun lire(cle: String): JsonElement?
    fun ecrire(cle: String, valeur: JsonElement)
    fun effacer(cle: String)
    /** Tout le contenu part : il appartenait à une autre identité, ou à un essai qui n'a pas abouti. */
    fun vider()
}

class RangementMemoire : Rangement {
    private val table = HashMap<String, JsonElement>()
    override fun lire(cle: String) = table[cle]
    override fun ecrire(cle: String, valeur: JsonElement) {
        table[cle] = valeur
    }
    override fun effacer(cle: String) {
        table.remove(cle)
    }
    override fun vider() = table.clear()
}

/**
 * Trousseau d'un compte : identité, clés de l'appareil, sessions Double
 * Ratchet. Chaque entrée est un fichier chiffré en AES-256-GCM par une clé
 * du Keystore Android, qui ne quitte jamais le matériel sécurisé : une
 * copie des fichiers ne livre rien. Ces clés ne sortent jamais du téléphone
 * (sauf l'identité, scellée, quand on relie un autre appareil).
 */
class Trousseau(contexte: Context, compte: String) : Rangement {
    private val dossier = File(contexte.filesDir, "trousseau/$compte").apply { mkdirs() }

    private fun fichier(cle: String) = File(dossier, versHex(empreinteSha256(cle.toByteArray(Charsets.UTF_8))))

    private fun cleKeystore(): SecretKey {
        val magasin = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (magasin.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generateur = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generateur.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generateur.generateKey()
    }

    @Synchronized
    override fun lire(cle: String): JsonElement? {
        val f = fichier(cle)
        if (!f.exists()) return null
        val octets = f.readBytes()
        val chiffre = Cipher.getInstance("AES/GCM/NoPadding")
        chiffre.init(Cipher.DECRYPT_MODE, cleKeystore(), GCMParameterSpec(128, octets, 0, 12))
        return Json.parseToJsonElement(String(chiffre.doFinal(octets, 12, octets.size - 12), Charsets.UTF_8))
    }

    @Synchronized
    override fun ecrire(cle: String, valeur: JsonElement) {
        val chiffre = Cipher.getInstance("AES/GCM/NoPadding")
        chiffre.init(Cipher.ENCRYPT_MODE, cleKeystore())
        val octets = chiffre.iv + chiffre.doFinal(valeur.toString().toByteArray(Charsets.UTF_8))
        // Écrit à côté puis renommé : une coupure en pleine écriture ne laisse pas une session à moitié rangée.
        val provisoire = File(dossier, "${fichier(cle).name}.tmp")
        provisoire.writeBytes(octets)
        if (!provisoire.renameTo(fichier(cle))) {
            fichier(cle).delete()
            provisoire.renameTo(fichier(cle))
        }
    }

    @Synchronized
    override fun effacer(cle: String) {
        fichier(cle).delete()
    }

    @Synchronized
    override fun vider() {
        dossier.listFiles()?.forEach { it.delete() }
    }

    private companion object {
        const val ALIAS = "unichat-trousseau"
    }
}
