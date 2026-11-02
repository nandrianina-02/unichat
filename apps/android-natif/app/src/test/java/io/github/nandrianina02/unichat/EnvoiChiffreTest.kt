package io.github.nandrianina02.unichat

import io.github.nandrianina02.unichat.chiffrement.CleSignee
import io.github.nandrianina02.unichat.chiffrement.IdentitePrivee
import io.github.nandrianina02.unichat.chiffrement.cleSigneeJson
import io.github.nandrianina02.unichat.chiffrement.cleUniqueJson
import io.github.nandrianina02.unichat.chiffrement.creerCleSignee
import io.github.nandrianina02.unichat.chiffrement.creerClesUniques
import io.github.nandrianina02.unichat.chiffrement.creerIdentite
import io.github.nandrianina02.unichat.chiffrement.identitePriveeJson
import io.github.nandrianina02.unichat.chiffrement.versBase64
import io.github.nandrianina02.unichat.donnees.AppareilsDesComptes
import io.github.nandrianina02.unichat.donnees.AppareilsDuCompte
import io.github.nandrianina02.unichat.donnees.Chiffreur
import io.github.nandrianina02.unichat.donnees.ClesAppareil
import io.github.nandrianina02.unichat.donnees.CleSigneeTransport
import io.github.nandrianina02.unichat.donnees.CleUniqueTransport
import io.github.nandrianina02.unichat.donnees.Dechiffrement
import io.github.nandrianina02.unichat.donnees.Dechiffreur
import io.github.nandrianina02.unichat.donnees.DemandePaquets
import io.github.nandrianina02.unichat.donnees.Destination
import io.github.nandrianina02.unichat.donnees.ErreurChiffrement
import io.github.nandrianina02.unichat.donnees.IdentiteCles
import io.github.nandrianina02.unichat.donnees.ListePaquets
import io.github.nandrianina02.unichat.donnees.PaquetAppareil
import io.github.nandrianina02.unichat.donnees.PaquetsDuCompte
import io.github.nandrianina02.unichat.donnees.RangementMemoire
import io.github.nandrianina02.unichat.donnees.UniChatApi
import io.github.nandrianina02.unichat.donnees.texte
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.lang.reflect.Proxy
import java.util.UUID

/**
 * L'envoi de bout en bout, sans serveur : Alice chiffre avec le Chiffreur,
 * Bob ouvre avec le Dechiffreur (lui-même éprouvé contre les enveloppes du
 * web dans InteropWebTest). L'API est simulée : seuls l'annuaire des clés et
 * les paquets répondent.
 */
class EnvoiChiffreTest {
    private val alice = UUID.randomUUID().toString()
    private val bob = UUID.randomUUID().toString()
    private val conversation = "d:${minOf(alice, bob)}:${maxOf(alice, bob)}"

    private class Appareil(val identite: IdentitePrivee, val numero: Int, val signee: CleSignee) {
        val trousseau = RangementMemoire()
        val unique = creerClesUniques(1, 1).first()

        init {
            trousseau.ecrire("identite", identitePriveeJson(identite))
            trousseau.ecrire("appareil", buildJsonObject {
                put("numero", numero)
                put("jeton", versBase64(ByteArray(32)))
            })
            trousseau.ecrire("signees", JsonArray(listOf(cleSigneeJson(signee))))
            trousseau.ecrire("unique:${unique.id}", cleUniqueJson(unique))
        }

        fun transport() = IdentiteCles(
            versBase64(identite.signature.publique), versBase64(identite.echange.publique), versBase64(identite.preuve), 1,
        )
    }

    private fun appareil(numero: Int): Appareil {
        val identite = creerIdentite()
        return Appareil(identite, numero, creerCleSignee(identite, 1, System.currentTimeMillis()))
    }

    /** Une API qui ne connaît que les deux routes de l'envoi ; les fonctions suspendues répondent sans suspendre. */
    private fun api(comptes: Map<String, Appareil?>, paquetsDemandes: MutableList<DemandePaquets>): UniChatApi =
        Proxy.newProxyInstance(UniChatApi::class.java.classLoader, arrayOf(UniChatApi::class.java)) { _, methode, args ->
            when (methode.name) {
                "appareilsCles" -> AppareilsDesComptes(
                    comptes.mapNotNull { (id, a) -> a?.let { AppareilsDuCompte(id, it.transport(), listOf(it.numero)) } },
                )
                "paquets" -> {
                    val demande = args[0] as DemandePaquets
                    paquetsDemandes += demande
                    ListePaquets(demande.comptes.mapNotNull { d ->
                        val a = comptes[d.id] ?: return@mapNotNull null
                        PaquetsDuCompte(d.id, a.transport(), listOf(PaquetAppareil(
                            a.numero,
                            CleSigneeTransport(a.signee.id, versBase64(a.signee.paire.publique), versBase64(a.signee.signature)),
                            CleUniqueTransport(a.unique.id, versBase64(a.unique.paire.publique)),
                        )))
                    })
                }
                else -> throw UnsupportedOperationException(methode.name)
            }
        } as UniChatApi

