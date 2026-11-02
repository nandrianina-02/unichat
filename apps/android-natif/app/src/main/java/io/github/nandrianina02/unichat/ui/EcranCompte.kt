package io.github.nandrianina02.unichat.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import io.github.nandrianina02.unichat.Conteneur
import io.github.nandrianina02.unichat.R
import io.github.nandrianina02.unichat.donnees.AppareilConnecte
import io.github.nandrianina02.unichat.donnees.Moi
import io.github.nandrianina02.unichat.donnees.messageErreur
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Le compte connecté, ses appareils, et la déconnexion. */
@Composable
fun EcranCompte(conteneur: Conteneur, onRetour: () -> Unit) {
    val p = LocalPalette.current
    val portee = rememberCoroutineScope()
    var moi by remember { mutableStateOf<Moi?>(null) }
    var appareils by remember { mutableStateOf<List<AppareilConnecte>?>(null) }
    var erreur by remember { mutableStateOf<String?>(null) }
    var essai by remember { mutableStateOf(0) }
    var sortie by remember { mutableStateOf(false) }

    LaunchedEffect(essai) {
        erreur = null
        conteneur.session.connecte { conteneur.reseau.api.moi() }
            .onSuccess { moi = it }
            .onFailure { erreur = messageErreur(it) }
        conteneur.session.connecte { conteneur.reseau.api.appareils() }
            .onSuccess { appareils = it.appareils.sortedByDescending { a -> a.actuel } }
    }

    LazyColumn(
        Modifier.fillMaxSize().background(p.fond).safeDrawingPadding(),
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item(key = "titre") {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 4.dp)) {
                Icon(
                    painterResource(R.drawable.lucide_arrow_left), contentDescription = "Retour", tint = p.texte,
                    modifier = Modifier.size(40.dp).clip(CircleShape).clickable(role = Role.Button, onClick = onRetour).padding(9.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text("Compte", color = p.texte, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
            }
        }
        item(key = "moi") {
            Box(Modifier.entree(0)) {
                val m = moi
                when {
                    m != null -> CarteMoi(conteneur, m)
                    erreur != null -> Carte {
                        Text(erreur!!, color = p.texte2, fontSize = 15.sp)
                        Text(
                            "Réessayer", color = p.primaire, fontSize = 15.sp, fontWeight = FontWeight.Medium,
                            modifier = Modifier.padding(top = 8.dp).clickable(role = Role.Button) { essai++ },
                        )
                    }
                    else -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(Modifier.size(24.dp), color = p.primaire, strokeWidth = 2.dp)
                    }
                }
            }
        }
        appareils?.let { liste ->
            item(key = "appareils-titre") {
                Text("Appareils connectés", color = p.texte2, fontSize = 13.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = 8.dp, start = 4.dp).entree(1))
            }
            itemsIndexed(liste, key = { _, a -> a.id }) { i, a -> LigneAppareil(a, Modifier.entree(i + 3)) }
        }
        item(key = "sortie") {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(top = 12.dp)
                    .height(48.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .border(1.dp, p.bordure, RoundedCornerShape(12.dp))
                    .clickable(enabled = !sortie, role = Role.Button) {
                        sortie = true
                        portee.launch {
                            conteneur.fermerEspace()
                            conteneur.session.deconnecter()
                        }
                    },
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(painterResource(R.drawable.lucide_log_out), contentDescription = null, tint = p.danger, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("Se déconnecter", color = p.danger, fontSize = 15.sp, fontWeight = FontWeight.Medium)
            }
        }
    }
}

@Composable
private fun CarteMoi(conteneur: Conteneur, moi: Moi) {
    val p = LocalPalette.current
    Carte {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(conteneur, moi)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(moi.nom, color = p.texte, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                moi.pseudo?.let { Text("@$it", color = p.texte2, fontSize = 14.sp, maxLines = 1) }
                Text(moi.email, color = p.texte3, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@Composable
private fun Avatar(conteneur: Conteneur, moi: Moi) {
    val p = LocalPalette.current
    val version = moi.photo
    if (version != null) {
        AsyncImage(
            model = conteneur.photo(moi.id, version),
            imageLoader = conteneur.images,
            contentDescription = "Photo de profil",
            contentScale = ContentScale.Crop,
            modifier = Modifier.size(56.dp).clip(CircleShape).background(p.primaireDoux),
        )
    } else {
        Box(Modifier.size(56.dp).clip(CircleShape).background(p.primaireDoux), contentAlignment = Alignment.Center) {
            Text(moi.nom.trim().take(1).uppercase(), color = p.primaireTexte, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun LigneAppareil(a: AppareilConnecte, modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    val icone = when (a.plateforme) {
        "android" -> R.drawable.lucide_smartphone
        "desktop" -> R.drawable.lucide_monitor
        else -> R.drawable.lucide_globe
    }
    Carte(modifier) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(painterResource(icone), contentDescription = null, tint = p.texte2, modifier = Modifier.size(22.dp))
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(a.appareil, color = p.texte, fontSize = 15.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val lieu = listOfNotNull(a.ville, a.pays).joinToString(", ")
                if (lieu.isNotEmpty()) Text(lieu, color = p.texte3, fontSize = 13.sp)
            }
            if (a.actuel) {
                Text(
                    "Cet appareil", color = p.primaireTexte, fontSize = 12.sp, fontWeight = FontWeight.Medium,
                    modifier = Modifier.clip(CircleShape).background(p.primaireDoux).padding(horizontal = 10.dp, vertical = 4.dp),
                )
            }
        }
    }
}

@Composable
private fun Carte(modifier: Modifier = Modifier, contenu: @Composable () -> Unit) {
    val p = LocalPalette.current
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(p.panneau)
            .border(1.dp, p.bordure, RoundedCornerShape(14.dp))
            .padding(16.dp),
    ) { contenu() }
}

/**
 * Entrée d'un bloc : fondu et 8 dp de montée en 300 ms, 40 ms d'écart entre
 * deux blocs, comme les briques d'animation du web. Pas de rebond.
 */
@Composable
fun Modifier.entree(rang: Int): Modifier {
    val avancement = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        delay(minOf(rang, 6) * 40L)
        avancement.animateTo(1f, tween(300))
    }
    return graphicsLayer {
        alpha = avancement.value
        translationY = (1f - avancement.value) * 8.dp.toPx()
    }
}
