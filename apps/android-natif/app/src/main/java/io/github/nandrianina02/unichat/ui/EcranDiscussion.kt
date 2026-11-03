package io.github.nandrianina02.unichat.ui

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
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
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put

/** Longueur de l'extrait d'une citation (LIMITE_EXTRAIT, packages/shared). */
private const val LIMITE_EXTRAIT = 200

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

/** Les réactions d'un message : qui a réagi, avec quel code. */
private fun reactionsDe(m: JsonObject): Map<String, String> =
    m.objet("reactions")?.mapNotNull { (qui, v) -> (v as? JsonPrimitive)?.contentOrNull?.let { qui to it } }?.toMap().orEmpty()

/**
 * Une discussion. Les messages restent sur l'appareil ; à l'ouverture, les
 * reçus sont marqués lus, et leurs auteurs l'apprennent. Un message écrit
 * ici s'affiche aussitôt « en attente », puis part chiffré. Un appui long
 * sur une bulle ouvre ses actions : réagir, répondre, copier, modifier,
 * supprimer.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EcranDiscussion(espace: EspaceCompte, conteneur: Conteneur, conversation: String, onRetour: () -> Unit, onInfos: () -> Unit = {}) {
    val p = LocalPalette.current
    val contexte = LocalContext.current
    val presse = LocalClipboardManager.current
    val portee = rememberCoroutineScope()
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

    var texte by rememberSaveable { mutableStateOf("") }
    var reponse by remember { mutableStateOf<JsonObject?>(null) }
    var edition by remember { mutableStateOf<JsonObject?>(null) }
    var selection by remember { mutableStateOf<JsonObject?>(null) }
    var aSupprimer by remember { mutableStateOf<JsonObject?>(null) }
    fun annoncer(message: String) = Toast.makeText(contexte, message, Toast.LENGTH_SHORT).show()

    // Retour : on abandonne d'abord la réponse ou la modification en cours, pas la discussion.
    BackHandler(enabled = reponse != null || edition != null) {
        if (edition != null) texte = ""
        reponse = null
        edition = null
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

    val infosGroupe by produceState<JsonObject?>(null, version) {
        value = if (groupe) withContext(Dispatchers.IO) { espace.base.groupe(conversation.removePrefix("g:")) } else null
    }
    val quiEcrit = ecrit[conversation]
    val statut = when {
        quiEcrit != null && groupe -> "${nomPersonne(espace, quiEcrit)} écrit…"
        quiEcrit != null -> "écrit…"
        autre == espace.moi -> "Envoyez-vous des messages"
        autre != null -> presences[autre]?.let { if (it.enLigne) "en ligne" else it.vuLe?.let(::vuLe) }
        // Groupe : ses membres, comme sous le titre du web ; ou le départ.
        infosGroupe?.texteOuNul("moiMembre") == "false" -> "Vous ne faites plus partie de ce groupe"
        else -> (infosGroupe?.get("membres") as? kotlinx.serialization.json.JsonArray)
            ?.mapNotNull { (it as? JsonObject)?.takeIf { m -> m.texte("id") != espace.moi }?.texte("nom") }
            ?.takeIf { it.isNotEmpty() }?.let { (it + "Vous").joinToString(", ") }
    }

    Column(Modifier.fillMaxSize().background(p.fond).safeDrawingPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().background(p.entete).padding(horizontal = 4.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(
                painterResource(R.drawable.lucide_arrow_left), contentDescription = "Retour", tint = p.texte,
                modifier = Modifier.size(44.dp).clip(CircleShape).clickable(role = Role.Button, onClick = onRetour).padding(11.dp),
            )
            // Pour un groupe, l'en-tête ouvre ses infos.
            Row(
                Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).clickable(enabled = groupe, role = Role.Button, onClick = onInfos).padding(vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
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
                    is Ligne.Bulle -> Message(
                        espace, l.m, l.auteurVisible,
                        selectionne = selection?.texte("id") == l.cle,
                        onReessayer = { espace.messagerie.reessayer(it) },
                        onActions = { selection = l.m },
                        onCitation = { id ->
                            val i = lignes.indexOfFirst { it.cle == id }
                            if (i >= 0) portee.launch { liste.animateScrollToItem(i) } else annoncer("Ce message n'est plus sur cet appareil.")
                        },
                    )
                }
            }
        }
        if (chiffrement == EtatChiffrement.PRET) {
            Saisie(
                texte = texte,
                onTexte = {
                    if (it.length > texte.length && edition == null) espace.messagerie.signalerEcriture(conversation)
                    texte = it
                },
                bandeau = when {
                    edition != null -> Bandeau(R.drawable.lucide_pencil, "Modifier le message", edition!!.texte("texte"))
                    reponse != null -> Bandeau(R.drawable.lucide_reply, "Réponse à ${nomPersonne(espace, reponse!!.texte("de"))}", resumeMessage(reponse!!))
                    else -> null
                },
                enEdition = edition != null,
                onAnnuler = {
                    if (edition != null) texte = ""
                    reponse = null
                    edition = null
                },
                onEnvoi = {
                    val enCours = edition
                    if (enCours != null) {
                        portee.launch {
                            val ok = withContext(Dispatchers.IO) { espace.messagerie.modifierTexte(enCours.texte("id"), it) }
                            if (!ok) annoncer("Modification impossible : hors connexion, ou délai de 15 minutes dépassé.")
                        }
                    } else {
                        val citation = reponse?.let { r ->
                            buildJsonObject {
                                put("id", r.texte("id"))
                                put("de", r.texte("de"))
                                put("extrait", resumeMessage(r).take(LIMITE_EXTRAIT))
                            }
                        }
                        espace.messagerie.envoyer(conversation, it, citation)
                    }
                    texte = ""
                    reponse = null
                    edition = null
                },
            )
        } else {
            Text(
                "Cet appareil prépare ses clés de chiffrement. Vous pourrez écrire dans un instant.",
                color = p.texte3, fontSize = 13.sp, textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().background(p.entete).padding(14.dp),
            )
        }
    }

    selection?.let { m ->
        val etat = rememberModalBottomSheetState()
        val lisible = !m.vrai("supprime") && !m.vrai("indechiffrable")
        val maReaction = reactionsDe(m)[espace.moi]
        ModalBottomSheet(onDismissRequest = { selection = null }, sheetState = etat, containerColor = p.panneau) {
            Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 12.dp)) {
                if (lisible) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                        for (r in REACTIONS) {
                            val choisie = r.code == maReaction
                            Icon(
                                painterResource(r.icone), contentDescription = r.libelle,
                                tint = if (choisie) p.primaire else p.texte2,
                                modifier = Modifier.size(48.dp).clip(CircleShape).background(if (choisie) p.primaireDoux else Color.Transparent)
                                    .clickable(role = Role.Button) {
                                        selection = null
                                        portee.launch {
                                            // Toucher la réaction déjà choisie la retire.
                                            val ok = withContext(Dispatchers.IO) { espace.messagerie.reagir(m.texte("id"), if (choisie) null else r.code) }
                                            if (!ok) annoncer("Réaction impossible hors connexion.")
                                        }
                                    }
                                    .padding(12.dp),
                            )
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    LigneAction(R.drawable.lucide_reply, "Répondre") {
                        selection = null
                        edition = null
                        reponse = m
                    }
                    if (m.texte("texte").isNotEmpty()) {
                        LigneAction(R.drawable.lucide_copy, "Copier") {
                            selection = null
                            presse.setText(AnnotatedString(m.texte("texte")))
                            annoncer("Message copié")
                        }
                    }
                    if (espace.messagerie.modifiable(m)) {
                        LigneAction(R.drawable.lucide_pencil, "Modifier") {
                            selection = null
                            reponse = null
                            edition = m
                            texte = m.texte("texte")
                        }
                    }
                }
                LigneAction(R.drawable.lucide_trash_2, "Supprimer", couleur = p.danger) {
                    selection = null
                    aSupprimer = m
                }
            }
        }
    }

    aSupprimer?.let { m ->
        val pourTous = m.texte("de") == espace.moi && !m.vrai("supprime") && m.texteOuNul("etat") !in setOf("attente", "echec")
        AlertDialog(
            onDismissRequest = { aSupprimer = null },
            containerColor = p.panneau,
            title = { Text("Supprimer le message ?", color = p.texte) },
            text = {
                Text(
                    if (pourTous) "« Pour tout le monde » le retire aussi chez vos correspondants. « Pour moi » ne le retire que de ce téléphone."
                    else "Le message sera retiré de ce téléphone seulement.",
                    color = p.texte2,
                )
            },
            confirmButton = {
                Column(horizontalAlignment = Alignment.End) {
                    if (pourTous) {
                        TextButton(onClick = {
                            aSupprimer = null
                            portee.launch {
                                val ok = withContext(Dispatchers.IO) { espace.messagerie.supprimerPourTous(m.texte("id")) }
                                if (!ok) annoncer("Suppression impossible hors connexion.")
                            }
                        }) { Text("Pour tout le monde", color = p.danger) }
                    }
                    TextButton(onClick = {
                        aSupprimer = null
                        portee.launch { withContext(Dispatchers.IO) { espace.messagerie.supprimerPourMoi(m.texte("id")) } }
                    }) { Text("Pour moi", color = p.danger) }
                    TextButton(onClick = { aSupprimer = null }) { Text("Annuler", color = p.texte2) }
                }
            },
        )
    }
}

/** Ce que le champ annonce au-dessus de lui : la réponse ou la modification en cours. */
private data class Bandeau(val icone: Int, val titre: String, val extrait: String)

