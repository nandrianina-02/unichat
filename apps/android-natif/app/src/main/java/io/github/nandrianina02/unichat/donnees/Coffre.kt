package io.github.nandrianina02.unichat.donnees

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Où vit le jeton de session : le coffre en vrai, une simple variable dans les tests. */
interface StockageJeton {
    fun lire(): String?
    fun ecrire(jeton: String?)
}

/**
 * Le jeton de session, chiffré par une clé du Keystore Android : la clé ne
 * sort jamais du matériel sécurisé du téléphone, et une copie des
 * préférences (sauvegarde, accès root) ne livre qu'un texte illisible.
 */
class Coffre(contexte: Context) : StockageJeton {
    private val preferences = contexte.getSharedPreferences("coffre", Context.MODE_PRIVATE)

    private fun cle(): SecretKey {
        val magasin = KeyStore.getInstance(MAGASIN).apply { load(null) }
        (magasin.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generateur = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, MAGASIN)
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
    override fun lire(): String? {
        val brut = preferences.getString(CLE_JETON, null) ?: return null
        return runCatching {
            val octets = Base64.decode(brut, Base64.NO_WRAP)
            val chiffre = Cipher.getInstance(TRANSFORMATION)
            chiffre.init(Cipher.DECRYPT_MODE, cle(), GCMParameterSpec(128, octets, 0, TAILLE_IV))
            String(chiffre.doFinal(octets, TAILLE_IV, octets.size - TAILLE_IV), Charsets.UTF_8)
        }.getOrNull()
    }

    @Synchronized
    override fun ecrire(jeton: String?) {
        if (jeton == null) {
            preferences.edit().remove(CLE_JETON).apply()
            return
        }
        val chiffre = Cipher.getInstance(TRANSFORMATION)
        chiffre.init(Cipher.ENCRYPT_MODE, cle())
        val octets = chiffre.iv + chiffre.doFinal(jeton.toByteArray(Charsets.UTF_8))
        // commit plutôt qu'apply : un jeton renouvelé perdu à la fermeture de l'appli ferme la session.
        preferences.edit().putString(CLE_JETON, Base64.encodeToString(octets, Base64.NO_WRAP)).commit()
    }

    private companion object {
        const val MAGASIN = "AndroidKeyStore"
        const val ALIAS = "unichat-session"
        const val CLE_JETON = "jeton"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val TAILLE_IV = 12
    }
}
