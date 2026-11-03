package io.github.nandrianina02.unichat.donnees

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import io.github.nandrianina02.unichat.MainActivity
import io.github.nandrianina02.unichat.R
import io.github.nandrianina02.unichat.UniChatApp
import java.util.Locale
import java.util.concurrent.TimeUnit

private const val CANAL = "unichat_mises_a_jour"
private const val TRAVAIL = "verification-mise-a-jour"
private const val NOTIFICATION = 4_201

/** Extra de l'intention qui ouvre l'appli sur la fenêtre de mise à jour. */
const val EXTRA_MISE_A_JOUR = "mise-a-jour"

/**
 * Prévenir d'une nouvelle version même quand l'appli reste fermée : deux
 * fois par jour, réseau disponible, la même recherche qu'au démarrage. Une
 * version n'est annoncée qu'une fois, et pas du tout si on l'a écartée.
 */
class VerificationMiseAJour(contexte: Context, parametres: WorkerParameters) : CoroutineWorker(contexte, parametres) {
    override suspend fun doWork(): Result {
        val miseAJour = (applicationContext as UniChatApp).conteneur.miseAJour
        val version = runCatching { miseAJour.disponible() }.getOrNull() ?: return Result.success()
        if (miseAJour.dejaAnnoncee(version.version)) return Result.success()
        if (annoncer(applicationContext, version)) miseAJour.annoncee(version.version)
        return Result.success()
    }

    companion object {
        /** Programmé à chaque lancement ; KEEP garde la cadence déjà en place. */
        fun programmer(contexte: Context) {
            val requete = PeriodicWorkRequestBuilder<VerificationMiseAJour>(12, TimeUnit.HOURS)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(contexte).enqueueUniquePeriodicWork(TRAVAIL, ExistingPeriodicWorkPolicy.KEEP, requete)
        }
    }
}

/** Faux si Android refuse les notifications (Android 13 sans autorisation) : on retentera plus tard. */
private fun annoncer(contexte: Context, v: VersionDisponible): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        ContextCompat.checkSelfPermission(contexte, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
        return false
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val gestion = contexte.getSystemService(NotificationManager::class.java)
        if (gestion?.getNotificationChannel(CANAL) == null) {
            gestion?.createNotificationChannel(NotificationChannel(CANAL, "Mises à jour", NotificationManager.IMPORTANCE_DEFAULT))
        }
    }
    val ouvrir = PendingIntent.getActivity(
        contexte,
        NOTIFICATION,
        Intent(contexte, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra(EXTRA_MISE_A_JOUR, true),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val texte = "La version ${v.version}${tailleTexte(v)} est prête. Elle s'installe par-dessus l'actuelle : vos discussions et vos clés sont gardées."
    val avis = NotificationCompat.Builder(contexte, CANAL)
        .setSmallIcon(R.drawable.lucide_message_circle)
        .setContentTitle("Nouvelle version d'UniChat")
        .setContentText(texte)
        .setStyle(NotificationCompat.BigTextStyle().bigText(texte))
        .setContentIntent(ouvrir)
        .setAutoCancel(true)
        .build()
    NotificationManagerCompat.from(contexte).notify(NOTIFICATION, avis)
    return true
}

/** « (11,3 Mo) », ou rien quand la taille est inconnue. */
fun tailleTexte(v: VersionDisponible): String = v.tailleMo?.let { " (" + String.format(Locale.FRANCE, "%.1f", it) + " Mo)" }.orEmpty()
