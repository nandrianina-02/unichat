package io.github.nandrianina02.unichat.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
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
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import io.github.nandrianina02.unichat.Conteneur
import io.github.nandrianina02.unichat.R
import io.github.nandrianina02.unichat.donnees.ApercuDiscussion
import io.github.nandrianina02.unichat.donnees.EspaceCompte
import io.github.nandrianina02.unichat.donnees.EtatChiffrement
import io.github.nandrianina02.unichat.donnees.EtatConnexion
import io.github.nandrianina02.unichat.donnees.entier
import io.github.nandrianina02.unichat.donnees.texte
import io.github.nandrianina02.unichat.donnees.vrai
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** L'autre personne d'une discussion à deux (conversationDirecte « d:x:y »), ou null pour un groupe. */
fun autrePersonne(conversation: String, moi: String): String? {
    if (!conversation.startsWith("d:")) return null
    val (_, x, y) = conversation.split(":")
    return if (x == moi) y else x
}

/** Nom affiché d'une discussion : la personne, ou le groupe. */
fun nomDiscussion(espace: EspaceCompte, conversation: String): String {
    val autre = autrePersonne(conversation, espace.moi)
    return when {
        autre == null -> espace.annuaire.nomGroupe(conversation.removePrefix("g:")) ?: "Groupe"
        autre == espace.moi -> "Vous"
        else -> espace.annuaire.nomPersonne(autre) ?: "UniChat"
    }
}

fun nomPersonne(espace: EspaceCompte, id: String): String =
    if (id == espace.moi) "Vous" else espace.annuaire.nomPersonne(id) ?: "Quelqu'un"

/**
 * La liste des discussions, la plus récente en haut, avec le dernier
 * message et le nombre de non-lus : relue à chaque changement de la base.
 */
@Composable
fun EcranDiscussions(
    espace: EspaceCompte,
    conteneur: Conteneur,
    chiffrement: EtatChiffrement,
    onOuvrir: (String) -> Unit,
    onCompte: () -> Unit,
    onReessayer: () -> Unit,
    onNouvelle: () -> Unit,
) {
    val p = LocalPalette.current
    val version by espace.base.version.collectAsStateWithLifecycle()
    val connexion by espace.messagerie.connexion.collectAsStateWithLifecycle()
    val discussions by produceState<List<ApercuDiscussion>?>(null, version) {
        value = withContext(Dispatchers.IO) { espace.base.discussions(espace.moi) }
    }
    // Les personnes que la base ne connaît pas encore : leur nom est demandé une fois.
    LaunchedEffect(discussions) {
        val inconnues = discussions.orEmpty().mapNotNull { autrePersonne(it.conversation, espace.moi) }.filter { it != espace.moi }
        if (inconnues.isNotEmpty()) withContext(Dispatchers.IO) { espace.annuaire.completer(inconnues) }
    }

    Box(Modifier.fillMaxSize().background(p.fond).safeDrawingPadding()) {
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("UniChat", color = p.texte, fontSize = 24.sp, fontWeight = FontWeight.SemiBold)
                val etat = when {
                    chiffrement == EtatChiffrement.PREPARATION -> "Préparation des clés…"
                    connexion == EtatConnexion.CONNEXION -> "Connexion…"
                    connexion == EtatConnexion.HORS_LIGNE && chiffrement == EtatChiffrement.PRET -> "Hors ligne"
                    else -> null
                }
                etat?.let { Text(it, color = p.texte3, fontSize = 13.sp) }
            }
            Icon(
                painterResource(R.drawable.lucide_settings), contentDescription = "Compte", tint = p.texte2,
                modifier = Modifier.size(44.dp).clip(CircleShape).clickable(role = Role.Button, onClick = onCompte).padding(11.dp),
            )
        }
        if (chiffrement == EtatChiffrement.INDISPONIBLE) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp).clip(RoundedCornerShape(12.dp)).background(p.entete).padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Le service des clés ne répond pas. Vos messages arriveront dès qu'il répondra.", color = p.texte2, fontSize = 14.sp, modifier = Modifier.weight(1f))
                Text(
                    "Réessayer", color = p.primaire, fontSize = 14.sp, fontWeight = FontWeight.Medium,
                    modifier = Modifier.padding(start = 12.dp).clickable(role = Role.Button, onClick = onReessayer),
                )
            }
        }
        val liste = discussions
        when {
            liste == null -> Unit
            liste.isEmpty() -> Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Spacer(Modifier.height(48.dp))
                Icon(painterResource(R.drawable.lucide_message_circle), contentDescription = null, tint = p.texte3, modifier = Modifier.size(36.dp))
                Spacer(Modifier.height(12.dp))
                Text("Aucune discussion pour l'instant.", color = p.texte2, fontSize = 15.sp)
            }
            // Le bas de liste laisse la place au bouton « Nouvelle discussion ».
            else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 88.dp)) {
                itemsIndexed(liste, key = { _, d -> d.conversation }) { i, d ->
                    LigneDiscussion(espace, conteneur, d, Modifier.entree(i)) { onOuvrir(d.conversation) }
                }
            }
        }
    }
    if (chiffrement == EtatChiffrement.PRET) {
        Icon(
            painterResource(R.drawable.lucide_square_pen), contentDescription = "Nouvelle discussion", tint = p.surPrimaire,
            modifier = Modifier.align(Alignment.BottomEnd).padding(20.dp).size(56.dp).clip(RoundedCornerShape(16.dp)).background(p.primaire)
                .clickable(role = Role.Button, onClick = onNouvelle).padding(16.dp),
        )
    }
    }
}

