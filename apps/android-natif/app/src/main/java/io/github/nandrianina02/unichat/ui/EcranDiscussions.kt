package io.github.nandrianina02.unichat.ui

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
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
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Épinglées en haut de la liste : trois au plus, comme WhatsApp (EPINGLES_MAX du web). */
private const val EPINGLES_MAX = 3
private const val HEURE = 3_600_000L
/** Sourdine « Toujours » (MUET_TOUJOURS, packages/shared). */
private const val MUET_TOUJOURS = 8_640_000_000_000_000L
private val DUREES_SOURDINE = listOf("8 heures" to 8 * HEURE, "1 semaine" to 7 * 24 * HEURE, "Toujours" to null)

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

/** Ce que demande une action de la liste avant de s'exécuter. */
private sealed interface Demande {
    val d: ApercuDiscussion
    data class Sourdine(override val d: ApercuDiscussion) : Demande
    data class Effacer(override val d: ApercuDiscussion) : Demande
    data class Supprimer(override val d: ApercuDiscussion) : Demande
}

/**
 * La liste des discussions, les épinglées d'abord puis la plus récente en
 * haut, relue à chaque changement de la base. Un appui long sur une ligne
 * ouvre ses réglages ; les discussions archivées ont leur propre liste.
 */
@OptIn(ExperimentalMaterial3Api::class)
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
    val contexte = LocalContext.current
    val portee = rememberCoroutineScope()
    val version by espace.base.version.collectAsStateWithLifecycle()
    val connexion by espace.messagerie.connexion.collectAsStateWithLifecycle()
    val discussions by produceState<List<ApercuDiscussion>?>(null, version) {
        value = withContext(Dispatchers.IO) { espace.base.discussions(espace.moi) }
    }
    var archives by rememberSaveable { mutableStateOf(false) }
    var choisie by remember { mutableStateOf<ApercuDiscussion?>(null) }
    var demande by remember { mutableStateOf<Demande?>(null) }
    BackHandler(enabled = archives) { archives = false }

    // Les personnes que la base ne connaît pas encore : leur nom est demandé une fois.
    LaunchedEffect(discussions) {
        val inconnues = discussions.orEmpty().mapNotNull { autrePersonne(it.conversation, espace.moi) }.filter { it != espace.moi }
        if (inconnues.isNotEmpty()) withContext(Dispatchers.IO) { espace.annuaire.completer(inconnues) }
    }

    fun regler(conversation: String, preference: JsonObject) {
        portee.launch { withContext(Dispatchers.IO) { espace.messagerie.regler(conversation, preference) } }
    }

    Box(Modifier.fillMaxSize().background(p.fond).safeDrawingPadding()) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(start = if (archives) 4.dp else 20.dp, end = 8.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (archives) {
                    Icon(
                        painterResource(R.drawable.lucide_arrow_left), contentDescription = "Retour", tint = p.texte,
                        modifier = Modifier.size(44.dp).clip(CircleShape).clickable(role = Role.Button) { archives = false }.padding(11.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                }
                Column(Modifier.weight(1f)) {
                    Text(if (archives) "Archivées" else "UniChat", color = p.texte, fontSize = if (archives) 20.sp else 24.sp, fontWeight = FontWeight.SemiBold)
                    val etat = when {
                        chiffrement == EtatChiffrement.PREPARATION -> "Préparation des clés…"
                        connexion == EtatConnexion.CONNEXION -> "Connexion…"
                        connexion == EtatConnexion.HORS_LIGNE && chiffrement == EtatChiffrement.PRET -> "Hors ligne"
                        else -> null
                    }
                    etat?.let { Text(it, color = p.texte3, fontSize = 13.sp) }
                }
                if (!archives) {
                    Icon(
                        painterResource(R.drawable.lucide_settings), contentDescription = "Compte", tint = p.texte2,
                        modifier = Modifier.size(44.dp).clip(CircleShape).clickable(role = Role.Button, onClick = onCompte).padding(11.dp),
                    )
                }
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
            val toutes = discussions
            // La liste principale et celle des archives se remplacent en fondu.
            AnimatedContent(archives, transitionSpec = { fadeIn(tween(200)) togetherWith fadeOut(tween(120)) }, label = "archives") { enArchives ->
                val liste = toutes?.filter { it.archivee == enArchives }
                val nbArchivees = toutes?.count { it.archivee } ?: 0
                when {
                    liste == null -> Unit
                    liste.isEmpty() && (enArchives || nbArchivees == 0) -> Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Spacer(Modifier.height(48.dp))
                        Icon(painterResource(if (enArchives) R.drawable.lucide_archive else R.drawable.lucide_message_circle), contentDescription = null, tint = p.texte3, modifier = Modifier.size(36.dp))
                        Spacer(Modifier.height(12.dp))
                        Text(if (enArchives) "Aucune discussion archivée." else "Aucune discussion pour l'instant.", color = p.texte2, fontSize = 15.sp)
                    }
                    // Le bas de liste laisse la place au bouton « Nouvelle discussion ».
                    else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 88.dp)) {
                        if (!enArchives && nbArchivees > 0) {
                            item(key = "archives") {
                                Row(
                                    Modifier.fillMaxWidth().clickable(role = Role.Button) { archives = true }.padding(horizontal = 30.dp, vertical = 14.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Icon(painterResource(R.drawable.lucide_archive), contentDescription = null, tint = p.texte2, modifier = Modifier.size(20.dp))
                                    Spacer(Modifier.width(26.dp))
                                    Text("Archivées", color = p.texte, fontSize = 16.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                                    Text(nbArchivees.toString(), color = p.primaire, fontSize = 13.sp)
                                }
                            }
                        }
                        itemsIndexed(liste, key = { _, d -> d.conversation }) { i, d ->
                            LigneDiscussion(espace, conteneur, d, Modifier.entree(i), onClick = { onOuvrir(d.conversation) }, onReglages = { choisie = d })
                        }
                    }
                }
            }
        }
        if (chiffrement == EtatChiffrement.PRET && !archives) {
            Icon(
                painterResource(R.drawable.lucide_square_pen), contentDescription = "Nouvelle discussion", tint = p.surPrimaire,
                modifier = Modifier.align(Alignment.BottomEnd).padding(20.dp).size(56.dp).clip(RoundedCornerShape(16.dp)).background(p.primaire)
                    .clickable(role = Role.Button, onClick = onNouvelle).padding(16.dp),
            )
        }
    }

    choisie?.let { d ->
        val etat = rememberModalBottomSheetState()
        val groupe = !d.conversation.startsWith("d:")
        fun fermer() { choisie = null }
        ModalBottomSheet(onDismissRequest = ::fermer, sheetState = etat, containerColor = p.panneau) {
            Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 12.dp)) {
                Text(
                    nomDiscussion(espace, d.conversation), color = p.texte, fontSize = 17.sp, fontWeight = FontWeight.Medium,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 24.dp, end = 24.dp, bottom = 8.dp),
                )
                ActionListe(if (d.epinglee) R.drawable.lucide_pin_off else R.drawable.lucide_pin, if (d.epinglee) "Désépingler" else "Épingler") {
                    fermer()
                    if (!d.epinglee && discussions.orEmpty().count { it.epinglee } >= EPINGLES_MAX) {
                        Toast.makeText(contexte, "$EPINGLES_MAX discussions épinglées au maximum.", Toast.LENGTH_SHORT).show()
                    } else {
                        regler(d.conversation, buildJsonObject { put("epingle", !d.epinglee) })
                    }
                }
                if (d.muette) {
                    ActionListe(R.drawable.lucide_bell, "Réactiver le son") {
                        fermer()
                        regler(d.conversation, buildJsonObject { put("muetJusqua", JsonNull) })
                    }
                } else {
                    ActionListe(R.drawable.lucide_bell_off, "Mode silencieux") {
                        fermer()
                        demande = Demande.Sourdine(d)
                    }
                }
                ActionListe(if (d.archivee) R.drawable.lucide_archive_restore else R.drawable.lucide_archive, if (d.archivee) "Désarchiver" else "Archiver") {
                    fermer()
                    regler(d.conversation, buildJsonObject { put("archive", !d.archivee) })
                }
                if (d.nonLus > 0 || d.marqueeNonLue) {
                    ActionListe(R.drawable.lucide_mail_open, "Marquer comme lu") {
                        fermer()
                        portee.launch { withContext(Dispatchers.IO) { espace.messagerie.marquerLu(d.conversation) } }
                    }
                } else {
                    ActionListe(R.drawable.lucide_mail, "Marquer comme non lu") {
                        fermer()
                        regler(d.conversation, buildJsonObject { put("nonLu", true) })
                    }
                }
                ActionListe(R.drawable.lucide_circle_minus, "Effacer la discussion", danger = true) {
                    fermer()
                    demande = Demande.Effacer(d)
                }
                // Un groupe se quitte avant de se supprimer (comme sur le web).
                if (!groupe) {
                    ActionListe(R.drawable.lucide_trash_2, "Supprimer la discussion", danger = true) {
                        fermer()
                        demande = Demande.Supprimer(d)
                    }
                }
            }
        }
    }

    demande?.let { q ->
        val nom = nomDiscussion(espace, q.d.conversation)
        val groupe = !q.d.conversation.startsWith("d:")
        when (q) {
            is Demande.Sourdine -> {
                var duree by remember { mutableStateOf<Long?>(DUREES_SOURDINE.first().second) }
                Dialogue(
                    titre = "Mettre la discussion en sourdine",
                    confirmer = "Mettre en sourdine",
                    onConfirmer = {
                        val jusqua = duree?.let { System.currentTimeMillis() + it } ?: MUET_TOUJOURS
                        regler(q.d.conversation, buildJsonObject { put("muetJusqua", jusqua) })
                    },
                    onFermer = { demande = null },
                ) {
                    Column {
                        for ((libelle, valeur) in DUREES_SOURDINE) {
                            val actif = duree == valeur
                            Row(
                                Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).clickable(role = Role.RadioButton) { duree = valeur }.padding(vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Box(
                                    Modifier.size(20.dp).clip(CircleShape).background(if (actif) p.primaire else p.bordure).padding(if (actif) 5.dp else 2.dp)
                                        .clip(CircleShape).background(if (actif) p.surPrimaire else p.panneau),
                                )
                                Spacer(Modifier.width(14.dp))
                                Text(libelle, color = p.texte, fontSize = 15.sp)
                            }
                        }
                    }
                }
            }
            is Demande.Effacer -> Dialogue(
                titre = "Effacer cette discussion ?",
                confirmer = "Effacer",
                danger = true,
                onConfirmer = { portee.launch { withContext(Dispatchers.IO) { espace.messagerie.effacer(q.d.conversation) } } },
                onFermer = { demande = null },
            ) {
                Text(
                    "Les messages sont effacés de vos appareils. La discussion reste dans la liste ; ${if (groupe) "les membres gardent" else "$nom garde"} ses messages.",
                    color = p.texte2, fontSize = 14.sp, lineHeight = 20.sp,
                )
            }
            is Demande.Supprimer -> Dialogue(
                titre = "Supprimer cette discussion ?",
                confirmer = "Supprimer",
                danger = true,
                onConfirmer = { portee.launch { withContext(Dispatchers.IO) { espace.messagerie.supprimerDiscussion(q.d.conversation) } } },
                onFermer = { demande = null },
            ) {
                Text(
                    "Les messages sont effacés de vos appareils et la discussion quitte la liste. Elle reviendra au prochain message.",
                    color = p.texte2, fontSize = 14.sp, lineHeight = 20.sp,
                )
            }
        }
    }
}

