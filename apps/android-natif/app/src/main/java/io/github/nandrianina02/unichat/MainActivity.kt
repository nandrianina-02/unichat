package io.github.nandrianina02.unichat

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.nandrianina02.unichat.donnees.EtatSession
import io.github.nandrianina02.unichat.ui.EcranAccueil
import io.github.nandrianina02.unichat.ui.EcranConnexion
import io.github.nandrianina02.unichat.ui.ThemeUniChat

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val conteneur = (application as UniChatApp).conteneur
        setContent {
            ThemeUniChat {
                val etat by conteneur.session.etat.collectAsStateWithLifecycle()
                // Un fondu de 250 ms entre la connexion et l'accueil : le changement d'état se voit sans saut.
                Crossfade(etat, animationSpec = tween(250), label = "session") { e ->
                    when (e) {
                        EtatSession.Anonyme -> EcranConnexion(conteneur)
                        EtatSession.Connecte -> EcranAccueil(conteneur)
                    }
                }
            }
        }
    }
}
