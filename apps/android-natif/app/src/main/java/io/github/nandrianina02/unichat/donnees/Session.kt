package io.github.nandrianina02.unichat.donnees

import android.os.Build
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

sealed interface EtatSession {
    data object Anonyme : EtatSession
    data object Connecte : EtatSession
}

/**
 * La session de l'appareil. Elle tient tant que le coffre a un jeton ; un
 * refus 401 du serveur (session expirée, fermée depuis un autre appareil)
 * la ramène à l'écran de connexion.
 */
class Session(private val reseau: Reseau, private val stockage: StockageJeton) {
    private val _etat = MutableStateFlow<EtatSession>(if (stockage.lire() != null) EtatSession.Connecte else EtatSession.Anonyme)
    val etat: StateFlow<EtatSession> = _etat.asStateFlow()

    /** Première étape : le nonce que Google placera dans son jeton. */
    suspend fun nonce(): NonceNatif = appel { reseau.api.nonce() }.getOrThrow()

    /** Seconde étape : le jeton Google contre une session UniChat. */
    suspend fun connecter(etat: String, jetonGoogle: String) {
        val session = appel { reseau.api.connexion(ConnexionNatif(etat, jetonGoogle, nomAppareil())) }.getOrThrow()
        stockage.ecrire(session.jeton)
        _etat.value = EtatSession.Connecte
    }

    /** Par numéro : le code reçu par SMS contre une session (le compte se crée s'il n'existe pas). */
    suspend fun demanderCodeConnexion(numero: String): DemandeConnexionTelephone =
        appel { reseau.api.demanderConnexionTelephone(DemandeTelephone(numero)) }.getOrThrow()

    suspend fun connecterParTelephone(demande: String, code: String) {
        val session = appel { reseau.api.connexionTelephone(ConnexionTelephone(demande, code, nomAppareil())) }.getOrThrow()
        stockage.ecrire(session.jeton)
        _etat.value = EtatSession.Connecte
    }

    /** Ferme la session sur le serveur ; sans réseau, l'appareil l'oublie quand même. */
    suspend fun deconnecter() {
        appel { reseau.api.deconnexion() }
        oublier()
    }

    /** Branché par le conteneur : la session fermée, l'espace du compte s'arrête (temps réel compris). */
    var surFermeture: (() -> Unit)? = null

    fun oublier() {
        stockage.ecrire(null)
        surFermeture?.invoke()
        _etat.value = EtatSession.Anonyme
    }

    /** Un appel qui exige la session : un 401 la ferme sur l'appareil. */
    suspend fun <T> connecte(bloc: suspend () -> T): Result<T> = appel(bloc).onFailure {
        if (it is ErreurServeur && it.statut == 401) oublier()
    }
}

/** « Samsung SM-A155F » : ce qu'on lit dans la liste des appareils connectés, sur le web comme ici. */
fun nomAppareil(fabricant: String = Build.MANUFACTURER, modele: String = Build.MODEL): String {
    val marque = fabricant.replaceFirstChar { it.uppercase() }
    val nom = if (modele.startsWith(fabricant, ignoreCase = true)) modele else "$marque $modele"
    return nom.take(80)
}
