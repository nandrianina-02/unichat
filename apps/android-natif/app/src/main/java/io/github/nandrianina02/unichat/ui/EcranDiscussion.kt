package io.github.nandrianina02.unichat.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.nandrianina02.unichat.Conteneur
import io.github.nandrianina02.unichat.R
import io.github.nandrianina02.unichat.donnees.EspaceCompte
import io.github.nandrianina02.unichat.donnees.EtatChiffrement
import io.github.nandrianina02.unichat.donnees.EtatConnexion
import io.github.nandrianina02.unichat.donnees.entier
import io.github.nandrianina02.unichat.donnees.objet
import io.github.nandrianina02.unichat.donnees.texte
import io.github.nandrianina02.unichat.donnees.texteOuNul
import io.github.nandrianina02.unichat.donnees.vrai
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject

/** Une ligne de la discussion : un séparateur de jour, ou un message. */
private sealed interface Ligne {
    val cle: String
    data class Jour(val texte: String) : Ligne {
        override val cle = "jour:$texte"
    }
    data class Bulle(val m: JsonObject, val auteurVisible: Boolean) : Ligne {
        override val cle = m.texte("id")
    }
}

/**
 * Une discussion. Les messages restent sur l'appareil ; à l'ouverture, les
 * reçus sont marqués lus, et leurs auteurs l'apprennent. Un message écrit
 * ici s'affiche aussitôt « en attente », puis part chiffré.
 */
