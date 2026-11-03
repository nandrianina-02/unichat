package io.github.nandrianina02.unichat.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import io.github.nandrianina02.unichat.Conteneur
import io.github.nandrianina02.unichat.R
import io.github.nandrianina02.unichat.donnees.AjoutMembres
import io.github.nandrianina02.unichat.donnees.CarteProfil
import io.github.nandrianina02.unichat.donnees.CreationGroupe
import io.github.nandrianina02.unichat.donnees.EspaceCompte
import io.github.nandrianina02.unichat.donnees.ErreurServeur
import io.github.nandrianina02.unichat.donnees.MajGroupe
import io.github.nandrianina02.unichat.donnees.messageErreur
import io.github.nandrianina02.unichat.donnees.texte
import io.github.nandrianina02.unichat.donnees.texteOuNul
import io.github.nandrianina02.unichat.donnees.vrai
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject

/** Un groupe compte 40 personnes au plus, moi compris (LIMITES_GROUPE, packages/shared). */
private const val MEMBRES_MAX = 40
private const val NOM_MAX = 100
private const val DESCRIPTION_MAX = 512

/** Un membre tel que le serveur le décrit (MembreGroupe, packages/shared). */
private class Membre(val id: String, val nom: String, val pseudo: String?, val photo: String?, val admin: Boolean, val soi: Boolean)

private fun membresDe(g: JsonObject?): List<Membre> =
    (g?.get("membres") as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }.map { m ->
        Membre(m.texte("id"), m.texte("nom"), m.texteOuNul("pseudo"), m.texteOuNul("photo"), m.texte("role") == "admin", m.vrai("estSoi"))
    }
        // Moi d'abord, puis les administrateurs, puis l'ordre alphabétique (comme la fiche du web).
        .sortedWith(compareByDescending<Membre> { it.soi }.thenByDescending { it.admin }.thenBy { it.nom.lowercase() })

