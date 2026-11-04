package io.github.nandrianina02.unichat.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.nandrianina02.unichat.Conteneur
import io.github.nandrianina02.unichat.R
import io.github.nandrianina02.unichat.donnees.ConnexionAnnulee
import io.github.nandrianina02.unichat.donnees.DemandeConnexionTelephone
import io.github.nandrianina02.unichat.donnees.afficherTelephone
import io.github.nandrianina02.unichat.donnees.jetonGoogle
import io.github.nandrianina02.unichat.donnees.messageErreur
import io.github.nandrianina02.unichat.donnees.normaliserTelephone
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Délai avant de pouvoir redemander un code : le SMS met parfois une minute à arriver. */
private const val ATTENTE_RENVOI = 60

private enum class ModeConnexion { CHOIX, NUMERO, CODE }

/**
 * Connexion, comme sur le web : par Google (le compte se choisit dans la
 * feuille du système), ou par numéro de téléphone avec un code reçu par SMS.
 * Par numéro, inscription et connexion ne font qu'un : le compte se crée
 * s'il n'existe pas.
 */
@Composable
fun EcranConnexion(conteneur: Conteneur) {
    val p = LocalPalette.current
    val contexte = LocalContext.current
    val portee = rememberCoroutineScope()
    var mode by remember { mutableStateOf(ModeConnexion.CHOIX) }
    var enCours by remember { mutableStateOf(false) }
    var erreur by remember { mutableStateOf<String?>(null) }
    var numero by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var demande by remember { mutableStateOf<DemandeConnexionTelephone?>(null) }
    var renvoi by remember { mutableIntStateOf(0) }

    LaunchedEffect(renvoi) {
        if (renvoi > 0) {
            delay(1000)
            renvoi--
        }
    }

    fun lancer(action: suspend () -> Unit) {
        if (enCours) return
        enCours = true
        erreur = null
        portee.launch {
            try {
                action()
            } catch (e: ConnexionAnnulee) {
                // Feuille Google fermée : on reste sur l'écran, sans message.
            } catch (e: Exception) {
                erreur = e.message?.takeIf { e !is java.io.IOException } ?: messageErreur(e)
            } finally {
                enCours = false
            }
        }
    }

    fun connecterGoogle() = lancer {
        val d = conteneur.session.nonce()
        conteneur.session.connecter(d.etat, jetonGoogle(contexte, d.nonce))
    }

    fun demanderCode(n: String) = lancer {
        demande = conteneur.session.demanderCodeConnexion(n)
        code = ""
        renvoi = ATTENTE_RENVOI
        mode = ModeConnexion.CODE
    }

    Column(
        Modifier.fillMaxSize().background(p.fond).safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 28.dp, vertical = 32.dp),
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

        AnimatedContent(mode, transitionSpec = { fadeIn(tween(250)) togetherWith fadeOut(tween(120)) }, label = "connexion") { m ->
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                when (m) {
                    ModeConnexion.CHOIX -> {
                        BoutonConnexion("Continuer avec Google", R.drawable.lucide_log_in, plein = true, enCours = enCours) { connecterGoogle() }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.weight(1f).height(1.dp).background(p.bordure))
                            Text("ou", color = p.texte3, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 12.dp))
                            Box(Modifier.weight(1f).height(1.dp).background(p.bordure))
                        }
                        BoutonConnexion("Continuer avec un numéro", R.drawable.lucide_phone, plein = false, enCours = false) {
                            erreur = null
                            mode = ModeConnexion.NUMERO
                        }
                        Text(
                            "Inscription ou connexion : la même démarche, avec Google ou avec un code reçu par SMS.",
                            color = p.texte3, fontSize = 13.sp, lineHeight = 18.sp,
                        )
                    }
                    ModeConnexion.NUMERO -> {
                        Retour("Autres façons de se connecter") { mode = ModeConnexion.CHOIX }
                        Text("Votre numéro de mobile", color = p.texte, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                        ChampConnexion(numero, { numero = it; erreur = null }, "034 12 345 67", KeyboardType.Phone)
                        Text(
                            if (numero.isNotBlank() && normaliserTelephone(numero) == null) "Un mobile malgache : 032, 033, 034, 037, 038 ou 039."
                            else "Nouveau sur UniChat ? Le compte se crée avec ce numéro.",
                            color = p.texte3, fontSize = 13.sp,
                        )
                        val valide = normaliserTelephone(numero)
                        BoutonConnexion("Recevoir un code par SMS", R.drawable.lucide_message_square_text, plein = true, enCours = enCours, actif = valide != null) {
                            valide?.let(::demanderCode)
                        }
                    }
                    ModeConnexion.CODE -> {
                        Retour("Changer de numéro") { mode = ModeConnexion.NUMERO }
                        Text(
                            "Code envoyé au ${afficherTelephone(demande?.numero.orEmpty())}.",
                            color = p.texte, fontSize = 15.sp,
                        )
                        ChampConnexion(code, { code = it.filter(Char::isDigit).take(8); erreur = null }, "••••••", KeyboardType.NumberPassword, chiffres = true)
                        BoutonConnexion("Se connecter", R.drawable.lucide_log_in, plein = true, enCours = enCours, actif = code.length >= 4) {
                            val d = demande ?: return@BoutonConnexion
                            lancer { conteneur.session.connecterParTelephone(d.demande, code) }
                        }
                        Text(
                            if (renvoi > 0) "Renvoyer le code ($renvoi s)" else "Renvoyer le code",
                            color = if (renvoi > 0) p.texte3 else p.primaire, fontSize = 14.sp, fontWeight = FontWeight.Medium,
                            modifier = Modifier.clip(RoundedCornerShape(8.dp))
                                .clickable(enabled = renvoi == 0 && !enCours, role = Role.Button) { demande?.let { demanderCode(it.numero) } }
                                .padding(vertical = 6.dp),
                        )
                    }
                }
            }
        }
        Box(Modifier.fillMaxWidth().padding(top = 16.dp)) {
            erreur?.let { Text(it, color = p.danger, fontSize = 14.sp, textAlign = TextAlign.Start) }
        }
    }
}

