package io.github.nandrianina02.unichat

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.nandrianina02.unichat.donnees.EXTRA_MISE_A_JOUR
import io.github.nandrianina02.unichat.donnees.EtatSession
import io.github.nandrianina02.unichat.donnees.VerificationMiseAJour
import io.github.nandrianina02.unichat.ui.FenetreMiseAJour
import io.github.nandrianina02.unichat.ui.EcranPrincipal
import io.github.nandrianina02.unichat.ui.EcranConnexion
import io.github.nandrianina02.unichat.ui.ThemeUniChat

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val conteneur = (application as UniChatApp).conteneur
        if (intent?.getBooleanExtra(EXTRA_MISE_A_JOUR, false) == true) conteneur.demandeMiseAJour.value = true
        VerificationMiseAJour.programmer(this)
        setContent {
            ThemeUniChat {
                val etat by conteneur.session.etat.collectAsStateWithLifecycle()
                val demandee by conteneur.demandeMiseAJour.collectAsStateWithLifecycle()
                // Android 13 : les notifications (nouvelle version, puis messages) demandent une autorisation, une fois connecté.
                val autorisation = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
                LaunchedEffect(etat) {
                    if (etat == EtatSession.Connecte && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                        ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                    ) {
                        autorisation.launch(Manifest.permission.POST_NOTIFICATIONS)
                    }
                }
                // Un fondu de 250 ms entre la connexion et l'accueil : le changement d'état se voit sans saut.
                Crossfade(etat, animationSpec = tween(250), label = "session") { e ->
                    when (e) {
                        EtatSession.Anonyme -> EcranConnexion(conteneur)
                        EtatSession.Connecte -> EcranPrincipal(conteneur)
                    }
                }
                FenetreMiseAJour(conteneur.miseAJour, demandee) { conteneur.demandeMiseAJour.value = false }
            }
        }
    }

    /** La notification « Nouvelle version » touchée alors que l'appli est ouverte. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.getBooleanExtra(EXTRA_MISE_A_JOUR, false)) (application as UniChatApp).conteneur.demandeMiseAJour.value = true
    }
}
