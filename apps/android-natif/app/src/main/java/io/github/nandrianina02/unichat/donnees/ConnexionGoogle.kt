package io.github.nandrianina02.unichat.donnees

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import io.github.nandrianina02.unichat.BuildConfig

/** La connexion a été fermée par la personne : rien à afficher. */
class ConnexionAnnulee : Exception()

/**
 * Le compte Google choisi dans la feuille du système (Credential Manager).
 * Le jeton rendu porte le nonce délivré par le serveur, et son audience est
 * l'identifiant client web du serveur : c'est lui qui le vérifie.
 */
suspend fun jetonGoogle(contexte: Context, nonce: String): String {
    val option = GetGoogleIdOption.Builder()
        .setServerClientId(BuildConfig.GOOGLE_CLIENT_WEB)
        .setNonce(nonce)
        .setFilterByAuthorizedAccounts(false)
        .setAutoSelectEnabled(false)
        .build()
    val demande = GetCredentialRequest.Builder().addCredentialOption(option).build()
    val resultat = try {
        CredentialManager.create(contexte).getCredential(contexte, demande)
    } catch (e: GetCredentialCancellationException) {
        throw ConnexionAnnulee()
    } catch (e: NoCredentialException) {
        throw Exception("Aucun compte Google n'est disponible sur ce téléphone. Ajoutez-en un dans les paramètres d'Android.")
    } catch (e: GetCredentialException) {
        throw Exception("Google n'a pas pu ouvrir la connexion. Réessayez.")
    }
    val identifiant = resultat.credential
    if (identifiant is CustomCredential && identifiant.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
        return GoogleIdTokenCredential.createFrom(identifiant.data).idToken
    }
    throw Exception("Google a répondu sans identité. Réessayez.")
}