@Composable
private fun LigneDiscussion(espace: EspaceCompte, conteneur: Conteneur, d: ApercuDiscussion, modifier: Modifier, onClick: () -> Unit) {
    val p = LocalPalette.current
    val m = d.dernier
    val apercu = texteLigne(m, espace.moi) { nomPersonne(espace, it) }
    Row(
        modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AvatarDiscussion(espace, conteneur, d.conversation, 52)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(nomDiscussion(espace, d.conversation), color = p.texte, fontSize = 16.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Text(dateListe(m.entier("le") ?: 0), color = if (d.nonLus > 0) p.primaire else p.texte3, fontSize = 12.sp)
            }
            Spacer(Modifier.height(2.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                val prefixe = if (m.texte("de") == espace.moi && m.texte("type") == "texte" && !m.vrai("supprime")) "Vous : " else ""
                Text("$prefixe$apercu", color = p.texte2, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                if (d.nonLus > 0) {
                    Box(
                        Modifier.padding(start = 8.dp).defaultMinSize(minWidth = 20.dp).height(20.dp).clip(CircleShape).background(p.primaire).padding(horizontal = 6.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(if (d.nonLus > 99) "99+" else d.nonLus.toString(), color = p.surPrimaire, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
    }
}

/** Photo de la personne, initiale sur fond indigo doux, ou pictogramme de groupe. */
@Composable
fun AvatarDiscussion(espace: EspaceCompte, conteneur: Conteneur, conversation: String, taille: Int) {
    val p = LocalPalette.current
    val autre = autrePersonne(conversation, espace.moi)
    val photo = autre?.let { espace.annuaire.photoPersonne(it) }
    val forme = Modifier.size(taille.dp).clip(CircleShape).background(p.primaireDoux)
    when {
        autre != null && photo != null -> AsyncImage(
            model = conteneur.photo(autre, photo), imageLoader = conteneur.images, contentDescription = null,
            contentScale = ContentScale.Crop, modifier = forme,
        )
        autre == null -> Box(forme, contentAlignment = Alignment.Center) {
            Icon(painterResource(R.drawable.lucide_users), contentDescription = null, tint = p.primaireTexte, modifier = Modifier.size((taille * 0.45).dp))
        }
        else -> Box(forme, contentAlignment = Alignment.Center) {
            Text(nomDiscussion(espace, conversation).trim().take(1).uppercase(), color = p.primaireTexte, fontSize = (taille * 0.4).sp, fontWeight = FontWeight.SemiBold)
        }
    }
}
