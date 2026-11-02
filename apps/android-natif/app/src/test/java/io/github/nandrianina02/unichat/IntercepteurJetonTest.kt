package io.github.nandrianina02.unichat

import io.github.nandrianina02.unichat.donnees.ErreurServeur
import io.github.nandrianina02.unichat.donnees.Reseau
import io.github.nandrianina02.unichat.donnees.StockageJeton
import io.github.nandrianina02.unichat.donnees.appel
import io.github.nandrianina02.unichat.donnees.nomAppareil
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class IntercepteurJetonTest {
    private val serveur = MockWebServer()
    private val stockage = object : StockageJeton {
        var jeton: String? = null
        override fun lire() = jeton
        override fun ecrire(jeton: String?) {
            this.jeton = jeton
        }
    }

    @Before
    fun demarrer() = serveur.start()

    @After
    fun arreter() = serveur.shutdown()

    private fun reseau() = Reseau(serveur.url("/").toString(), stockage)

    private fun json(corps: String) = MockResponse().setHeader("Content-Type", "application/json").setBody(corps)

    @Test
    fun pose_le_jeton_et_garde_celui_que_le_serveur_renouvelle() = runTest {
        stockage.jeton = "ancien"
        serveur.enqueue(json("""{"id":"u1","email":"ana@exemple.mg","nom":"Ana"}""").setHeader("X-UniChat-Jeton", "nouveau"))
        serveur.enqueue(json("""{"appareils":[]}"""))
        val r = reseau()

        assertEquals("Ana", r.api.moi().nom)
        assertEquals("Bearer ancien", serveur.takeRequest().getHeader("Authorization"))
        // La requête suivante part avec le jeton renouvelé : l'ancien, réutilisé, fermerait la session.
        r.api.appareils()
        assertEquals("Bearer nouveau", serveur.takeRequest().getHeader("Authorization"))
        assertEquals("nouveau", stockage.jeton)
    }

    @Test
    fun sans_session_aucun_en_tete() = runTest {
        serveur.enqueue(json("""{"etat":"e","nonce":"n"}"""))
        reseau().api.nonce()
        assertNull(serveur.takeRequest().getHeader("Authorization"))
    }

    @Test
    fun un_refus_du_serveur_garde_son_code_et_son_message() = runTest {
        serveur.enqueue(json("""{"erreur":"etat_invalide","message":"La connexion a expiré. Réessayez."}""").setResponseCode(400))
        val erreur = appel { reseau().api.nonce() }.exceptionOrNull()
        assertTrue(erreur is ErreurServeur)
        erreur as ErreurServeur
        assertEquals(400, erreur.statut)
        assertEquals("etat_invalide", erreur.code)
        assertEquals("La connexion a expiré. Réessayez.", erreur.message)
    }

    @Test
    fun nom_de_l_appareil_sans_marque_en_double() {
        assertEquals("Samsung SM-A155F", nomAppareil("samsung", "SM-A155F"))
        assertEquals("Google Pixel 8", nomAppareil("Google", "Google Pixel 8"))
    }
}