/** Une confirmation : titre, explication, et l'action nommée par son verbe (comme Dialogue.tsx du web). */
@Composable
private fun Dialogue(titre: String, confirmer: String, danger: Boolean = false, onConfirmer: () -> Unit, onFermer: () -> Unit, contenu: @Composable () -> Unit) {
    val p = LocalPalette.current
    AlertDialog(
        onDismissRequest = onFermer,
        containerColor = p.panneau,
        title = { Text(titre, color = p.texte, fontSize = 19.sp) },
        text = contenu,
        confirmButton = {
            TextButton(onClick = {
                onFermer()
                onConfirmer()
            }) { Text(confirmer, color = if (danger) p.danger else p.primaire, fontWeight = FontWeight.Medium) }
        },
        dismissButton = { TextButton(onClick = onFermer) { Text("Annuler", color = p.texte2) } },
    )
}

@Composable
private fun ActionListe(icone: Int, libelle: String, danger: Boolean = false, onClick: () -> Unit) {
    val p = LocalPalette.current
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).padding(horizontal = 24.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(painterResource(icone), contentDescription = null, tint = if (danger) p.danger else p.texte2, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(18.dp))
        Text(libelle, color = if (danger) p.danger else p.texte, fontSize = 16.sp)
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun LigneDiscussion(
    espace: EspaceCompte,
    conteneur: Conteneur,
    d: ApercuDiscussion,
    modifier: Modifier,
    onClick: () -> Unit,
    onReglages: () -> Unit,
) {
    val p = LocalPalette.current
    val haptique = LocalHapticFeedback.current
    val m = d.dernier
    val apercu = texteLigne(m, espace.moi) { nomPersonne(espace, it) }
    val aLire = d.nonLus > 0 || d.marqueeNonLue
    Row(
        modifier.fillMaxWidth()
            .combinedClickable(
                role = Role.Button,
                onClick = onClick,
                onLongClick = {
                    haptique.performHapticFeedback(HapticFeedbackType.LongPress)
                    onReglages()
                },
                onLongClickLabel = "Réglages de la discussion",
            )
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AvatarDiscussion(espace, conteneur, d.conversation, 52)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(nomDiscussion(espace, d.conversation), color = p.texte, fontSize = 16.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Text(dateListe(m.entier("le") ?: 0), color = if (aLire) p.primaire else p.texte3, fontSize = 12.sp)
            }
            Spacer(Modifier.height(2.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                val prefixe = if (m.texte("de") == espace.moi && m.texte("type") == "texte" && !m.vrai("supprime")) "Vous : " else ""
                Text("$prefixe$apercu", color = p.texte2, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                if (d.muette) Indicateur(R.drawable.lucide_bell_off, "Sourdine")
                if (d.epinglee) Indicateur(R.drawable.lucide_pin, "Épinglée")
                when {
                    d.nonLus > 0 -> Box(
                        Modifier.padding(start = 8.dp).defaultMinSize(minWidth = 20.dp).height(20.dp).clip(CircleShape)
                            // En sourdine, le compteur reste visible mais s'efface : il n'appelle plus l'attention.
                            .background(if (d.muette) p.texte3 else p.primaire).padding(horizontal = 6.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(if (d.nonLus > 99) "99+" else d.nonLus.toString(), color = p.surPrimaire, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                    }
                    d.marqueeNonLue -> Box(Modifier.padding(start = 8.dp).size(12.dp).clip(CircleShape).background(p.primaire))
                }
            }
        }
    }
}

@Composable
private fun Indicateur(icone: Int, libelle: String) {
    val p = LocalPalette.current
    Icon(painterResource(icone), contentDescription = libelle, tint = p.texte3, modifier = Modifier.padding(start = 6.dp).size(15.dp))
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
