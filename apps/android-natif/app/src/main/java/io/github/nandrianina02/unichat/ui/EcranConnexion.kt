package io.github.nandrianina02.unichat.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.clickable
import io.github.nandrianina02.unichat.Conteneur
import io.github.nandrianina02.unichat.R
import io.github.nandrianina02.unichat.donnees.ConnexionAnnulee
import io.github.nandrianina02.unichat.donnees.jetonGoogle
import io.github.nandrianina02.unichat.donnees.messageErreur
import kotlinx.coroutines.launch

/**
 * Connexion par Google uniquement, comme sur le web. Le compte se choisit
 * dans la feuille du système ; le serveur vérifie le jeton et ouvre la
 * session de cet appareil.
 */
@Composable
fun EcranConnexion(conteneur: Conteneur) {
    val p = LocalPalette.current
    val contexte = LocalContext.current
    val portee = rememberCoroutineScope()
    var enCours by remember { mutableStateOf(false) }
    var erreur by remember { mutableStateOf<String?>(null) }

    fun connecter() {
        if (enCours) return
        enCours = true
        erreur = null
        portee.launch {
            try {
                val demande = conteneur.session.nonce()
                conteneur.session.connecter(demande.etat, jetonGoogle(contexte, demande.nonce))
            } catch (e: ConnexionAnnulee) {
                // Feuille fermée : on reste sur l'écran, sans message.
            } catch (e: Exception) {
                erreur = e.message?.takeIf { e !is java.io.IOException } ?: messageErreur(e)
            } finally {
                enCours = false
            }
        }
    }

    Column(
        Modifier.fillMaxSize().background(p.fond).safeDrawingPadding().padding(horizontal = 28.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Image(
            painterResource(R.mipmap.ic_launcher),
            contentDescription = null,
            modifier = Modifier.size(64.dp).clip(RoundedCornerShape(16.dp)),
        )
        Spacer(Modifier.height(24.dp))
        Text("UniChat", color = p.texte, fontSize = 32.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(8.dp))
        Text(
            "Vos discussions, sur le téléphone comme sur l'ordinateur.",
            color = p.texte2, fontSize = 16.sp, lineHeight = 22.sp,
        )
        Spacer(Modifier.height(40.dp))
        Row(
            Modifier
                .fillMaxWidth()
                .height(52.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(p.primaire)
                .clickable(enabled = !enCours, role = Role.Button, onClickLabel = "Continuer avec Google") { connecter() },
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (enCours) {
                CircularProgressIndicator(Modifier.size(20.dp), color = p.surPrimaire, strokeWidth = 2.dp)
            } else {
                Icon(painterResource(R.drawable.lucide_log_in), contentDescription = null, tint = p.surPrimaire, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(10.dp))
                Text("Continuer avec Google", color = p.surPrimaire, fontSize = 16.sp, fontWeight = FontWeight.Medium)
            }
        }
        Box(Modifier.fillMaxWidth().padding(top = 16.dp)) {
            erreur?.let { Text(it, color = p.danger, fontSize = 14.sp, textAlign = TextAlign.Start) }
        }
    }
}
