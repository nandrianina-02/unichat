package io.github.nandrianina02.unichat.donnees

import io.github.nandrianina02.unichat.chiffrement.RoleLiaison
import io.github.nandrianina02.unichat.chiffrement.assembler
import io.github.nandrianina02.unichat.chiffrement.cleCommune
import io.github.nandrianina02.unichat.chiffrement.dechiffrerOctets
import io.github.nandrianina02.unichat.chiffrement.depuisBase64
import io.github.nandrianina02.unichat.chiffrement.lireCode
import io.github.nandrianina02.unichat.chiffrement.ouvrirCleHistorique
import io.github.nandrianina02.unichat.chiffrement.ouvrirIdentite
import io.github.nandrianina02.unichat.chiffrement.paireEchange
import io.github.nandrianina02.unichat.chiffrement.preuveLiaison
import io.github.nandrianina02.unichat.chiffrement.versBase64
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.intOrNull
import java.io.ByteArrayInputStream
import java.util.zip.GZIPInputStream

/** Erreur expliquée à la personne. */
class ErreurLiaison(message: String) : Exception(message)

/** Fin d'une liaison : l'autre appareil, et l'historique rangé (null s'il n'a pas pu passer). */
class FinLiaison(val autre: String?, val historique: Int?)

private const val INTERVALLE = 1500L
/** Sans nouveau morceau pendant ce délai, l'autre appareil n'enverra plus rien. */
private const val ATTENTE_HISTORIQUE = 45_000L
/** Un code de liaison vaut cinq minutes (LIAISON.duree côté serveur). */
private const val DUREE_CODE = 5 * 60 * 1000L

/**
 * Relier ce téléphone à un appareil qui a déjà les clés du compte, porté
 * d'apps/web/src/lib/liaison.ts (lecture du code, rôle receveur). Le QR code
 * affiché par l'autre appareil ne passe que par l'écran ; le serveur relaie
 * sans pouvoir lire l'identité scellée.
 */
class LiaisonAppareil(private val api: UniChatApi, private val cles: ClesAppareil, private val base: Base) {

    private suspend fun attendre(canal: String, condition: (EtatLiaison) -> Boolean): EtatLiaison {
        val fin = System.currentTimeMillis() + DUREE_CODE
        while (true) {
            val etat = appel { api.liaison(canal) }.getOrThrow()
            if (condition(etat)) return etat
            if (System.currentTimeMillis() > fin) throw ErreurLiaison("Le code a expiré. Affichez-en un nouveau sur l'autre appareil.")
            delay(INTERVALLE)
        }
    }

    /** Le code lu (scanné ou collé) : réponse, identité reçue, inscription, puis l'historique. */
    suspend fun relier(texte: String, etape: (String) -> Unit): FinLiaison {
        val code = lireCode(texte) ?: throw ErreurLiaison("Ce n'est pas un code de liaison UniChat.")
        if (code.role == RoleLiaison.RECEVEUR) {
            throw ErreurLiaison("Ce code vient d'un appareil qui n'a pas non plus les clés. Lisez le code d'un appareil déjà relié.")
        }
        val paire = paireEchange()
        val cle = cleCommune(code, paire, code.cle)
        etape("Code lu. En attente des clés de l'autre appareil…")
        val premier = appel {
            api.repondreLiaison(code.canal, ReponseLiaison(versBase64(paire.publique), versBase64(preuveLiaison(code, paire.publique))))
        }.getOrThrow()
        val avecCles = if (premier.cles != null) premier else attendre(code.canal) { it.cles != null }
        etape("Clés reçues. Inscription de cet appareil…")
        val identite = try {
            ouvrirIdentite(cle, code.canal, depuisBase64(avecCles.cles!!))
        } catch (e: Exception) {
            throw ErreurLiaison("Ce code n'a pas pu être vérifié. Recommencez avec un nouveau code.")
        }
        // L'identité reçue doit être celle que l'annuaire publie pour ce compte.
        val publiee = appel { api.etatCles() }.getOrThrow().identite
        if (publiee == null || publiee.signature != versBase64(identite.signature.publique) || publiee.echange != versBase64(identite.echange.publique)) {
            throw ErreurLiaison("Les clés reçues ne sont pas celles de votre compte.")
        }
        cles.relier(code.canal, identite)
        // Les clés sont passées : un historique qui échoue ne défait pas la liaison.
        val historique = try {
            recevoirHistorique(code.canal, cle, etape)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        }
        return FinLiaison(avecCles.autre, historique)
    }

