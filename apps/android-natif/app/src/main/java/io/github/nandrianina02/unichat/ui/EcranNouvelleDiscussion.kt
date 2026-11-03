package io.github.nandrianina02.unichat.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import io.github.nandrianina02.unichat.Conteneur
import io.github.nandrianina02.unichat.R
import io.github.nandrianina02.unichat.donnees.AjoutContact
import io.github.nandrianina02.unichat.donnees.CarteProfil
import io.github.nandrianina02.unichat.donnees.EspaceCompte
import io.github.nandrianina02.unichat.donnees.messageErreur
import io.github.nandrianina02.unichat.donnees.rechercheValide
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Où en est la recherche (mêmes états que NouvelleDiscussion.tsx). */
private sealed interface Resultat {
    data object Vide : Resultat
    data object Indice : Resultat
    data object EnCours : Resultat
    data class Trouve(val carte: CarteProfil) : Resultat
    data object Aucun : Resultat
    data class Erreur(val message: String) : Resultat
}

/**
 * Commencer une discussion : avec un contact, ou avec une personne trouvée
 * par son nom d'utilisateur complet ou son adresse e-mail. La recherche est
 * exacte, comme sur le web : pas de résultats partiels.
 */
@Composable
fun EcranNouvelleDiscussion(espace: EspaceCompte, conteneur: Conteneur, onRetour: () -> Unit, onOuvrir: (String) -> Unit, onNouveauGroupe: () -> Unit = {}) {
    val p = LocalPalette.current
    val portee = rememberCoroutineScope()
    var texte by rememberSaveable { mutableStateOf("") }
    var resultat by remember { mutableStateOf<Resultat>(Resultat.Vide) }
    var contacts by remember { mutableStateOf<List<CarteProfil>?>(null) }
    var ajout by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }

    LaunchedEffect(Unit) {
        focus.requestFocus()
        espace.session.connecte { conteneur.reseau.api.contacts() }.onSuccess { contacts = it.contacts }.onFailure { contacts = emptyList() }
    }
    // Recherche lancée 400 ms après la dernière frappe, et seulement sur une saisie complète.
    LaunchedEffect(texte) {
        resultat = when {
            texte.isBlank() -> Resultat.Vide
            !rechercheValide(texte) -> Resultat.Indice
            else -> {
                resultat = Resultat.EnCours
                delay(400)
                espace.session.connecte { conteneur.reseau.api.rechercher(texte.trim()) }.fold(
                    onSuccess = { r -> r.resultats.firstOrNull()?.let { Resultat.Trouve(it) } ?: Resultat.Aucun },
                    onFailure = { Resultat.Erreur(messageErreur(it)) },
                )
            }
        }
    }

    fun ouvrir(c: CarteProfil) {
        portee.launch {
            withContext(Dispatchers.IO) { espace.annuaire.retenir(c) }
            onOuvrir(c.id)
        }
    }

    Column(Modifier.fillMaxSize().background(p.fond).safeDrawingPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().background(p.entete).padding(horizontal = 4.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(
                painterResource(R.drawable.lucide_arrow_left), contentDescription = "Retour", tint = p.texte,
                modifier = Modifier.size(44.dp).clip(CircleShape).clickable(role = Role.Button, onClick = onRetour).padding(11.dp),
            )
            Spacer(Modifier.width(8.dp))
            Text("Nouvelle discussion", color = p.texte, fontSize = 18.sp, fontWeight = FontWeight.Medium)
        }
        Row(
            Modifier.fillMaxWidth().padding(16.dp).heightIn(min = 46.dp).clip(RoundedCornerShape(23.dp)).background(p.panneau).padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(painterResource(R.drawable.lucide_search), contentDescription = null, tint = p.texte3, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(10.dp))
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                if (texte.isEmpty()) Text("Nom d'utilisateur ou adresse e-mail", color = p.texte3, fontSize = 15.sp, maxLines = 1)
                BasicTextField(
                    value = texte,
                    onValueChange = { texte = it },
                    singleLine = true,
                    textStyle = TextStyle(color = p.texte, fontSize = 15.sp),
                    cursorBrush = SolidColor(p.primaire),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, autoCorrectEnabled = false),
                    modifier = Modifier.fillMaxWidth().focusRequester(focus),
                )
            }
            if (texte.isNotEmpty()) {
                Icon(
                    painterResource(R.drawable.lucide_x), contentDescription = "Effacer", tint = p.texte2,
                    modifier = Modifier.size(36.dp).clip(CircleShape).clickable(role = Role.Button) { texte = "" }.padding(9.dp),
                )
            }
        }

        // Le résultat change en fondu : indice, recherche, personne trouvée ou rien.
        AnimatedContent(resultat, transitionSpec = { fadeIn(tween(200)) togetherWith fadeOut(tween(120)) }, label = "recherche") { r ->
            when (r) {
                Resultat.Vide -> Unit
                Resultat.Indice -> Note(
                    "Saisissez un nom d'utilisateur complet (par exemple @ana.rakoto) ou une adresse e-mail entière. " +
                        "Pour protéger chacun, UniChat ne propose pas de résultats partiels.",
                )
                Resultat.EnCours -> Row(Modifier.padding(horizontal = 28.dp, vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(18.dp), color = p.primaire, strokeWidth = 2.dp)
                    Spacer(Modifier.width(12.dp))
                    Text("Recherche…", color = p.texte2, fontSize = 14.sp)
                }
                Resultat.Aucun -> Note(
                    "Personne sur UniChat n'a ce nom d'utilisateur, ou cette personne ne souhaite pas être trouvée par son adresse e-mail.",
                )
                is Resultat.Erreur -> Note(r.message, couleur = p.danger)
                is Resultat.Trouve -> Column {
                    Titre("Résultat")
                    LignePersonne(conteneur, r.carte, Modifier, onClick = { if (!r.carte.bloque) ouvrir(r.carte) }) {
                        when {
                            r.carte.estSoi -> Unit
                            r.carte.estContact -> Icon(painterResource(R.drawable.lucide_user_check), contentDescription = "Dans vos contacts", tint = p.texte3, modifier = Modifier.size(20.dp))
                            ajout -> CircularProgressIndicator(Modifier.size(18.dp), color = p.primaire, strokeWidth = 2.dp)
                            else -> Icon(
                                painterResource(R.drawable.lucide_user_plus), contentDescription = "Ajouter aux contacts", tint = p.primaire,
                                modifier = Modifier.size(40.dp).clip(CircleShape).clickable(role = Role.Button) {
                                    ajout = true
                                    portee.launch {
                                        espace.session.connecte { conteneur.reseau.api.ajouterContact(AjoutContact(r.carte.id)) }
                                            .onSuccess { nouvelle ->
                                                resultat = Resultat.Trouve(nouvelle)
                                                contacts = (contacts.orEmpty() + nouvelle).distinctBy { it.id }.sortedBy { it.nom.lowercase() }
                                            }
                                            .onFailure { resultat = Resultat.Erreur(messageErreur(it)) }
                                        ajout = false
                                    }
                                }.padding(10.dp),
                            )
                        }
                    }
                    if (r.carte.bloque) Note("Vous avez bloqué cette personne. Débloquez-la depuis UniChat sur le web pour lui écrire.")
                }
            }
        }

        Row(
            Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onNouveauGroupe).padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(46.dp).clip(CircleShape).background(p.primaire), contentAlignment = Alignment.Center) {
                Icon(painterResource(R.drawable.lucide_users), contentDescription = null, tint = p.surPrimaire, modifier = Modifier.size(22.dp))
            }
            Spacer(Modifier.width(14.dp))
            Column {
                Text("Nouveau groupe", color = p.texte, fontSize = 16.sp, fontWeight = FontWeight.Medium)
                Text("Jusqu'à 40 personnes de vos contacts", color = p.texte2, fontSize = 13.sp)
            }
        }
        val liste = contacts
        Titre("Contacts sur UniChat")
        when {
            liste == null -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(Modifier.size(24.dp), color = p.primaire, strokeWidth = 2.dp)
            }
            liste.isEmpty() -> Note("Vous n'avez pas encore de contact.")
            else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
                itemsIndexed(liste, key = { _, c -> c.id }) { i, c ->
                    LignePersonne(conteneur, c, Modifier.entree(i), onClick = { ouvrir(c) })
                }
            }
        }
    }
}

