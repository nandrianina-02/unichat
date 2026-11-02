package io.github.nandrianina02.unichat.donnees

import io.github.nandrianina02.unichat.chiffrement.CleSigneePublique
import io.github.nandrianina02.unichat.chiffrement.CleUniquePublique
import io.github.nandrianina02.unichat.chiffrement.Correspondant
import io.github.nandrianina02.unichat.chiffrement.IdentitePublique
import io.github.nandrianina02.unichat.chiffrement.Paquet
import io.github.nandrianina02.unichat.chiffrement.aleatoire
import io.github.nandrianina02.unichat.chiffrement.assembler
import io.github.nandrianina02.unichat.chiffrement.correspondantJson
import io.github.nandrianina02.unichat.chiffrement.correspondantLu
import io.github.nandrianina02.unichat.chiffrement.depuisBase64
import io.github.nandrianina02.unichat.chiffrement.memeIdentite
import io.github.nandrianina02.unichat.chiffrement.sceller
import io.github.nandrianina02.unichat.chiffrement.texteVersOctets
import io.github.nandrianina02.unichat.chiffrement.verifierIdentite
import io.github.nandrianina02.unichat.chiffrement.verifierPaquet
import io.github.nandrianina02.unichat.chiffrement.versBase64
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.util.concurrent.ConcurrentHashMap
import io.github.nandrianina02.unichat.chiffrement.chiffrer as chiffrerPour

/** Pourquoi un message ne peut pas partir : rien ne part jamais en clair. */
class ErreurChiffrement(val raison: String, message: String) : Exception(message)

/** À qui chiffrer : une personne (a) ou un groupe, et les comptes visés. */
class Destination(
    val conversation: String,
    val a: String? = null,
    val groupe: String? = null,
    val comptes: List<String>,
    val mentions: List<String> = emptyList(),
)

/** Durée pendant laquelle la liste des appareils d'un compte est tenue pour juste. */
private const val FRAICHEUR = 5 * 60 * 1000L
/** Comptes par demande à l'annuaire des clés (PAQUETS_MAX, packages/shared). */
private const val PAQUETS_MAX = 50

private fun cleCorrespondant(compte: String, numero: Int) = "correspondant:$compte:$numero"

private fun publique(i: IdentiteCles) = IdentitePublique(depuisBase64(i.signature), depuisBase64(i.echange), depuisBase64(i.preuve))

/**
 * Chiffre les envois, porté de Chiffreur.chiffrer (apps/web/src/lib/chiffrement.ts).
 * Le contenu est scellé une fois sous une clé tirée au hasard ; cette clé
 * part vers chaque appareil visé (ceux du correspondant, et mes autres
 * appareils) par sa session Double Ratchet, ouverte par X3DH au besoin.
 */
