package io.github.nandrianina02.unichat

import android.app.Application
import coil.ImageLoader
import io.github.nandrianina02.unichat.donnees.Coffre
import io.github.nandrianina02.unichat.donnees.EspaceCompte
import io.github.nandrianina02.unichat.donnees.MiseAJour
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import io.github.nandrianina02.unichat.donnees.Reseau
import io.github.nandrianina02.unichat.donnees.Session

class UniChatApp : Application() {
    val conteneur by lazy { Conteneur(this) }
}

/** Ce que partagent tous les écrans : le réseau, la session, le chargeur d'images. */
class Conteneur(private val app: Application) {
    private val coffre = Coffre(app)
    val reseau = Reseau(BuildConfig.SERVEUR, coffre)
    val session = Session(reseau, coffre)
    val miseAJour = MiseAJour(app)
    /** Recherche de mise à jour demandée (Compte, notification) : la fenêtre de l'activité y répond. */
    val demandeMiseAJour = MutableStateFlow(false)
    /** Temps réel et déchiffrement : hors du fil de l'interface. */
    val portee = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private var espaceOuvert: EspaceCompte? = null

    init {
        session.surFermeture = { fermerEspace() }
    }

    /** L'espace du compte connecté ; un autre compte ferme le précédent. */
    @Synchronized
    fun espace(moi: String): EspaceCompte {
        espaceOuvert?.takeIf { it.moi == moi }?.let { return it }
        espaceOuvert?.fermer()
        return EspaceCompte(app, reseau, BuildConfig.SERVEUR, session, moi, portee).also { espaceOuvert = it }
    }

    /** Déconnexion : le temps réel s'arrête ; les discussions restent sur l'appareil. */
    @Synchronized
    fun fermerEspace() {
        espaceOuvert?.fermer()
        espaceOuvert = null
    }

    /** Les photos de profil exigent la session : le chargeur passe par le même client que l'API. */
    val images: ImageLoader = ImageLoader.Builder(app).okHttpClient(reseau.client).crossfade(true).build()

    /** L'adresse de la photo d'une personne, comme sur le web (apps/web/src/lib/api.ts). */
    fun photo(id: String, version: String, taille: Int = 128) =
        "${BuildConfig.SERVEUR}api/personnes/$id/photo?taille=$taille&v=$version"
}
