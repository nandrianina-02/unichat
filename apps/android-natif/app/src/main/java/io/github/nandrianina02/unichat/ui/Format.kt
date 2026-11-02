package io.github.nandrianina02.unichat.ui

import io.github.nandrianina02.unichat.donnees.entier
import io.github.nandrianina02.unichat.donnees.objet
import io.github.nandrianina02.unichat.donnees.texte
import io.github.nandrianina02.unichat.donnees.texteOuNul
import io.github.nandrianina02.unichat.donnees.vrai
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/*
 * Textes repris d'apps/web/src/lib/format.ts, mot pour mot : le téléphone
 * et l'ordinateur disent la même chose.
 */

private val FR = Locale.FRANCE

private fun debutJour(t: Long): Long = Calendar.getInstance().apply {
    timeInMillis = t
    set(Calendar.HOUR_OF_DAY, 0)
    set(Calendar.MINUTE, 0)
    set(Calendar.SECOND, 0)
    set(Calendar.MILLISECOND, 0)
}.timeInMillis

private fun ecartJours(le: Long, maintenant: Long) = Math.round((debutJour(maintenant) - debutJour(le)) / 86_400_000.0).toInt()

fun heureCourte(le: Long): String = SimpleDateFormat("HH:mm", FR).format(Date(le))

/** Heure affichée dans la liste des discussions : « 14:05 », « Hier », « lundi », « 03/03/2026 ». */
fun dateListe(le: Long, maintenant: Long = System.currentTimeMillis()): String {
    val ecart = ecartJours(le, maintenant)
    return when {
        ecart == 0 -> heureCourte(le)
        ecart == 1 -> "Hier"
        ecart < 7 -> SimpleDateFormat("EEEE", FR).format(Date(le))
        else -> SimpleDateFormat("dd/MM/yyyy", FR).format(Date(le))
    }
}

/** Séparateur de jour dans une discussion : « Aujourd'hui », « Hier », « Lundi », « 3 mars 2026 ». */
fun jourMessage(le: Long, maintenant: Long = System.currentTimeMillis()): String {
    val ecart = ecartJours(le, maintenant)
    return when {
        ecart == 0 -> "Aujourd'hui"
        ecart == 1 -> "Hier"
        ecart < 7 -> SimpleDateFormat("EEEE", FR).format(Date(le)).replaceFirstChar { it.uppercase() }
        else -> SimpleDateFormat("d MMMM yyyy", FR).format(Date(le))
    }
}

fun enumeration(noms: List<String>): String = if (noms.size <= 1) noms.firstOrNull() ?: "" else "${noms.dropLast(1).joinToString(", ")} et ${noms.last()}"

/** Ligne système d'un groupe : « Ana a ajouté Bob et Lova ». `nom` donne « Vous » pour soi. */
fun texteEvenement(ev: JsonObject, nom: (String) -> String): String {
    val qui = nom(ev.texte("par"))
    val noms = (ev["cibles"]?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList()).map(nom)
    // « Ana vous a ajouté », « Ana a ajouté Bob et vous » : le pronom suit la grammaire.
    val seulementMoi = noms.size == 1 && noms[0] == "Vous"
    val cibles = enumeration(noms.map { if (it == "Vous") "vous" else it })
    val a = if (qui == "Vous") "avez" else "a"
    fun verbe(participe: String) = if (seulementMoi) "$qui vous a $participe" else "$qui $a $participe $cibles"
    val nomGroupe = ev.texteOuNul("nom") ?: ""
    return when (ev.texte("action")) {
        "creation" -> "$qui $a créé le groupe « $nomGroupe »"
        "ajout" -> verbe("ajouté")
        "retrait" -> verbe("retiré")
        "depart" -> "$qui ${if (qui == "Vous") "êtes parti du groupe" else "est parti du groupe"}"
        "renommage" -> "$qui $a renommé le groupe en « $nomGroupe »"
        "description" -> "$qui $a modifié la description du groupe"
        "photo" -> "$qui $a changé la photo du groupe"
        "fermeture" -> "Ce groupe a été fermé par la modération d'UniChat"
        "lien" -> "$qui $a rejoint le groupe avec le lien d'invitation"
        else -> "Le groupe a changé"
    }
}

/** Nom d'un fichier joint quand il n'a pas de légende : « Photo », « Message vocal », ou le nom du document. */
fun libelleMedia(media: JsonObject): String = when (media.texte("type")) {
    "image" -> if (media.vrai("vueUnique")) "Photo à vue unique" else "Photo"
    "video" -> if (media.vrai("vueUnique")) "Vidéo à vue unique" else "Vidéo"
    "audio" -> if (media.vrai("vocal")) "Message vocal" else "Audio"
    else -> media.texte("nom")
}

/** Texte qui résume un message ailleurs que dans sa bulle : citation, liste. */
fun resumeMessage(m: JsonObject): String {
    m.texte("texte").takeIf { it.isNotEmpty() }?.let { return it }
    if (m.vrai("indechiffrable")) return "Message illisible sur cet appareil"
    m.objet("media")?.let { return libelleMedia(it) }
    if (m.objet("position") != null) return "Position"
    m.objet("contact")?.let { return "Contact : ${it.texte("nom")}" }
    m.objet("sondage")?.let { return "Sondage : ${it.texte("question")}" }
    return ""
}

/** « 24 heures », « 7 jours », « 90 jours ». */
fun dureeEphemere(ms: Long): String {
    val jours = Math.round(ms / 86_400_000.0)
    return if (jours <= 1) "24 heures" else "$jours jours"
}

/** Ligne système des messages éphémères. */
fun texteEphemere(par: String, duree: Long?): String {
    val qui = if (par == "Vous") "Vous avez" else "$par a"
    return if (duree != null && duree > 0) {
        "$qui activé les messages éphémères. Les nouveaux messages disparaîtront ${dureeEphemere(duree)} après leur envoi."
    } else {
        "$qui désactivé les messages éphémères."
    }
}

/** Le texte d'une ligne de la liste ou d'une bulle système, sans la mise en forme. */
fun texteLigne(m: JsonObject, moi: String, nom: (String) -> String): String = when {
    m.texte("type") == "evenement" -> m.objet("evenement")?.let { texteEvenement(it, nom) } ?: ""
    m.texte("type") == "systeme" -> texteEphemere(nom(m.texte("de")), m.objet("systeme")?.entier("duree"))
    m.vrai("supprime") -> if (m.texte("de") == moi) "Vous avez supprimé ce message" else "Ce message a été supprimé"
    else -> resumeMessage(m)
}