@Composable
fun EcranDiscussion(espace: EspaceCompte, conteneur: Conteneur, conversation: String, onRetour: () -> Unit) {
    val p = LocalPalette.current
    val version by espace.base.version.collectAsStateWithLifecycle()
    val groupe = !conversation.startsWith("d:")
    val messages by produceState<List<JsonObject>>(emptyList(), version) {
        value = withContext(Dispatchers.IO) { espace.base.messages(conversation) }
    }
    LaunchedEffect(version) { withContext(Dispatchers.IO) { espace.messagerie.marquerLu(conversation) } }
    val autre = autrePersonne(conversation, espace.moi)
    val connexion by espace.messagerie.connexion.collectAsStateWithLifecycle()
    val chiffrement by espace.chiffrement.collectAsStateWithLifecycle()
    val ecrit by espace.messagerie.ecrit.collectAsStateWithLifecycle()
    val presences by espace.messagerie.presences.collectAsStateWithLifecycle()
    // La présence n'est pas poussée : demandée à l'ouverture, puis toutes les 30 s (comme le web).
    LaunchedEffect(autre, connexion) {
        if (autre == null || autre == espace.moi || connexion != EtatConnexion.CONNECTE) return@LaunchedEffect
        while (true) {
            espace.messagerie.demanderPresence(autre)
            delay(30_000)
        }
    }
    LaunchedEffect(messages) {
        val auteurs = messages.map { it.texte("de") }.filter { it.isNotEmpty() && it != espace.moi }.toSet()
        if (auteurs.isNotEmpty()) withContext(Dispatchers.IO) { espace.annuaire.completer(auteurs) }
    }

    val lignes = buildList {
        var jour: String? = null
        var auteurPrecedent: String? = null
        for (m in messages) {
            val j = jourMessage(m.entier("le") ?: 0)
            if (j != jour) {
                add(Ligne.Jour(j))
                jour = j
                auteurPrecedent = null
            }
            val auteur = m.texte("de")
            val estBulle = m.texte("type") !in setOf("evenement", "systeme")
            add(Ligne.Bulle(m, groupe && estBulle && auteur != espace.moi && auteur != auteurPrecedent))
            auteurPrecedent = if (estBulle) auteur else null
        }
    }
    val liste = rememberLazyListState()
    // À l'ouverture et à chaque nouveau message : le bas de la discussion.
    LaunchedEffect(lignes.size) { if (lignes.isNotEmpty()) liste.scrollToItem(lignes.lastIndex) }

    val quiEcrit = ecrit[conversation]
    val statut = when {
        quiEcrit != null && groupe -> "${nomPersonne(espace, quiEcrit)} écrit…"
        quiEcrit != null -> "écrit…"
        autre == espace.moi -> "Envoyez-vous des messages"
        autre != null -> presences[autre]?.let { if (it.enLigne) "en ligne" else it.vuLe?.let(::vuLe) }
        else -> null
    }

    Column(Modifier.fillMaxSize().background(p.fond).safeDrawingPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().background(p.entete).padding(horizontal = 4.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(
                painterResource(R.drawable.lucide_arrow_left), contentDescription = "Retour", tint = p.texte,
                modifier = Modifier.size(44.dp).clip(CircleShape).clickable(role = Role.Button, onClick = onRetour).padding(11.dp),
            )
            AvatarDiscussion(espace, conteneur, conversation, 38)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(nomDiscussion(espace, conversation), color = p.texte, fontSize = 17.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                // Le statut apparaît et s'efface en fondu : « écrit… » va et vient sans faire sauter le titre.
                AnimatedVisibility(statut != null, enter = fadeIn(tween(200)), exit = fadeOut(tween(200))) {
                    Text(statut ?: "", color = if (quiEcrit != null) p.primaire else p.texte2, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = liste, contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp)) {
            items(lignes, key = { it.cle }) { l ->
                when (l) {
                    is Ligne.Jour -> Box(Modifier.fillMaxWidth().padding(vertical = 10.dp), contentAlignment = Alignment.Center) {
                        Text(
                            l.texte, color = p.texte2, fontSize = 12.sp,
                            modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(p.entete).padding(horizontal = 10.dp, vertical = 4.dp),
                        )
                    }
                    is Ligne.Bulle -> Message(espace, l.m, l.auteurVisible) { espace.messagerie.reessayer(it) }
                }
            }
        }
        if (chiffrement == EtatChiffrement.PRET) {
            Saisie(
                onEcriture = { espace.messagerie.signalerEcriture(conversation) },
                onEnvoi = { espace.messagerie.envoyer(conversation, it) },
            )
        } else {
            Text(
                "Cet appareil prépare ses clés de chiffrement. Vous pourrez écrire dans un instant.",
                color = p.texte3, fontSize = 13.sp, textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().background(p.entete).padding(14.dp),
            )
        }
    }
}

/** Le champ du bas. Le bouton d'envoi n'apparaît qu'avec du texte à envoyer. */
@Composable
private fun Saisie(onEcriture: () -> Unit, onEnvoi: (String) -> Unit) {
    val p = LocalPalette.current
    var texte by rememberSaveable { mutableStateOf("") }
    Row(Modifier.fillMaxWidth().background(p.entete).padding(horizontal = 8.dp, vertical = 8.dp), verticalAlignment = Alignment.Bottom) {
        Box(
            Modifier.weight(1f).heightIn(min = 44.dp).clip(RoundedCornerShape(22.dp)).background(p.panneau).padding(horizontal = 16.dp, vertical = 11.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            if (texte.isEmpty()) Text("Message", color = p.texte3, fontSize = 15.sp)
            BasicTextField(
                value = texte,
                onValueChange = {
                    if (it.length > texte.length) onEcriture()
                    texte = it
                },
                textStyle = TextStyle(color = p.texte, fontSize = 15.sp, lineHeight = 21.sp),
                cursorBrush = SolidColor(p.primaire),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                maxLines = 6,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        AnimatedVisibility(
            texte.isNotBlank(),
            enter = fadeIn(tween(150)) + scaleIn(tween(150), initialScale = 0.85f),
            exit = fadeOut(tween(150)) + scaleOut(tween(150), targetScale = 0.85f),
        ) {
            Icon(
                painterResource(R.drawable.lucide_send_horizontal), contentDescription = "Envoyer", tint = p.surPrimaire,
                modifier = Modifier.padding(start = 8.dp).size(44.dp).clip(CircleShape).background(p.primaire)
                    .clickable(role = Role.Button) {
                        onEnvoi(texte)
                        texte = ""
                    }
                    .padding(12.dp),
            )
        }
    }
}

@Composable
private fun Message(espace: EspaceCompte, m: JsonObject, auteurVisible: Boolean, onReessayer: (String) -> Unit) {
    val p = LocalPalette.current
    val type = m.texte("type")
    if (type == "evenement" || type == "systeme") {
        Box(Modifier.fillMaxWidth().padding(vertical = 6.dp), contentAlignment = Alignment.Center) {
            Text(
                texteLigne(m, espace.moi) { nomPersonne(espace, it) }, color = p.texte2, fontSize = 13.sp, textAlign = TextAlign.Center,
                modifier = Modifier.widthIn(max = 320.dp).clip(RoundedCornerShape(8.dp)).background(p.entete).padding(horizontal = 12.dp, vertical = 6.dp),
            )
        }
        return
    }
    val mien = m.texte("de") == espace.moi
    val fond = if (mien) p.primaire else p.panneau
    val encre = if (mien) p.surPrimaire else p.texte
    val discret = if (mien) p.surPrimaire.copy(alpha = 0.75f) else p.texte3
    val echec = mien && m.texteOuNul("etat") == "echec"
    Column(Modifier.fillMaxWidth().padding(vertical = 2.dp), horizontalAlignment = if (mien) Alignment.End else Alignment.Start) {
        Column(
            Modifier.widthIn(max = 300.dp).clip(RoundedCornerShape(14.dp)).background(fond).padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            if (auteurVisible) Text(nomPersonne(espace, m.texte("de")), color = p.primaire, fontSize = 13.sp, fontWeight = FontWeight.Medium)
            when {
                m.vrai("supprime") -> Ligneicone(R.drawable.lucide_ban, if (mien) "Vous avez supprimé ce message" else "Ce message a été supprimé", discret, italique = true)
                m.vrai("indechiffrable") -> Ligneicone(R.drawable.lucide_lock_keyhole, "Message illisible sur cet appareil", discret, italique = true)
                else -> {
                    m.objet("reponseA")?.let { r ->
                        Column(Modifier.padding(bottom = 4.dp).clip(RoundedCornerShape(8.dp)).background(encre.copy(alpha = 0.08f)).padding(8.dp)) {
                            Text(nomPersonne(espace, r.texte("de")), color = if (mien) encre else p.primaire, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                            Text(r.texte("extrait"), color = discret, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        }
                    }
                    m.objet("media")?.let { media -> Ligneicone(iconeMedia(media), libelleMedia(media), encre) }
                    m.objet("position")?.let { Ligneicone(R.drawable.lucide_map_pin, "Position", encre) }
                    m.objet("contact")?.let { c -> Ligneicone(R.drawable.lucide_contact, c.texte("nom"), encre) }
                    m.objet("sondage")?.let { s -> Ligneicone(R.drawable.lucide_chart_bar_big, s.texte("question"), encre) }
                    m.texte("texte").takeIf { it.isNotEmpty() }?.let { Text(it, color = encre, fontSize = 15.sp, lineHeight = 21.sp) }
                }
            }
            Row(Modifier.align(Alignment.End), verticalAlignment = Alignment.CenterVertically) {
                if (m.entier("modifieLe") != null && !m.vrai("supprime")) Text("Modifié ", color = discret, fontSize = 11.sp)
                Text(heureCourte(m.entier("le") ?: 0), color = discret, fontSize = 11.sp)
                if (mien) {
                    val etat = m.texteOuNul("etat")
                    Spacer(Modifier.width(4.dp))
                    Icon(
                        painterResource(
                            when (etat) {
                                "attente" -> R.drawable.lucide_clock
                                "echec" -> R.drawable.lucide_circle_alert
                                "remis", "lu" -> R.drawable.lucide_check_check
                                else -> R.drawable.lucide_check
                            },
                        ),
                        contentDescription = when (etat) { "attente" -> "En attente"; "echec" -> "Non envoyé"; "lu" -> "Lu"; "remis" -> "Remis"; else -> "Envoyé" },
                        // Lu : la coche prend la couleur claire la plus forte ; remis et envoyé restent discrets.
                        tint = if (etat == "lu") p.surPrimaire else discret,
                        modifier = Modifier.size(14.dp),
                    )
                }
            }
        }
        // L'échec dit pourquoi, sous la bulle, et se touche pour réessayer.
        if (echec) {
            Row(
                Modifier.padding(top = 4.dp, bottom = 2.dp).widthIn(max = 300.dp).clip(RoundedCornerShape(8.dp))
                    .clickable(role = Role.Button) { onReessayer(m.texte("id")) }.padding(horizontal = 6.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(painterResource(R.drawable.lucide_circle_alert), contentDescription = null, tint = p.danger, modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(6.dp))
                Text(
                    "${m.texteOuNul("erreur") ?: "Non envoyé."} Toucher pour réessayer.",
                    color = p.danger, fontSize = 12.sp, lineHeight = 16.sp,
                )
            }
        }
    }
}

@Composable
private fun Ligneicone(icone: Int, texte: String, couleur: androidx.compose.ui.graphics.Color, italique: Boolean = false) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 2.dp)) {
        Icon(painterResource(icone), contentDescription = null, tint = couleur, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(6.dp))
        Text(texte, color = couleur, fontSize = 14.sp, fontStyle = if (italique) FontStyle.Italic else FontStyle.Normal)
    }
}

private fun iconeMedia(media: JsonObject): Int = when (media.texte("type")) {
    "image", "video" -> R.drawable.lucide_image
    "audio" -> R.drawable.lucide_mic
    else -> R.drawable.lucide_file
}
