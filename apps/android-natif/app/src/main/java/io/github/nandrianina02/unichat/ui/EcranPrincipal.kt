package io.github.nandrianina02.unichat.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.nandrianina02.unichat.Conteneur
import io.github.nandrianina02.unichat.donnees.EtatChiffrement
import io.github.nandrianina02.unichat.donnees.Moi
import io.github.nandrianina02.unichat.donnees.conversationDirecte
import io.github.nandrianina02.unichat.donnees.messageErreur
import kotlinx.coroutines.launch

/** Ce qu'affiche l'appli connectée : la liste, une discussion, le compte, ou la recherche d'une personne. */
private sealed interface Vue {
    data object Liste : Vue
    data object Compte : Vue
    data object Nouvelle : Vue
    data object NouveauGroupe : Vue
    data class InfosGroupe(val conversation: String) : Vue
    data class Discussion(val conversation: String) : Vue
}

/**
 * L'appli une fois connectée. Les clés de l'appareil décident de l'écran :
 * à relier, il faut d'abord le relier ; prêt, ses discussions s'affichent.
 */
@Composable
fun EcranPrincipal(conteneur: Conteneur) {
    val p = LocalPalette.current
    var moi by remember { mutableStateOf<Moi?>(null) }
    var erreur by remember { mutableStateOf<String?>(null) }
    var essai by remember { mutableIntStateOf(0) }

    LaunchedEffect(essai) {
        erreur = null
        conteneur.session.connecte { conteneur.reseau.api.moi() }
            .onSuccess { moi = it }
            .onFailure { erreur = messageErreur(it) }
    }

    val m = moi
    if (m == null) {
        Box(Modifier.fillMaxSize().background(p.fond), contentAlignment = Alignment.Center) {
            val e = erreur
            if (e == null) {
                CircularProgressIndicator(Modifier.size(28.dp), color = p.primaire, strokeWidth = 2.dp)
            } else {
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(32.dp)) {
                    Text(e, color = p.texte2, fontSize = 15.sp)
                    Text(
                        "Réessayer", color = p.primaire, fontSize = 15.sp, fontWeight = FontWeight.Medium,
                        modifier = Modifier.padding(top = 12.dp).clickable(role = Role.Button) { essai++ },
                    )
                }
            }
        }
        return
    }

    val espace = remember(m.id) { conteneur.espace(m.id) }
    val portee = rememberCoroutineScope()
    LaunchedEffect(espace) { espace.preparer() }
    val chiffrement by espace.chiffrement.collectAsStateWithLifecycle()
    var vue by remember { mutableStateOf<Vue>(Vue.Liste) }
    var conversationOuverte by rememberSaveable { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { conversationOuverte?.let { vue = Vue.Discussion(it) } }
    BackHandler(enabled = vue != Vue.Liste) {
        // Depuis les infos d'un groupe, le retour ramène à sa discussion.
        when (val v = vue) {
            is Vue.InfosGroupe -> vue = Vue.Discussion(v.conversation)
            Vue.NouveauGroupe -> vue = Vue.Nouvelle
            else -> {
                vue = Vue.Liste
                conversationOuverte = null
            }
        }
    }

    // Glissement court (250 ms) vers la discussion ouverte, retour en sens inverse.
    AnimatedContent(
        targetState = if (chiffrement == EtatChiffrement.A_RELIER && vue == Vue.Liste) null else vue,
        transitionSpec = {
            val avance = when (targetState) {
                is Vue.InfosGroupe, Vue.NouveauGroupe, Vue.Compte, Vue.Nouvelle -> true
                is Vue.Discussion -> initialState !is Vue.InfosGroupe
                else -> false
            }
            (slideInHorizontally(tween(250)) { l -> if (avance) l / 6 else -l / 6 } + fadeIn(tween(250))) togetherWith fadeOut(tween(150))
        },
        label = "vue",
    ) { v ->
        when (v) {
            null -> EcranRelier(espace, onCompte = { vue = Vue.Compte }, onRelie = { portee.launch { espace.preparer() } })
            Vue.Liste -> EcranDiscussions(
                espace, conteneur, chiffrement,
                onOuvrir = {
                    conversationOuverte = it
                    vue = Vue.Discussion(it)
                },
                onCompte = { vue = Vue.Compte },
                onReessayer = { portee.launch { espace.preparer() } },
                onNouvelle = { vue = Vue.Nouvelle },
            )
            Vue.Compte -> EcranCompte(conteneur, onRetour = { vue = Vue.Liste })
            Vue.Nouvelle -> EcranNouvelleDiscussion(
                espace, conteneur, onRetour = { vue = Vue.Liste },
                onOuvrir = { id ->
                    val c = conversationDirecte(espace.moi, id)
                    conversationOuverte = c
                    vue = Vue.Discussion(c)
                },
                onNouveauGroupe = { vue = Vue.NouveauGroupe },
            )
            Vue.NouveauGroupe -> EcranNouveauGroupe(espace, conteneur, onRetour = { vue = Vue.Nouvelle }, onCree = { c ->
                conversationOuverte = c
                vue = Vue.Discussion(c)
            })
            is Vue.InfosGroupe -> EcranInfosGroupe(
                espace, conteneur, v.conversation.removePrefix("g:"),
                onRetour = { vue = Vue.Discussion(v.conversation) },
                onEcrire = { id ->
                    val c = conversationDirecte(espace.moi, id)
                    conversationOuverte = c
                    vue = Vue.Discussion(c)
                },
                onQuitte = { vue = Vue.Discussion(v.conversation) },
            )
            is Vue.Discussion -> EcranDiscussion(
                espace, conteneur, v.conversation,
                onRetour = {
                    conversationOuverte = null
                    vue = Vue.Liste
                },
                onInfos = { vue = Vue.InfosGroupe(v.conversation) },
            )
        }
    }
}