@Composable
private fun BoutonConnexion(texte: String, icone: Int, plein: Boolean, enCours: Boolean, actif: Boolean = true, onClick: () -> Unit) {
    val p = LocalPalette.current
    val forme = RoundedCornerShape(12.dp)
    val encre = if (plein) p.surPrimaire else p.texte
    Row(
        Modifier
            .fillMaxWidth()
            .height(52.dp)
            .clip(forme)
            .then(if (plein) Modifier.background(if (actif) p.primaire else p.primaire.copy(alpha = 0.4f)) else Modifier.border(1.dp, p.bordure, forme))
            .clickable(enabled = actif && !enCours, role = Role.Button, onClickLabel = texte, onClick = onClick),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (enCours) {
            CircularProgressIndicator(Modifier.size(20.dp), color = encre, strokeWidth = 2.dp)
        } else {
            Icon(painterResource(icone), contentDescription = null, tint = encre, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(10.dp))
            Text(texte, color = encre, fontSize = 16.sp, fontWeight = FontWeight.Medium)
        }
    }
}

@Composable
private fun Retour(texte: String, onClick: () -> Unit) {
    val p = LocalPalette.current
    Row(
        Modifier.clip(RoundedCornerShape(8.dp)).clickable(role = Role.Button, onClick = onClick).padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(painterResource(R.drawable.lucide_arrow_left), contentDescription = null, tint = p.texte2, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(6.dp))
        Text(texte, color = p.texte2, fontSize = 14.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun ChampConnexion(valeur: String, onValeur: (String) -> Unit, indication: String, clavier: KeyboardType, chiffres: Boolean = false) {
    val p = LocalPalette.current
    val style = TextStyle(
        color = p.texte,
        fontSize = if (chiffres) 24.sp else 17.sp,
        fontFamily = if (chiffres) FontFamily.Monospace else FontFamily.Default,
        letterSpacing = if (chiffres) 8.sp else 0.sp,
        textAlign = if (chiffres) TextAlign.Center else TextAlign.Start,
    )
    Box(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(RoundedCornerShape(12.dp)).background(p.panneau)
            .border(1.dp, p.bordure, RoundedCornerShape(12.dp)).padding(horizontal = 16.dp, vertical = 14.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        if (valeur.isEmpty()) Text(indication, style = style.copy(color = p.texte3), modifier = Modifier.fillMaxWidth())
        BasicTextField(
            value = valeur,
            onValueChange = onValeur,
            singleLine = true,
            textStyle = style,
            cursorBrush = SolidColor(p.primaire),
            keyboardOptions = KeyboardOptions(keyboardType = clavier, autoCorrectEnabled = false),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
