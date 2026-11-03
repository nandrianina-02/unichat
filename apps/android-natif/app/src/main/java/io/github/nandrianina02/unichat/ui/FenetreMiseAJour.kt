package io.github.nandrianina02.unichat.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.LifecycleResumeEffect
import io.github.nandrianina02.unichat.BuildConfig
import io.github.nandrianina02.unichat.donnees.MiseAJour
import io.github.nandrianina02.unichat.donnees.VersionDisponible
import io.github.nandrianina02.unichat.donnees.tailleTexte
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.io.File

/** Où en est la mise à jour proposée. */
private sealed interface Etape {
    val v: VersionDisponible
    data class Proposee(override val v: VersionDisponible) : Etape
    data class Telechargement(override val v: VersionDisponible, val part: Float?) : Etape
    data class Prete(override val v: VersionDisponible, val apk: File) : Etape
    data class Erreur(override val v: VersionDisponible, val message: String) : Etape
}

/**
 * La mise à jour, de la proposition à l'installateur d'Android : au
 * lancement (une fois par version), ou à la demande (`demandee`, depuis le
 * compte ou la notification). L'appli télécharge elle-même l'APK ; en cas
 * d'échec, le navigateur reste un recours.
 */
@Composable
fun FenetreMiseAJour(miseAJour: MiseAJour, demandee: Boolean, onTraitee: () -> Unit) {
    val p = LocalPalette.current
    val contexte = LocalContext.current
    val portee = rememberCoroutineScope()
    var etape by remember { mutableStateOf<Etape?>(null) }
    var aJour by remember { mutableStateOf(false) }
    var travail by remember { mutableStateOf<Job?>(null) }
    // Revenu des réglages (autorisation d'installer) : la fenêtre se met à jour d'elle-même.
    var autorisee by remember { mutableStateOf(miseAJour.peutInstaller()) }
    LifecycleResumeEffect(Unit) {
        autorisee = miseAJour.peutInstaller()
        onPauseOrDispose { }
    }

    LaunchedEffect(Unit) { etape = miseAJour.disponible()?.let { Etape.Proposee(it) } }
    LaunchedEffect(demandee) {
        if (!demandee) return@LaunchedEffect
        onTraitee()
        val v = miseAJour.disponible(demandee = true)
        if (v == null) aJour = true else if (etape !is Etape.Telechargement && etape !is Etape.Prete) etape = Etape.Proposee(v)
    }

    fun telecharger(v: VersionDisponible) {
        etape = Etape.Telechargement(v, 0f)
        travail = portee.launch {
            etape = try {
                val apk = miseAJour.telecharger(v) { part -> etape = Etape.Telechargement(v, part) }
                Etape.Prete(v, apk)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Etape.Erreur(v, "Le téléchargement n'a pas abouti. Vérifiez votre connexion, ou téléchargez la version depuis le navigateur.")
            }
        }
    }

    fun ouvrirDansLeNavigateur(v: VersionDisponible) {
        runCatching { contexte.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(v.adresse)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }

    if (aJour) {
        AlertDialog(
            onDismissRequest = { aJour = false },
            containerColor = p.panneau,
            title = { Text("UniChat est à jour", color = p.texte) },
            text = { Text("Vous avez la dernière version (${BuildConfig.VERSION_NAME}).", color = p.texte2) },
            confirmButton = { TextButton(onClick = { aJour = false }) { Text("Fermer", color = p.primaire) } },
        )
    }

    val e = etape ?: return
    AlertDialog(
        // Pendant le téléchargement, toucher à côté ne ferme pas la fenêtre : il faut « Annuler ».
        onDismissRequest = { if (e !is Etape.Telechargement) etape = null },
        containerColor = p.panneau,
        title = { Text("Nouvelle version d'UniChat", color = p.texte) },
        text = {
            AnimatedContent(e::class, transitionSpec = { fadeIn(tween(200)) togetherWith fadeOut(tween(120)) }, label = "etape") { _ ->
                Column {
                    when (e) {
                        is Etape.Proposee -> Text(
                            "La version ${e.v.version}${tailleTexte(e.v)} est disponible. Elle s'installe par-dessus celle-ci : vos discussions et vos clés sont gardées.",
                            color = p.texte2, fontSize = 15.sp, lineHeight = 21.sp,
                        )
                        is Etape.Telechargement -> {
                            Text("Téléchargement de la version ${e.v.version}…", color = p.texte2, fontSize = 15.sp)
                            Spacer(Modifier.height(16.dp))
                            val part = e.part
                            if (part == null) {
                                LinearProgressIndicator(Modifier.fillMaxWidth(), color = p.primaire, trackColor = p.primaireDoux)
                            } else {
                                val anime by animateFloatAsState(part, tween(150), label = "progression")
                                LinearProgressIndicator({ anime }, Modifier.fillMaxWidth(), color = p.primaire, trackColor = p.primaireDoux)
                                Spacer(Modifier.height(6.dp))
                                Text("${(part * 100).toInt()} %", color = p.texte3, fontSize = 13.sp)
                            }
                        }
                        is Etape.Prete -> Text(
                            if (autorisee) "La version ${e.v.version} est téléchargée. Android va vous demander de confirmer l'installation."
                            else "La version ${e.v.version} est téléchargée. Android demande d'abord d'autoriser UniChat à installer des applications : activez l'option, puis revenez ici.",
                            color = p.texte2, fontSize = 15.sp, lineHeight = 21.sp,
                        )
                        is Etape.Erreur -> Text(e.message, color = p.danger, fontSize = 15.sp, lineHeight = 21.sp)
                    }
                }
            }
        },
        confirmButton = {
            when (e) {
                is Etape.Proposee -> TextButton(onClick = { telecharger(e.v) }) { Text("Mettre à jour", color = p.primaire, fontWeight = FontWeight.Medium) }
                is Etape.Telechargement -> Unit
                is Etape.Prete -> TextButton(onClick = {
                    runCatching {
                        contexte.startActivity(if (autorisee) miseAJour.intentionInstallation(e.apk) else miseAJour.intentionAutorisation())
                    }.onFailure { etape = Etape.Erreur(e.v, "L'installateur d'Android n'a pas pu s'ouvrir.") }
                }) { Text(if (autorisee) "Installer" else "Autoriser", color = p.primaire, fontWeight = FontWeight.Medium) }
                is Etape.Erreur -> TextButton(onClick = { telecharger(e.v) }) { Text("Réessayer", color = p.primaire, fontWeight = FontWeight.Medium) }
            }
        },
        dismissButton = {
            when (e) {
                is Etape.Proposee -> TextButton(onClick = {
                    miseAJour.ignorer(e.v.version)
                    etape = null
                }) { Text("Plus tard", color = p.texte2) }
                is Etape.Telechargement -> TextButton(onClick = {
                    travail?.cancel()
                    etape = Etape.Proposee(e.v)
                }) { Text("Annuler", color = p.texte2) }
                is Etape.Erreur -> TextButton(onClick = { ouvrirDansLeNavigateur(e.v) }) { Text("Navigateur", color = p.texte2) }
                is Etape.Prete -> TextButton(onClick = { etape = null }) { Text("Plus tard", color = p.texte2) }
            }
        },
    )
}
