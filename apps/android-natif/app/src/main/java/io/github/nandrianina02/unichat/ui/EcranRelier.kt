package io.github.nandrianina02.unichat.ui

import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import io.github.nandrianina02.unichat.R
import io.github.nandrianina02.unichat.donnees.ErreurLiaison
import io.github.nandrianina02.unichat.donnees.EspaceCompte
import io.github.nandrianina02.unichat.donnees.messageErreur
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * Relier ce téléphone au compte. L'identité du compte vit sur les appareils
 * déjà reliés ; l'un d'eux affiche un code que le téléphone lit (le lecteur
 * de Google Play, sans autorisation de caméra pour l'appli) ou que l'on
 * colle. Les messages passés arrivent ensuite par l'historique transmis.
 */
@Composable
fun EcranRelier(espace: EspaceCompte, onCompte: () -> Unit, onRelie: () -> Unit) {
    val p = LocalPalette.current
    val contexte = LocalContext.current
    val portee = rememberCoroutineScope()
    var enCours by remember { mutableStateOf(false) }
    var etape by remember { mutableStateOf<String?>(null) }
    var erreur by remember { mutableStateOf<String?>(null) }
    var fin by remember { mutableStateOf<String?>(null) }

    fun relier(texte: String?) {
        if (texte.isNullOrBlank() || enCours) return
        enCours = true
        erreur = null
        portee.launch {
            try {
                val r = espace.liaison.relier(texte) { etape = it }
                fin = when (val n = r.historique) {
                    null -> "Téléphone relié. L'historique n'a pas pu être transmis : les nouveaux messages arriveront normalement."
                    0 -> "Téléphone relié."
                    else -> "Téléphone relié. $n messages transmis depuis ${r.autre ?: "l'autre appareil"}."
                }
                onRelie()
            } catch (e: CancellationException) {
                throw e
            } catch (e: ErreurLiaison) {
                erreur = e.message
            } catch (e: Exception) {
                erreur = messageErreur(e)
            } finally {
                enCours = false
                etape = null
            }
        }
    }

    Column(Modifier.fillMaxSize().background(p.fond).safeDrawingPadding().padding(horizontal = 24.dp, vertical = 16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("UniChat", color = p.texte, fontSize = 24.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            Icon(
                painterResource(R.drawable.lucide_settings), contentDescription = "Compte", tint = p.texte2,
                modifier = Modifier.size(40.dp).clip(RoundedCornerShape(20.dp)).clickable(role = Role.Button, onClick = onCompte).padding(9.dp),
            )
        }
        Spacer(Modifier.height(40.dp))
        Icon(painterResource(R.drawable.lucide_qr_code), contentDescription = null, tint = p.primaire, modifier = Modifier.size(40.dp))
        Spacer(Modifier.height(16.dp))
        Text("Relier ce téléphone", color = p.texte, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(8.dp))
        Text(
            "Vos clés de chiffrement sont sur vos appareils déjà reliés. Sur l'un d'eux, ouvrez Paramètres, Compte, Appareils connectés, puis « Relier un appareil » et « Afficher un code ». Scannez ensuite ce code avec ce téléphone.",
            color = p.texte2, fontSize = 15.sp, lineHeight = 22.sp,
        )
        Spacer(Modifier.height(28.dp))

        if (enCours) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(20.dp), color = p.primaire, strokeWidth = 2.dp)
                Spacer(Modifier.width(12.dp))
                Text(etape ?: "Lecture du code…", color = p.texte2, fontSize = 14.sp, lineHeight = 20.sp)
            }
        } else {
            Bouton(R.drawable.lucide_qr_code, "Scanner le code", principal = true) {
                portee.launch { relier(scanner(contexte)) }
            }
            Spacer(Modifier.height(10.dp))
            Bouton(R.drawable.lucide_clipboard_paste, "Coller le code") {
                val presse = contexte.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                val texte = presse.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(contexte)?.toString()
                if (texte.isNullOrBlank()) erreur = "Copiez d'abord le code affiché sur l'autre appareil." else relier(texte)
            }
        }
        erreur?.let { Text(it, color = p.danger, fontSize = 14.sp, lineHeight = 20.sp, modifier = Modifier.padding(top = 16.dp)) }
        fin?.let { Text(it, color = p.texte2, fontSize = 14.sp, lineHeight = 20.sp, modifier = Modifier.padding(top = 16.dp)) }
    }
}

@Composable
private fun Bouton(icone: Int, texte: String, principal: Boolean = false, onClick: () -> Unit) {
    val p = LocalPalette.current
    val forme = RoundedCornerShape(12.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .height(50.dp)
            .clip(forme)
            .then(if (principal) Modifier.background(p.primaire) else Modifier.border(1.dp, p.bordure, forme))
            .clickable(role = Role.Button, onClick = onClick),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val couleur = if (principal) p.surPrimaire else p.texte
        Icon(painterResource(icone), contentDescription = null, tint = couleur, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(10.dp))
        Text(texte, color = couleur, fontSize = 16.sp, fontWeight = FontWeight.Medium)
    }
}

/** Le lecteur de QR code de Google Play : null si la personne l'a fermé. */
private suspend fun scanner(contexte: Context): String? = suspendCancellableCoroutine { suite ->
    val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
    GmsBarcodeScanning.getClient(contexte, options).startScan()
        .addOnSuccessListener { suite.resume(it.rawValue) }
        .addOnCanceledListener { suite.resume(null) }
        .addOnFailureListener { suite.resume(null) }
}