    /** Attend l'archive du donneur, la télécharge, l'ouvre et la range. Null si rien n'arrive. */
    private suspend fun recevoirHistorique(canal: String, cleLiaison: ByteArray, etape: (String) -> Unit): Int? {
        etape("Cet appareil est relié. En attente de l'historique de l'autre appareil…")
        var etat = appel { api.etatHistorique(canal) }.getOrThrow()
        var deposes = etat.deposes
        var progres = System.currentTimeMillis()
        while (etat.etat == "attente") {
            if (System.currentTimeMillis() - progres > ATTENTE_HISTORIQUE) return null
            delay(INTERVALLE)
            etat = appel { api.etatHistorique(canal) }.getOrThrow()
            if (etat.deposes != deposes) {
                deposes = etat.deposes
                progres = System.currentTimeMillis()
                etape("Cet appareil est relié. L'autre appareil envoie l'historique…")
            }
        }
        val morceaux = etat.morceaux ?: 0
        val cleScellee = etat.cle
        if (morceaux == 0 || cleScellee == null) return 0
        val parties = (0 until morceaux).map { i ->
            etape("Téléchargement de l'historique… ${i * 100 / morceaux} %")
            depuisBase64(appel { api.morceauHistorique(canal, i).string() }.getOrThrow())
        }
        val cleArchive = ouvrirCleHistorique(cleLiaison, canal, depuisBase64(cleScellee))
        val compresse = dechiffrerOctets(assembler(*parties.toTypedArray()), cleArchive)
        val texte = GZIPInputStream(ByteArrayInputStream(compresse)).use { String(it.readBytes(), Charsets.UTF_8) }
        val archive = Json.parseToJsonElement(texte).jsonObject
        if (archive["v"]?.jsonPrimitive?.intOrNull != 1) throw IllegalStateException("Historique illisible.")
        val messages = archive["messages"]?.jsonArray ?: JsonArray(emptyList())
        etape("Rangement de ${messages.size} messages…")
        importer(archive.getValue("messages").jsonArray, archive["personnes"]?.jsonArray, archive["groupes"]?.jsonArray, archive["conversations"]?.jsonArray)
        appel { api.supprimerHistorique(canal) }
        return messages.size
    }

    /**
     * Range l'historique reçu. Un message déjà lisible ici (déchiffré depuis
     * la liaison) est gardé tel quel ; une place « illisible » est remplacée
     * par le message lui-même. Personnes et groupes complètent ce qui manque.
     */
    private fun importer(messages: JsonArray, personnes: JsonArray?, groupes: JsonArray?, conversations: JsonArray?) {
        base.transaction {
            for (e in messages) {
                val m = e.jsonObject
                val local = base.message(m.texte("id"))
                if (local != null && !local.vrai("indechiffrable")) continue
                base.ecrireMessage(m)
            }
            personnes?.forEach { p -> if (base.personne(p.jsonObject.texte("id")) == null) base.ecrirePersonne(p.jsonObject) }
            groupes?.forEach { g -> if (base.groupe(g.jsonObject.texte("id")) == null) base.ecrireGroupe(g.jsonObject) }
            conversations?.forEach { c -> base.ecrireConversation(c.jsonObject) }
        }
        base.signaler()
    }
}