@Composable
private fun EnTete(titre: String, onRetour: () -> Unit) {
    val p = LocalPalette.current
    Row(Modifier.fillMaxWidth().background(p.entete).padding(horizontal = 4.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(
            painterResource(R.drawable.lucide_arrow_left), contentDescription = "Retour", tint = p.texte,
            modifier = Modifier.size(44.dp).clip(CircleShape).clickable(role = Role.Button, onClick = onRetour).padding(11.dp),
        )
        Spacer(Modifier.width(8.dp))
        Text(titre, color = p.texte, fontSize = 18.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun Avatar(conteneur: Conteneur, id: String, nom: String, photo: String?, taille: Int = 44) {
    val p = LocalPalette.current
    val forme = Modifier.size(taille.dp).clip(CircleShape).background(p.primaireDoux)
    if (photo != null) {
        AsyncImage(model = conteneur.photo(id, photo), imageLoader = conteneur.images, contentDescription = null, contentScale = ContentScale.Crop, modifier = forme)
    } else {
        Box(forme, contentAlignment = Alignment.Center) {
            Text(nom.trim().take(1).uppercase(), color = p.primaireTexte, fontSize = (taille * 0.4).sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

/** Une case à cocher ronde : pleine et cochée quand la personne est choisie. */
@Composable
private fun Coche(active: Boolean) {
    val p = LocalPalette.current
    Box(
        Modifier.size(24.dp).clip(CircleShape).background(if (active) p.primaire else p.fond).border(2.dp, if (active) p.primaire else p.bordure, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        if (active) Icon(painterResource(R.drawable.lucide_check), contentDescription = null, tint = p.surPrimaire, modifier = Modifier.size(16.dp))
    }
}

/** Un champ de saisie sur une ligne, dans la forme des autres champs de l'appli. */
@Composable
private fun Champ(valeur: String, onValeur: (String) -> Unit, indication: String, modifier: Modifier = Modifier, lignes: Int = 1, icone: Int? = null) {
    val p = LocalPalette.current
    Row(
        modifier.fillMaxWidth().heightIn(min = 46.dp).clip(RoundedCornerShape(23.dp)).background(p.panneau).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        icone?.let {
            Icon(painterResource(it), contentDescription = null, tint = p.texte3, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(10.dp))
        }
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
            if (valeur.isEmpty()) Text(indication, color = p.texte3, fontSize = 15.sp, maxLines = 1)
            BasicTextField(
                value = valeur, onValueChange = onValeur, singleLine = lignes == 1, maxLines = lignes,
                textStyle = TextStyle(color = p.texte, fontSize = 15.sp, lineHeight = 21.sp), cursorBrush = SolidColor(p.primaire),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/**
 * Choisir des contacts : pour créer un groupe ou y ajouter des membres.
 * Ceux qui en font déjà partie n'apparaissent pas ; la limite de 40
 * personnes compte les membres présents.
 */
@Composable
private fun ChoixContacts(
    espace: EspaceCompte,
    conteneur: Conteneur,
    exclus: Set<String>,
    places: Int,
    action: String,
    enCours: Boolean,
    erreur: String?,
    onValider: (List<CarteProfil>) -> Unit,
) {
    val p = LocalPalette.current
    val contacts by produceState<Result<List<CarteProfil>>?>(null) {
        value = espace.session.connecte { conteneur.reseau.api.contacts() }.map { r -> r.contacts.filter { it.id !in exclus && !it.estSoi } }
    }
    var filtre by rememberSaveable { mutableStateOf("") }
    var choix by remember { mutableStateOf(listOf<CarteProfil>()) }

    Column(Modifier.fillMaxSize()) {
        Champ(filtre, { filtre = it }, "Rechercher un contact", Modifier.padding(16.dp), icone = R.drawable.lucide_search)
        val r = contacts
        val liste = r?.getOrNull()
        when {
            r == null -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(Modifier.size(24.dp), color = p.primaire, strokeWidth = 2.dp)
            }
            liste == null -> NoteGroupe("Vos contacts n'ont pas pu être chargés.", danger = true)
            liste.isEmpty() && exclus.isEmpty() -> NoteGroupe("Ajoutez d'abord des contacts : un groupe se crée avec eux.")
            liste.isEmpty() -> NoteGroupe("Tous vos contacts font déjà partie du groupe.")
            else -> {
                val q = filtre.trim().lowercase().removePrefix("@")
                val visibles = liste.filter { q.isEmpty() || q in it.nom.lowercase() || (it.pseudo ?: "").contains(q) }
                LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
                    itemsIndexed(visibles, key = { _, c -> c.id }) { i, c ->
                        val actif = choix.any { it.id == c.id }
                        Row(
                            Modifier.entree(i).fillMaxWidth().clickable(role = Role.Checkbox) {
                                choix = if (actif) choix.filter { it.id != c.id } else if (choix.size < places) choix + c else choix
                            }.padding(horizontal = 16.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Avatar(conteneur, c.id, c.nom, c.photo)
                            Spacer(Modifier.width(14.dp))
                            Column(Modifier.weight(1f)) {
                                Text(c.nom, color = p.texte, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                c.pseudo?.let { Text("@$it", color = p.texte2, fontSize = 13.sp, maxLines = 1) }
                            }
                            Coche(actif)
                        }
                    }
                }
            }
        }
        erreur?.let { NoteGroupe(it, danger = true) }
        // Le bouton monte quand au moins une personne est choisie.
        AnimatedVisibility(choix.isNotEmpty(), enter = slideInVertically(tween(200)) { it } + fadeIn(tween(200)), exit = slideOutVertically(tween(150)) { it } + fadeOut(tween(150))) {
            Row(
                Modifier.fillMaxWidth().background(p.entete).navigationBarsPadding().padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "${choix.size} ${if (choix.size > 1) "personnes choisies" else "personne choisie"}" + if (choix.size >= places) " (maximum)" else "",
                    color = p.texte2, fontSize = 14.sp, modifier = Modifier.weight(1f),
                )
                BoutonPlein(action, enCours) { onValider(choix) }
            }
        }
    }
}

@Composable
private fun BoutonPlein(libelle: String, enCours: Boolean = false, actif: Boolean = true, onClick: () -> Unit) {
    val p = LocalPalette.current
    Box(
        Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(22.dp)).background(if (actif) p.primaire else p.bordure)
            .clickable(enabled = actif && !enCours, role = Role.Button, onClick = onClick).padding(horizontal = 20.dp, vertical = 11.dp),
        contentAlignment = Alignment.Center,
    ) {
        if (enCours) CircularProgressIndicator(Modifier.size(18.dp), color = p.surPrimaire, strokeWidth = 2.dp)
        else Text(libelle, color = p.surPrimaire, fontSize = 15.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun NoteGroupe(texte: String, danger: Boolean = false) {
    val p = LocalPalette.current
    Text(texte, color = if (danger) p.danger else p.texte2, fontSize = 14.sp, lineHeight = 20.sp, modifier = Modifier.padding(horizontal = 24.dp, vertical = 14.dp))
}

/** Nouveau groupe, en deux temps comme sur le web : les personnes, puis le nom. */
@Composable
fun EcranNouveauGroupe(espace: EspaceCompte, conteneur: Conteneur, onRetour: () -> Unit, onCree: (String) -> Unit) {
    val p = LocalPalette.current
    val portee = rememberCoroutineScope()
    var membres by remember { mutableStateOf<List<CarteProfil>?>(null) }
    var nom by rememberSaveable { mutableStateOf("") }
    var enCours by remember { mutableStateOf(false) }
    var erreur by remember { mutableStateOf<String?>(null) }

    Column(Modifier.fillMaxSize().background(p.fond).safeDrawingPadding().imePadding()) {
        EnTete("Nouveau groupe", onRetour = { if (membres != null) membres = null else onRetour() })
        AnimatedContent(membres, transitionSpec = { fadeIn(tween(200)) togetherWith fadeOut(tween(120)) }, label = "etape") { choisis ->
            if (choisis == null) {
                ChoixContacts(espace, conteneur, emptySet(), MEMBRES_MAX - 1, "Suivant", enCours = false, erreur = null) {
                    erreur = null
                    membres = it
                }
            } else {
                Column(Modifier.fillMaxSize()) {
                    Champ(nom, { if (it.length <= NOM_MAX) nom = it }, "Nom du groupe", Modifier.padding(16.dp))
                    Text(
                        "${choisis.size + 1} membres : vous, ${choisis.joinToString(", ") { it.nom }}",
                        color = p.texte2, fontSize = 14.sp, lineHeight = 20.sp, modifier = Modifier.padding(horizontal = 24.dp),
                    )
                    erreur?.let { NoteGroupe(it, danger = true) }
                    Spacer(Modifier.weight(1f))
                    Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(16.dp)) {
                        Spacer(Modifier.weight(1f))
                        BoutonPlein("Créer le groupe", enCours, actif = nom.isNotBlank()) {
                            enCours = true
                            erreur = null
                            portee.launch {
                                espace.session.connecte { conteneur.reseau.api.creerGroupe(CreationGroupe(nom.trim(), choisis.map { it.id })) }
                                    .onSuccess { g ->
                                        withContext(Dispatchers.IO) {
                                            choisis.forEach { espace.annuaire.retenir(it) }
                                            espace.annuaire.rangerGroupe(g)
                                        }
                                        onCree("g:${g.texte("id")}")
                                    }
                                    .onFailure { erreur = if (it is ErreurServeur) messageErreur(it) else "Le groupe n'a pas pu être créé." }
                                enCours = false
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Ce que demande une action de la fiche avant de s'exécuter. */
private sealed interface DemandeGroupe {
    data object Nom : DemandeGroupe
    data object Description : DemandeGroupe
    data object Quitter : DemandeGroupe
    data class Retirer(val m: Membre) : DemandeGroupe
}

/**
 * Infos du groupe : nom et description (modifiables par un administrateur),
 * membres et rôles, ajout et retrait, départ. Chaque changement passe par le
 * serveur, qui l'annonce dans la discussion à tous les membres.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EcranInfosGroupe(
    espace: EspaceCompte,
    conteneur: Conteneur,
    groupeId: String,
    onRetour: () -> Unit,
    onEcrire: (String) -> Unit,
    onQuitte: () -> Unit,
) {
    val p = LocalPalette.current
    val portee = rememberCoroutineScope()
    val version by espace.base.version.collectAsStateWithLifecycle()
    val local by produceState<JsonObject?>(null, version) { value = withContext(Dispatchers.IO) { espace.base.groupe(groupeId) } }
    var horsGroupe by remember { mutableStateOf(false) }
    var ajout by remember { mutableStateOf(false) }
    var enCours by remember { mutableStateOf(false) }
    var erreur by remember { mutableStateOf<String?>(null) }
    var demande by remember { mutableStateOf<DemandeGroupe?>(null) }
    var choisi by remember { mutableStateOf<Membre?>(null) }

    // La fiche montre d'abord ce que la base connaît, puis l'état du serveur.
    LaunchedEffect(groupeId) {
        espace.session.connecte { conteneur.reseau.api.groupe(groupeId) }
            .onSuccess { g -> withContext(Dispatchers.IO) { espace.annuaire.rangerGroupe(g) } }
            .onFailure { if (it is ErreurServeur && it.statut == 404) horsGroupe = true }
    }

    fun agir(echec: String, bloc: suspend () -> JsonObject?) {
        enCours = true
        erreur = null
        portee.launch {
            runCatching { bloc() }
                .onSuccess { g -> if (g != null) withContext(Dispatchers.IO) { espace.annuaire.rangerGroupe(g) } }
                .onFailure { erreur = if (it is ErreurServeur) messageErreur(it) else echec }
            enCours = false
        }
    }

    val g = local
    val membres = membresDe(g)
    val moiAdmin = g?.vrai("moiAdmin") == true && !horsGroupe
    val membre = g?.get("moiMembre")?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content != "false" } ?: true

    Column(Modifier.fillMaxSize().background(p.fond).safeDrawingPadding().imePadding()) {
        EnTete(if (ajout) "Ajouter des membres" else "Infos du groupe", onRetour = { if (ajout) ajout = false else onRetour() })
        if (ajout) {
            ChoixContacts(espace, conteneur, membres.map { it.id }.toSet(), MEMBRES_MAX - membres.size, "Ajouter au groupe", enCours, erreur) { choix ->
                agir("L'action a échoué.") {
                    val r = espace.session.connecte { conteneur.reseau.api.ajouterMembres(groupeId, AjoutMembres(choix.map { it.id })) }.getOrThrow()
                    withContext(Dispatchers.IO) { choix.forEach { espace.annuaire.retenir(it) } }
                    ajout = false
                    r
                }
            }
            return@Column
        }
        if (g == null) {
            Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(Modifier.size(24.dp), color = p.primaire, strokeWidth = 2.dp)
            }
            return@Column
        }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
            item(key = "tete") {
                Column(Modifier.fillMaxWidth().padding(vertical = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(Modifier.size(88.dp).clip(CircleShape).background(p.primaireDoux), contentAlignment = Alignment.Center) {
                        Icon(painterResource(R.drawable.lucide_users), contentDescription = null, tint = p.primaireTexte, modifier = Modifier.size(40.dp))
                    }
                    Spacer(Modifier.height(14.dp))
                    Row(
                        Modifier.clip(RoundedCornerShape(8.dp)).clickable(enabled = moiAdmin, role = Role.Button) { demande = DemandeGroupe.Nom }.padding(horizontal = 8.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(g.texte("nom").ifEmpty { "Groupe" }, color = p.texte, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
                        if (moiAdmin) {
                            Spacer(Modifier.width(8.dp))
                            Icon(painterResource(R.drawable.lucide_pencil), contentDescription = "Nom du groupe", tint = p.texte3, modifier = Modifier.size(16.dp))
                        }
                    }
                    Text(
                        if (horsGroupe || !membre) "Vous ne faites plus partie de ce groupe" else "Groupe · ${membres.size} membres",
                        color = p.texte2, fontSize = 14.sp,
                    )
                }
            }
            item(key = "description") {
                val description = g.texte("description")
                if (description.isNotEmpty() || moiAdmin) {
                    Column(
                        Modifier.fillMaxWidth().clickable(enabled = moiAdmin, role = Role.Button) { demande = DemandeGroupe.Description }.padding(horizontal = 24.dp, vertical = 12.dp),
                    ) {
                        Text("Description", color = p.primaire, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                        Spacer(Modifier.height(4.dp))
                        Text(description.ifEmpty { "Ajouter une description" }, color = if (description.isEmpty()) p.texte3 else p.texte, fontSize = 15.sp, lineHeight = 21.sp)
                    }
                }
            }
            erreur?.let { e -> item(key = "erreur") { NoteGroupe(e, danger = true) } }
            if (!horsGroupe && membre) {
                item(key = "membres") {
                    Text("${membres.size} membres", color = p.primaire, fontSize = 13.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(start = 24.dp, top = 16.dp, bottom = 4.dp))
                }
                if (moiAdmin && membres.size < MEMBRES_MAX) {
                    item(key = "ajouter") {
                        Row(
                            Modifier.fillMaxWidth().clickable(role = Role.Button) { erreur = null; ajout = true }.padding(horizontal = 16.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(Modifier.size(44.dp).clip(CircleShape).background(p.primaire), contentAlignment = Alignment.Center) {
                                Icon(painterResource(R.drawable.lucide_user_plus), contentDescription = null, tint = p.surPrimaire, modifier = Modifier.size(20.dp))
                            }
                            Spacer(Modifier.width(14.dp))
                            Text("Ajouter des membres", color = p.texte, fontSize = 16.sp)
                        }
                    }
                }
                itemsIndexed(membres, key = { _, m -> "m:" + m.id }) { i, m ->
                    Row(
                        Modifier.entree(i).fillMaxWidth().clickable(enabled = !m.soi, role = Role.Button) { choisi = m }.padding(horizontal = 16.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Avatar(conteneur, m.id, m.nom, m.photo)
                        Spacer(Modifier.width(14.dp))
                        Column(Modifier.weight(1f)) {
                            Text(if (m.soi) "Vous" else m.nom, color = p.texte, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            m.pseudo?.let { Text("@$it", color = p.texte2, fontSize = 13.sp, maxLines = 1) }
                        }
                        if (m.admin) {
                            Text(
                                "Admin", color = p.primaireTexte, fontSize = 12.sp, fontWeight = FontWeight.Medium,
                                modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(p.primaireDoux).padding(horizontal = 8.dp, vertical = 3.dp),
                            )
                        }
                    }
                }
                item(key = "quitter") {
                    Row(
                        Modifier.fillMaxWidth().padding(top = 12.dp).clickable(role = Role.Button) { demande = DemandeGroupe.Quitter }.padding(horizontal = 24.dp, vertical = 16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(painterResource(R.drawable.lucide_log_out), contentDescription = null, tint = p.danger, modifier = Modifier.size(22.dp))
                        Spacer(Modifier.width(18.dp))
                        Text("Quitter le groupe", color = p.danger, fontSize = 16.sp)
                    }
                }
            }
        }
    }

    choisi?.let { m ->
        val etat = rememberModalBottomSheetState()
        ModalBottomSheet(onDismissRequest = { choisi = null }, sheetState = etat, containerColor = p.panneau) {
            Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 12.dp)) {
                Text(m.nom, color = p.texte, fontSize = 17.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(start = 24.dp, end = 24.dp, bottom = 8.dp))
                ActionFiche(R.drawable.lucide_message_circle, "Envoyer un message") {
                    choisi = null
                    onEcrire(m.id)
                }
                if (moiAdmin && !m.admin) {
                    ActionFiche(R.drawable.lucide_shield_check, "Nommer administrateur") {
                        choisi = null
                        agir("L'action a échoué.") { espace.session.connecte { conteneur.reseau.api.nommerAdmin(groupeId, m.id) }.getOrThrow() }
                    }
                }
                if (moiAdmin) {
                    ActionFiche(R.drawable.lucide_user_minus, "Retirer du groupe", danger = true) {
                        choisi = null
                        demande = DemandeGroupe.Retirer(m)
                    }
                }
            }
        }
    }

    demande?.let { q ->
        when (q) {
            DemandeGroupe.Nom, DemandeGroupe.Description -> {
                val estNom = q == DemandeGroupe.Nom
                var valeur by remember { mutableStateOf(g?.texte(if (estNom) "nom" else "description").orEmpty()) }
                AlertDialog(
                    onDismissRequest = { demande = null },
                    containerColor = p.panneau,
                    title = { Text(if (estNom) "Nom du groupe" else "Description", color = p.texte) },
                    text = {
                        Champ(valeur, { if (it.length <= if (estNom) NOM_MAX else DESCRIPTION_MAX) valeur = it }, if (estNom) "Nom du groupe" else "Ajouter une description", lignes = if (estNom) 1 else 5)
                    },
                    confirmButton = {
                        TextButton(enabled = !estNom || valeur.isNotBlank(), onClick = {
                            demande = null
                            val maj = if (estNom) MajGroupe(nom = valeur.trim()) else MajGroupe(description = valeur.trim())
                            agir("L'action a échoué.") { espace.session.connecte { conteneur.reseau.api.majGroupe(groupeId, maj) }.getOrThrow() }
                        }) { Text("Enregistrer", color = p.primaire, fontWeight = FontWeight.Medium) }
                    },
                    dismissButton = { TextButton(onClick = { demande = null }) { Text("Annuler", color = p.texte2) } },
                )
            }
            DemandeGroupe.Quitter -> AlertDialog(
                onDismissRequest = { demande = null },
                containerColor = p.panneau,
                title = { Text("Quitter « ${g?.texte("nom").orEmpty()} » ?", color = p.texte) },
                text = { Text("Les membres verront que vous êtes parti. Vous garderez l'historique déjà reçu, sans pouvoir y écrire.", color = p.texte2) },
                confirmButton = {
                    TextButton(onClick = {
                        demande = null
                        enCours = true
                        portee.launch {
                            espace.session.connecte { conteneur.reseau.api.retirerMembre(groupeId, espace.moi) }
                                .onSuccess {
                                    withContext(Dispatchers.IO) { espace.annuaire.quitterGroupe(groupeId) }
                                    onQuitte()
                                }
                                .onFailure { erreur = if (it is ErreurServeur) messageErreur(it) else "L'action a échoué." }
                            enCours = false
                        }
                    }) { Text("Quitter", color = p.danger, fontWeight = FontWeight.Medium) }
                },
                dismissButton = { TextButton(onClick = { demande = null }) { Text("Annuler", color = p.texte2) } },
            )
            is DemandeGroupe.Retirer -> AlertDialog(
                onDismissRequest = { demande = null },
                containerColor = p.panneau,
                title = { Text("Retirer ${q.m.nom} du groupe ?", color = p.texte) },
                confirmButton = {
                    TextButton(onClick = {
                        demande = null
                        agir("L'action a échoué.") {
                            espace.session.connecte { conteneur.reseau.api.retirerMembre(groupeId, q.m.id) }.getOrThrow()
                            espace.session.connecte { conteneur.reseau.api.groupe(groupeId) }.getOrThrow()
                        }
                    }) { Text("Retirer", color = p.danger, fontWeight = FontWeight.Medium) }
                },
                dismissButton = { TextButton(onClick = { demande = null }) { Text("Annuler", color = p.texte2) } },
            )
        }
    }
}

@Composable
private fun ActionFiche(icone: Int, libelle: String, danger: Boolean = false, onClick: () -> Unit) {
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
