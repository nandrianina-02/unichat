package io.github.nandrianina02.unichat

import android.app.Application
import coil.ImageLoader
import io.github.nandrianina02.unichat.donnees.Coffre
import io.github.nandrianina02.unichat.donnees.Reseau
import io.github.nandrianina02.unichat.donnees.Session

class UniChatApp : Application() {
    val conteneur by lazy { Conteneur(this) }
}

/** Ce que partagent tous les écrans : le réseau, la session, le chargeur d'images. */
class Conteneur(app: Application) {
    private val coffre = Coffre(app)
    val reseau = Reseau(BuildConfig.SERVEUR, coffre)
    val session = Session(reseau, coffre)

    /** Les photos de profil exigent la session : le chargeur passe par le même client que l'API. */
    val images: ImageLoader = ImageLoader.Builder(app).okHttpClient(reseau.client).crossfade(true).build()

    /** L'adresse de la photo d'une personne, comme sur le web (apps/web/src/lib/api.ts). */
    fun photo(id: String, version: String, taille: Int = 128) =
        "${BuildConfig.SERVEUR}api/personnes/$id/photo?taille=$taille&v=$version"
}