    private fun recue(trame: JsonObject, id: String, pour: String) = buildJsonObject {
        put("id", id)
        put("conversation", conversation)
        put("de", alice)
        put("deAppareil", 1)
        put("a", bob)
        put("genre", "message")
        put("corps", trame.texte("corps"))
        put("cles", trame["cles"]!!.jsonObject[pour]!!)
        put("le", System.currentTimeMillis())
    }

    private fun contenu(texte: String) = buildJsonObject {
        put("v", 1)
        put("texte", texte)
    }

    @Test
    fun message_chiffre_ici_ouvert_par_le_destinataire() = runBlocking {
        val a = appareil(1)
        val b = appareil(3)
        val demandes = mutableListOf<DemandePaquets>()
        val apiAlice = api(mapOf(alice to a, bob to b), demandes)
        val chiffreur = Chiffreur(apiAlice, ClesAppareil(apiAlice, a.trousseau), a.trousseau, alice)
        val dechiffreur = Dechiffreur(ClesAppareil(apiAlice, b.trousseau), b.trousseau, bob)
        val destination = Destination(conversation, a = bob, comptes = listOf(bob))

        for ((i, texte) in listOf("Bonjour Bob", "Deuxième message", "Troisième").withIndex()) {
            val id = UUID.randomUUID().toString()
            val trame = chiffreur.chiffrer(destination, id, "message", contenu(texte))
            assertEquals("chiffre", trame.texte("t"))
            assertEquals(bob, trame.texte("a"))
            // Alice n'a qu'un appareil : rien pour elle-même, une clé pour l'appareil 3 de Bob.
            assertTrue(trame["cles"]!!.jsonObject[alice]!!.jsonObject.isEmpty())
            val r = dechiffreur.dechiffrer(recue(trame, id, bob))
            assertTrue("message $i illisible", r is Dechiffrement.Message)
            assertEquals(texte, (r as Dechiffrement.Message).contenu.texte("texte"))
        }
        // Une session ouverte sert aux messages suivants : un seul paquet consommé.
        assertEquals(1, demandes.size)
        assertEquals(listOf(3), demandes[0].comptes.single { it.id == bob }.appareils)
    }

    @Test
    fun contenu_deplace_vers_une_autre_discussion_illisible() = runBlocking {
        val a = appareil(1)
        val b = appareil(3)
        val apiAlice = api(mapOf(alice to a, bob to b), mutableListOf())
        val chiffreur = Chiffreur(apiAlice, ClesAppareil(apiAlice, a.trousseau), a.trousseau, alice)
        val dechiffreur = Dechiffreur(ClesAppareil(apiAlice, b.trousseau), b.trousseau, bob)
        val id = UUID.randomUUID().toString()
        val trame = chiffreur.chiffrer(Destination(conversation, a = bob, comptes = listOf(bob)), id, "message", contenu("secret"))
        val deplacee = JsonObject(recue(trame, id, bob) + ("conversation" to kotlinx.serialization.json.JsonPrimitive("d:autre:discussion")))
        assertFalse(dechiffreur.dechiffrer(deplacee) is Dechiffrement.Message)
    }

    @Test
    fun personne_sans_cles_refusee() = runBlocking {
        val a = appareil(1)
        val apiAlice = api(mapOf(alice to a, bob to null), mutableListOf())
        val chiffreur = Chiffreur(apiAlice, ClesAppareil(apiAlice, a.trousseau), a.trousseau, alice)
        try {
            chiffreur.chiffrer(Destination(conversation, a = bob, comptes = listOf(bob)), UUID.randomUUID().toString(), "message", contenu("x"))
            fail("Rien ne doit partir vers une personne sans clés.")
        } catch (e: ErreurChiffrement) {
            assertEquals("sans-cles", e.raison)
        }
    }
}