@Composable
private fun Titre(texte: String) {
    val p = LocalPalette.current
    Text(texte, color = p.primaire, fontSize = 13.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(start = 20.dp, top = 12.dp, bottom = 6.dp))
}

@Composable
private fun Note(texte: String, couleur: androidx.compose.ui.graphics.Color? = null) {
    val p = LocalPalette.current
    Text(texte, color = couleur ?: p.texte2, fontSize = 14.sp, lineHeight = 20.sp, modifier = Modifier.padding(horizontal = 28.dp, vertical = 14.dp))
}

@Composable
private fun LignePersonne(
    conteneur: Conteneur,
    c: CarteProfil,
    modifier: Modifier,
    onClick: () -> Unit,
    fin: @Composable () -> Unit = {},
) {
    val p = LocalPalette.current
    Row(
        modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val forme = Modifier.size(46.dp).clip(CircleShape).background(p.primaireDoux)
        if (c.photo != null) {
            AsyncImage(model = conteneur.photo(c.id, c.photo), imageLoader = conteneur.images, contentDescription = null, contentScale = ContentScale.Crop, modifier = forme)
        } else {
            Box(forme, contentAlignment = Alignment.Center) {
                Text(c.nom.trim().take(1).uppercase(), color = p.primaireTexte, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
            }
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(if (c.estSoi) "${c.nom} (vous)" else c.nom, color = p.texte, fontSize = 16.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            c.pseudo?.let { Text("@$it", color = p.texte2, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
        fin()
    }
}
