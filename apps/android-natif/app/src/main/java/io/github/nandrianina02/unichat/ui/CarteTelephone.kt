package io.github.nandrianina02.unichat.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
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
import io.github.nandrianina02.unichat.donnees.CodeTelephone
import io.github.nandrianina02.unichat.donnees.DemandeTelephone
import io.github.nandrianina02.unichat.donnees.MajTrouvableTelephone
import io.github.nandrianina02.unichat.donnees.Moi
import io.github.nandrianina02.unichat.donnees.afficherTelephone
import io.github.nandrianina02.unichat.donnees.messageErreur
import io.github.nandrianina02.unichat.donnees.normaliserTelephone
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Délai avant de pouvoir redemander un code : le SMS met parfois une minute à arriver. */
private const val ATTENTE_RENVOI = 60

private enum class EtapeTelephone { VERIFIE, SAISIE, CODE }

/**
 * Le numéro du profil, vérifié par un code SMS (même parcours que le
 * panneau web Telephone.tsx). Il sert à être trouvé par ses contacts ; il
 * n'est jamais montré aux autres.
 */
@Composable
fun CarteTelephone(conteneur: Conteneur, moi: Moi, onMoi: (Moi) -> Unit, modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    val portee = rememberCoroutineScope()
    var saisie by remember { mutableStateOf(moi.telephone == null) }
    var numero by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var enCours by remember { mutableStateOf(false) }
    var erreur by remember { mutableStateOf<String?>(null) }
    var renvoi by remember { mutableIntStateOf(0) }
    val etape = when {
        moi.verificationTelephone != null -> EtapeTelephone.CODE
        saisie || moi.telephone == null -> EtapeTelephone.SAISIE
        else -> EtapeTelephone.VERIFIE
    }

    LaunchedEffect(renvoi) {
        if (renvoi > 0) {
            delay(1000)
            renvoi--
        }
    }

    fun executer(action: suspend () -> Moi, apres: () -> Unit = {}) {
        if (enCours) return
        enCours = true
        erreur = null
        portee.launch {
            conteneur.session.connecte { action() }
                .onSuccess {
                    onMoi(it)
                    apres()
                }
                .onFailure { erreur = messageErreur(it) }
            enCours = false
        }
    }

    fun demander(n: String) = executer({ conteneur.reseau.api.demanderTelephone(DemandeTelephone(n)) }) {
        saisie = false
        code = ""
        renvoi = ATTENTE_RENVOI
    }

    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(p.panneau)
            .border(1.dp, p.bordure, RoundedCornerShape(14.dp))
            .padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(40.dp).clip(CircleShape).background(p.primaireDoux), contentAlignment = Alignment.Center) {
                Icon(painterResource(R.drawable.lucide_phone), contentDescription = null, tint = p.primaireTexte, modifier = Modifier.size(20.dp))
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text("Numéro de téléphone", color = p.texte, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                Text(
                    when (etape) {
                        EtapeTelephone.VERIFIE -> "Vérifié · jamais affiché aux autres"
                        EtapeTelephone.CODE -> "Code envoyé par SMS"
                        EtapeTelephone.SAISIE -> "Pour que vos contacts vous trouvent"
                    },
                    color = p.texte2, fontSize = 13.sp,
                )
            }
        }
        Spacer(Modifier.height(14.dp))

        AnimatedContent(etape, transitionSpec = { fadeIn(tween(250)) togetherWith fadeOut(tween(120)) }, label = "telephone") { e ->
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                when (e) {
                    EtapeTelephone.VERIFIE -> {
                        Text(afficherTelephone(moi.telephone.orEmpty()), color = p.texte, fontSize = 20.sp, fontFamily = FontFamily.Monospace)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Me trouver avec ce numéro", color = p.texte, fontSize = 14.sp, modifier = Modifier.weight(1f))
                            Switch(
                                checked = moi.trouvableParTelephone,
                                onCheckedChange = { v -> executer({ conteneur.reseau.api.trouvableParTelephone(MajTrouvableTelephone(v)) }) },
                                enabled = !enCours,
                                colors = SwitchDefaults.colors(checkedTrackColor = p.primaire, checkedThumbColor = p.surPrimaire),
                            )
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                            Lien("Changer de numéro", p.primaire) {
                                numero = ""
                                saisie = true
                            }
                            // Un compte ouvert par numéro n'a que lui pour se connecter : remplaçable, pas retirable.
                            if (moi.connexion != "telephone") {
                                Lien("Retirer", p.danger) { executer({ conteneur.reseau.api.retirerTelephone() }) { saisie = true } }
                            }
                        }
                    }
                    EtapeTelephone.SAISIE -> {
                        Champ(numero, { numero = it; erreur = null }, "034 12 345 67", KeyboardType.Phone)
                        Text(
                            if (numero.isNotBlank() && normaliserTelephone(numero) == null) "Un mobile malgache : 032, 033, 034, 037, 038 ou 039."
                            else "Un code de vérification vous sera envoyé par SMS.",
                            color = p.texte3, fontSize = 13.sp,
                        )
                        Bouton("Recevoir le code", actif = normaliserTelephone(numero) != null, enCours = enCours) { demander(normaliserTelephone(numero)!!) }
                        if (moi.telephone != null) Lien("Garder le ${afficherTelephone(moi.telephone)}", p.texte2) { saisie = false }
                    }
                    EtapeTelephone.CODE -> {
                        val attente = moi.verificationTelephone
                        Text(
                            "Saisissez le code envoyé au ${afficherTelephone(attente?.numero.orEmpty())}. Il est valable 10 minutes.",
                            color = p.texte2, fontSize = 14.sp,
                        )
                        Champ(code, { code = it.filter(Char::isDigit).take(8); erreur = null }, "••••••", KeyboardType.NumberPassword, chiffres = true)
                        Bouton("Vérifier", actif = code.length >= 4, enCours = enCours) {
                            executer({ conteneur.reseau.api.verifierTelephone(CodeTelephone(code)) }) { saisie = false }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                            Lien(if (renvoi > 0) "Renvoyer ($renvoi s)" else "Renvoyer le code", if (renvoi > 0) p.texte3 else p.primaire, actif = renvoi == 0 && !enCours) {
                                attente?.let { demander(it.numero) }
                            }
                            Lien("Changer de numéro", p.texte2, actif = !enCours) {
                                executer({ conteneur.reseau.api.annulerVerificationTelephone() }) { saisie = true }
                            }
                        }
                    }
                }
            }
        }
        erreur?.let { Text(it, color = p.danger, fontSize = 14.sp, modifier = Modifier.padding(top = 10.dp)) }
    }
}