class Chiffreur(
    private val api: UniChatApi,
    private val cles: ClesAppareil,
    private val trousseau: Rangement,
    private val moi: String,
    private val horloge: () -> Long = System::currentTimeMillis,
) {
    private class Fiche(val identite: IdentiteCles?, val appareils: List<Int>, val le: Long)

    // Lu sous le verrou des clés, mais vidé depuis le traitement des refus.
    private val annuaire = ConcurrentHashMap<String, Fiche>()

    /** Le serveur a refusé une liste d'appareils : on la relira avant de rechiffrer. */
    fun oublier(comptes: Collection<String>) = comptes.forEach { annuaire.remove(it) }

    private suspend fun fiches(comptes: List<String>): Map<String, Fiche> {
        val maintenant = horloge()
        val aLire = comptes.filter { (annuaire[it]?.le ?: 0) < maintenant - FRAICHEUR }
        for (lot in aLire.chunked(PAQUETS_MAX)) {
            val lus = appel { api.appareilsCles(DemandeAppareils(lot)) }.getOrThrow().comptes
            for (id in lot) {
                val lu = lus.find { it.id == id }
                annuaire[id] = Fiche(lu?.identite, lu?.appareils ?: emptyList(), maintenant)
                // Un changement d'identité se retient dès que l'annuaire le montre.
                if (lu != null && id != moi) {
                    val identite = publique(lu.identite)
                    if (verifierIdentite(identite)) epingler(id, identite)
                }
            }
        }
        return comptes.associateWith { annuaire.getValue(it) }
    }

    /**
     * Identité d'un correspondant, retenue au premier contact. Si elle
     * change, la nouvelle est retenue et une vérification du code de
     * sécurité tombe : elle portait sur l'ancienne.
     */
    private fun epingler(compte: String, identite: IdentitePublique) {
        val empreinte = "${versBase64(identite.signature)}.${versBase64(identite.echange)}"
        val connue = trousseau.lire("identite:$compte")?.jsonPrimitive?.content
        if (connue == empreinte) return
        trousseau.ecrire("identite:$compte", JsonPrimitive(empreinte))
        if (connue != null) trousseau.effacer("verifie:$compte")
    }

    /**
     * La trame « chiffre » prête à partir. Sans clés sur cet appareil, ou
     * vers une personne qui n'en a aucune, une ErreurChiffrement. Dans un
     * groupe, un membre sans clés ne reçoit simplement pas la clé du contenu.
     *
     * À appeler sous le verrou des clés : chaque session avancée est rangée
     * avant le départ, une clé de message ne doit jamais servir deux fois.
     */
    suspend fun chiffrer(d: Destination, id: String, genre: String, contenu: JsonObject): JsonObject {
        val identite = cles.identite()
        val numero = cles.appareil()?.numero
        if (identite == null || numero == null) {
            throw ErreurChiffrement("appareil", "Cet appareil n'a pas encore les clés de votre compte : reliez-le pour écrire.")
        }
        val comptes = (d.comptes.filter { it != moi } + moi).distinct()
        val fiches = fiches(comptes)
        if (d.groupe == null && comptes.any { it != moi && fiches[it]?.identite == null }) {
            throw ErreurChiffrement("sans-cles", "Cette personne n'a pas encore de clés de chiffrement.")
        }

        class Cible(val compte: String, val numero: Int, val correspondant: Correspondant?) {
            val sansSession get() = correspondant?.sessions?.firstOrNull()?.ratchet?.cks == null
        }
        val cibles = buildList {
            for (compte in comptes) {
                for (n in fiches.getValue(compte).appareils) {
                    if (compte == moi && n == numero) continue
                    add(Cible(compte, n, trousseau.lire(cleCorrespondant(compte, n))?.jsonObject?.let(::correspondantLu)))
                }
            }
        }

        val paquets = HashMap<String, Paquet>()
        val sansSession = cibles.filter { it.sansSession }
        if (sansSession.isNotEmpty()) {
            val demande = comptes
                .map { c -> DemandePaquet(c, sansSession.filter { it.compte == c }.map { it.numero }) }
                .filter { it.appareils.isNotEmpty() }
            val mienne = identite.publique()
            for (lot in demande.chunked(PAQUETS_MAX)) {
                for (compte in appel { api.paquets(DemandePaquets(lot)) }.getOrThrow().comptes) {
                    val idCompte = publique(compte.identite)
                    for (a in compte.appareils) {
                        val paquet = Paquet(
                            idCompte,
                            CleSigneePublique(a.cleSignee.id, depuisBase64(a.cleSignee.cle), depuisBase64(a.cleSignee.signature)),
                            a.cleUnique?.let { CleUniquePublique(it.id, depuisBase64(it.cle)) },
                        )
                        // Un paquet mal signé, ou d'une autre identité que la mienne pour mes appareils, est écarté.
                        if (!verifierPaquet(paquet)) continue
                        if (compte.id == moi && !memeIdentite(paquet.identite, mienne)) continue
                        paquets["${compte.id}:${a.numero}"] = paquet
                    }
                    paquets["${compte.id}:${compte.appareils.firstOrNull()?.numero}"]?.let { epingler(compte.id, it.identite) }
                }
            }
        }

        val cle = aleatoire(32)
        val corps = sceller(cle, texteVersOctets(contenu.toString()), texteVersOctets(associeContenu(id, d.conversation, moi)))
        val charge = assembler(cle, texteVersOctets(id))
        val parCompte = comptes.associateWith { LinkedHashMap<String, JsonElement>() }
        for (x in cibles) {
            val paquet = paquets["${x.compte}:${x.numero}"]
            // Appareil disparu entre-temps : le serveur renverra la bonne liste.
            if (x.sansSession && paquet == null) continue
            val r = chiffrerPour(x.correspondant, identite, charge, paquet)
            trousseau.ecrire(cleCorrespondant(x.compte, x.numero), correspondantJson(r.correspondant))
            parCompte.getValue(x.compte)[x.numero.toString()] = JsonPrimitive(versBase64(r.message))
        }
        return buildJsonObject {
            put("t", "chiffre")
            put("id", id)
            if (d.groupe != null) put("groupe", d.groupe) else put("a", d.a ?: moi)
            if (d.groupe != null && d.mentions.isNotEmpty()) put("mentions", JsonArray(d.mentions.map(::JsonPrimitive)))
            put("genre", genre)
            put("corps", versBase64(corps))
            put("cles", JsonObject(parCompte.mapValues { JsonObject(it.value) }))
        }
    }
}
