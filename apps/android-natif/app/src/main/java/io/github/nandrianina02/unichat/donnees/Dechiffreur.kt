package io.github.nandrianina02.unichat.donnees

import io.github.nandrianina02.unichat.chiffrement.ClesLocales
import io.github.nandrianina02.unichat.chiffrement.correspondantJson
import io.github.nandrianina02.unichat.chiffrement.correspondantLu
import io.github.nandrianina02.unichat.chiffrement.cleUniqueLue
import io.github.nandrianina02.unichat.chiffrement.dechiffrer
import io.github.nandrianina02.unichat.chiffrement.depuisBase64
import io.github.nandrianina02.unichat.chiffrement.exigencesOuverture
import io.github.nandrianina02.unichat.chiffrement.octetsVersTexte
import io.github.nandrianina02.unichat.chiffrement.ouvrir
import io.github.nandrianina02.unichat.chiffrement.texteVersOctets
import io.github.nandrianina02.unichat.chiffrement.tranche
import io.github.nandrianina02.unichat.chiffrement.versBase64
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject

/** Ce qu'une enveloppe donne sur cet appareil. */
sealed interface Dechiffrement {
    class Message(val contenu: JsonObject) : Dechiffrement
    class Action(val contenu: JsonObject) : Dechiffrement
    /** Pas de clé pour cet appareil (relié après l'envoi), ou session rompue. */
    data object Illisible : Dechiffrement
    /** Envoyée par cet appareil même : il a déjà le contenu. */
    data object Ignore : Dechiffrement
}

/** Données associées du contenu scellé (associeContenu, packages/shared) : il ne se déplace ni vers un autre message, ni vers un autre auteur. */
fun associeContenu(id: String, conversation: String, de: String) = "UniChat-contenu-v1|$id|$conversation|$de"

private val ACTIONS = setOf("reaction", "suppression", "modification", "epingle", "vote", "ephemere", "ouvert")

/**
 * Ouvre les enveloppes chiffrées, porté de Chiffreur.dechiffrerUne
 * (apps/web/src/lib/chiffrement.ts). La clé du contenu arrive par la
 * session Double Ratchet de l'appareil expéditeur ; la session avancée est
 * rangée aussitôt, quoi qu'il advienne du contenu.
 */
class Dechiffreur(private val cles: ClesAppareil, private val trousseau: Rangement, private val moi: String) {

    /** À appeler sous le verrou des clés. */
    fun dechiffrer(e: JsonObject): Dechiffrement {
        val identite = cles.identite() ?: return Dechiffrement.Illisible
        val numero = cles.appareil()?.numero ?: return Dechiffrement.Illisible
        val de = e.texte("de")
        val deAppareil = e.entier("deAppareil") ?: return Dechiffrement.Illisible
        if (de == moi && deAppareil == numero.toLong()) return Dechiffrement.Ignore

        val brut = e.objet("cles")?.texteOuNul(numero.toString()) ?: return Dechiffrement.Illisible
        val message = runCatching { depuisBase64(brut) }.getOrElse { return Dechiffrement.Illisible }
        val exigences = exigencesOuverture(message)
        val unique = exigences?.second?.takeIf { it != 0L }?.let { id -> trousseau.lire("unique:$id")?.jsonObject?.let(::cleUniqueLue) }
        val cleSession = "correspondant:$de:$deAppareil"
        val correspondant = trousseau.lire(cleSession)?.jsonObject?.let(::correspondantLu)
        val signees = cles.signees()

        val resultat = runCatching {
            dechiffrer(correspondant, message, ClesLocales(identite, { id -> signees.find { it.id == id } }, { id -> unique?.takeIf { it.id == id } }))
        }.getOrElse { return Dechiffrement.Illisible }
        trousseau.ecrire(cleSession, correspondantJson(resultat.correspondant))
        if (resultat.cleUniqueUtilisee != 0L) trousseau.effacer("unique:${resultat.cleUniqueUtilisee}")
        if (resultat.nouvelleSession) {
            // Identité du correspondant retenue au premier contact (lot 7 du web : son changement se signale).
            trousseau.ecrire("identite:$de", JsonPrimitive("${versBase64(resultat.identite.signature)}.${versBase64(resultat.identite.echange)}"))
        }

        val id = e.texte("id")
        val clair = resultat.clair
        if (clair.size < 33 || runCatching { octetsVersTexte(clair.tranche(32)) }.getOrNull() != id) return Dechiffrement.Illisible
        return runCatching {
            val ouvert = ouvrir(clair.tranche(0, 32), depuisBase64(e.texte("corps")), texteVersOctets(associeContenu(id, e.texte("conversation"), de)))
            val contenu = Json.parseToJsonElement(octetsVersTexte(ouvert)).jsonObject
            if (contenu.entier("v") != 1L) return Dechiffrement.Illisible
            if (e.texte("genre") == "message") {
                if (contenu["texte"] !is JsonPrimitive) Dechiffrement.Illisible else Dechiffrement.Message(contenu)
            } else {
                if (contenu.texte("action") !in ACTIONS) Dechiffrement.Illisible else Dechiffrement.Action(contenu)
            }
        }.getOrElse { Dechiffrement.Illisible }
    }
}