@Composable
private fun Champ(valeur: String, onValeur: (String) -> Unit, indication: String, clavier: KeyboardType, chiffres: Boolean = false) {
    val p = LocalPalette.current
    val style = TextStyle(
        color = p.texte,
        fontSize = if (chiffres) 22.sp else 16.sp,
        fontFamily = if (chiffres) FontFamily.Monospace else FontFamily.Default,
        letterSpacing = if (chiffres) 6.sp else 0.sp,
        textAlign = if (chiffres) TextAlign.Center else TextAlign.Start,
    )
    Box(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(12.dp)).background(p.fond)
            .border(1.dp, p.bordure, RoundedCornerShape(12.dp)).padding(horizontal = 14.dp, vertical = 12.dp),
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

@Composable
private fun Bouton(texte: String, actif: Boolean, enCours: Boolean, onClick: () -> Unit) {
    val p = LocalPalette.current
    Box(
        Modifier.fillMaxWidth().height(46.dp).clip(RoundedCornerShape(23.dp))
            .background(if (actif) p.primaire else p.primaire.copy(alpha = 0.4f))
            .clickable(enabled = actif && !enCours, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (enCours) CircularProgressIndicator(Modifier.size(18.dp), color = p.surPrimaire, strokeWidth = 2.dp)
        else Text(texte, color = p.surPrimaire, fontSize = 15.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun Lien(texte: String, couleur: Color, actif: Boolean = true, onClick: () -> Unit) {
    Text(
        texte, color = couleur, fontSize = 14.sp, fontWeight = FontWeight.Medium,
        modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable(enabled = actif, role = Role.Button, onClick = onClick).padding(vertical = 6.dp),
    )
}