@Composable
private fun LigneAction(icone: Int, libelle: String, couleur: Color? = null, onClick: () -> Unit) {
    val p = LocalPalette.current
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).padding(horizontal = 24.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(painterResource(icone), contentDescription = null, tint = couleur ?: p.texte2, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(18.dp))
        Text(libelle, color = couleur ?: p.texte, fontSize = 16.sp)
    }
}

/** Le champ du bas. Le bouton d'envoi n'apparaît qu'avec du texte à envoyer. */
@Composable
private fun Saisie(
    texte: String,
    onTexte: (String) -> Unit,
    bandeau: Bandeau?,
    enEdition: Boolean,
    onAnnuler: () -> Unit,
    onEnvoi: (String) -> Unit,
) {
    val p = LocalPalette.current
    // Le dernier bandeau reste affiché le temps qu'il se replie.
    var dernier by remember { mutableStateOf(bandeau) }
    if (bandeau != null) dernier = bandeau
    Column(Modifier.fillMaxWidth().background(p.entete)) {
        // La réponse ou la modification se déplie au-dessus du champ, puis se replie.
        AnimatedVisibility(bandeau != null, enter = expandVertically(tween(200)) + fadeIn(tween(200)), exit = shrinkVertically(tween(150)) + fadeOut(tween(150))) {
            val b = dernier ?: return@AnimatedVisibility
            Row(
                Modifier.fillMaxWidth().padding(start = 12.dp, end = 4.dp, top = 8.dp).clip(RoundedCornerShape(10.dp)).background(p.panneau).padding(start = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(painterResource(b.icone), contentDescription = null, tint = p.primaire, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f).padding(vertical = 8.dp)) {
                    Text(b.titre, color = p.primaire, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                    Text(b.extrait, color = p.texte2, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Icon(
                    painterResource(R.drawable.lucide_x), contentDescription = "Annuler", tint = p.texte2,
                    modifier = Modifier.size(44.dp).clip(CircleShape).clickable(role = Role.Button, onClick = onAnnuler).padding(12.dp),
                )
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp), verticalAlignment = Alignment.Bottom) {
            Box(
                Modifier.weight(1f).heightIn(min = 44.dp).clip(RoundedCornerShape(22.dp)).background(p.panneau).padding(horizontal = 16.dp, vertical = 11.dp),
                contentAlignment = Alignment.CenterStart,
            ) {
                if (texte.isEmpty()) Text("Message", color = p.texte3, fontSize = 15.sp)
                BasicTextField(
                    value = texte,
                    onValueChange = onTexte,
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
                    painterResource(if (enEdition) R.drawable.lucide_check else R.drawable.lucide_send_horizontal),
                    contentDescription = if (enEdition) "Enregistrer la modification" else "Envoyer", tint = p.surPrimaire,
                    modifier = Modifier.padding(start = 8.dp).size(44.dp).clip(CircleShape).background(p.primaire)
                        .clickable(role = Role.Button) { onEnvoi(texte) }
                        .padding(12.dp),
                )
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Message(
    espace: EspaceCompte,
    m: JsonObject,
    auteurVisible: Boolean,
    selectionne: Boolean,
    onReessayer: (String) -> Unit,
    onActions: () -> Unit,
    onCitation: (String) -> Unit,
) {
    val p = LocalPalette.current
    val haptique = LocalHapticFeedback.current
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
    val reactions = reactionsDe(m)
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp))
            // La bulle dont les actions sont ouvertes reste repérable derrière le panneau.
            .background(if (selectionne) p.primaireDoux.copy(alpha = 0.5f) else Color.Transparent)
            .padding(vertical = 2.dp),
        horizontalAlignment = if (mien) Alignment.End else Alignment.Start,
    ) {
        Column(
            Modifier.widthIn(max = 300.dp).clip(RoundedCornerShape(14.dp)).background(fond)
                .combinedClickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = {},
                    onLongClick = {
                        haptique.performHapticFeedback(HapticFeedbackType.LongPress)
                        onActions()
                    },
                    onLongClickLabel = "Actions du message",
                )
                .padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            if (auteurVisible) Text(nomPersonne(espace, m.texte("de")), color = p.primaire, fontSize = 13.sp, fontWeight = FontWeight.Medium)
            when {
                m.vrai("supprime") -> Ligneicone(R.drawable.lucide_ban, if (mien) "Vous avez supprimé ce message" else "Ce message a été supprimé", discret, italique = true)
                m.vrai("indechiffrable") -> Ligneicone(R.drawable.lucide_lock_keyhole, "Message illisible sur cet appareil", discret, italique = true)
                else -> {
                    m.objet("reponseA")?.let { r ->
                        Column(
                            Modifier.padding(bottom = 4.dp).clip(RoundedCornerShape(8.dp)).background(encre.copy(alpha = 0.08f))
                                .clickable(role = Role.Button) { onCitation(r.texte("id")) }.padding(8.dp),
                        ) {
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
        // Les réactions se posent à cheval sous la bulle ; une pastille par réaction différente, et le total.
        AnimatedVisibility(reactions.isNotEmpty(), enter = fadeIn(tween(150)) + scaleIn(tween(150), initialScale = 0.8f), exit = fadeOut(tween(120))) {
            val codes = REACTIONS.filter { r -> r.code in reactions.values }
            Row(
                Modifier.offset(y = (-4).dp).padding(horizontal = 8.dp).clip(RoundedCornerShape(12.dp)).background(p.panneau)
                    .border(1.dp, p.bordure, RoundedCornerShape(12.dp)).clickable(role = Role.Button, onClick = onActions)
                    .padding(horizontal = 7.dp, vertical = 3.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                for (r in codes) {
                    Icon(painterResource(r.icone), contentDescription = r.libelle, tint = p.primaire, modifier = Modifier.padding(horizontal = 1.dp).size(14.dp))
                }
                if (reactions.size > 1) Text(" ${reactions.size}", color = p.texte2, fontSize = 12.sp)
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
private fun Ligneicone(icone: Int, texte: String, couleur: Color, italique: Boolean = false) {
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
