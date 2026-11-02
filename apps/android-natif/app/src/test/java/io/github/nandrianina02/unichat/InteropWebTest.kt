package io.github.nandrianina02.unichat

import io.github.nandrianina02.unichat.chiffrement.*
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Le chiffrement Kotlin contre celui du web : les jeux d'essai
 * (vecteurs-web.json) sont produits par packages/chiffrement
 * (test/vecteurs.test.ts). Chaque octet doit être le même. En retour, ce
 * test écrit build/sortie-kotlin.json, que le web relit
 * (test/kotlin.test.ts) : l'intégration continue enchaîne les deux.
 */
class InteropWebTest {
    private val v: JsonObject = Json.parseToJsonElement(
        javaClass.classLoader!!.getResource("vecteurs-web.json")!!.readText(),
    ).jsonObject

    private fun JsonObject.o(cle: String) = this[cle]!!.jsonObject
    private fun JsonObject.t(cle: String) = this[cle]!!.jsonPrimitive.content
    private fun JsonObject.b(cle: String) = depuisBase64(t(cle))
    private fun JsonObject.n(cle: String) = this[cle]!!.jsonPrimitive.long

    private fun identitePrivee(j: JsonObject) = identiteDepuisSecrets(j.b("signature"), j.b("echange"), j.b("preuve"))
    private fun identitePublique(j: JsonObject) = IdentitePublique(j.b("signature"), j.b("echange"), j.b("preuve"))
    private fun cleSignee(j: JsonObject) = CleSignee(j.n("id"), Paire(j.b("secrete"), j.b("publique")), j.b("signature"), j.n("creeeLe"))
    private fun cleUnique(j: JsonObject) = CleUnique(j.n("id"), Paire(j.b("secrete"), j.b("publique")))

    private fun ratchet(j: JsonObject): EtatRatchet {
        fun opt(cle: String) = j[cle]?.takeIf { it !is JsonNull }?.jsonPrimitive?.content?.let(::depuisBase64)
        val sautees = LinkedHashMap<String, ByteArray>()
        j.o("sautees").forEach { (k, e) -> sautees[k] = depuisBase64(e.jsonPrimitive.content) }
        return EtatRatchet(
            Paire(j.o("dhs").b("secrete"), j.o("dhs").b("publique")), opt("dhr"), j.b("rk"), opt("cks"), opt("ckr"),
            j.n("ns"), j.n("nr"), j.n("pn"), sautees, j["ordre"]!!.jsonArray.map { it.jsonPrimitive.content }.toMutableList(),
        )
    }

    private fun correspondant(j: JsonObject) = Correspondant(
        j["sessions"]!!.jsonArray.map { e ->
            val s = e.jsonObject
            val o = s["ouverture"]?.takeIf { it !is JsonNull }?.jsonObject
            SessionChiffree(
                ratchet(s.o("ratchet")), s.b("ad"), s.b("ephemere"),
                o?.let { OuvertureX3DH(identitePublique(it.o("identite")), it.b("ephemere"), it.n("cleSigneeId"), it.n("cleUniqueId")) },
                identitePublique(s.o("identite")),
            )
        },
    )

    private fun texte(o: ByteArray) = octetsVersTexte(o)

    @Test
    fun base64_et_primitives() {
        v["base64"]!!.jsonArray.forEach { e ->
            val c = e.jsonObject
            val octets = c.t("octets").chunked(2).map { it.toInt(16).toByte() }.toByteArray()
            assertEquals(c.t("texte"), versBase64(octets))
            assertArrayEquals(octets, depuisBase64(c.t("texte")))
        }
        val x = v.o("x25519")
        assertArrayEquals(x.b("publiqueA"), publiqueEchange(x.b("secreteA")))
        assertArrayEquals(x.b("partage"), echanger(x.b("secreteA"), x.b("publiqueB")))

        val e = v.o("ed25519")
        assertArrayEquals(e.b("publique"), publiqueSignature(e.b("secrete")))
        // Ed25519 est déterministe : la même signature que le web, octet pour octet.
        assertArrayEquals(e.b("signature"), signer(e.b("message"), e.b("secrete")))
        assertTrue(verifierSignature(e.b("signature"), e.b("message"), e.b("publique")))
        assertFalse(verifierSignature(e.b("signature"), texteVersOctets("autre message"), e.b("publique")))

        val h = v.o("hkdf")
        assertArrayEquals(h.b("sortie"), deriver(h.b("ikm"), h.b("sel"), h.t("info"), h.n("taille").toInt()))
        val m = v.o("hmac")
        assertArrayEquals(m.b("sortie"), authentifier(m.b("cle"), m.b("message")))
        val a = v.o("aead")
        assertArrayEquals(a.b("chiffre"), chiffrerAead(a.b("cle"), a.b("nonce"), a.b("clair"), a.b("associe")))
        assertArrayEquals(a.b("clair"), dechiffrerAead(a.b("cle"), a.b("nonce"), a.b("chiffre"), a.b("associe")))
        val s = v.o("scelle")
        assertArrayEquals(s.b("clair"), ouvrir(s.b("cle"), s.b("scelle"), s.b("associe")))
    }

    @Test
    fun identite_et_cle_signee() {
        val i = identitePrivee(v.o("identite").o("privee"))
        val publique = v.o("identite").o("publique")
        assertArrayEquals(publique.b("signature"), i.signature.publique)
        assertArrayEquals(publique.b("echange"), i.echange.publique)
        assertTrue(verifierIdentite(i.publique()))
        val c = v.o("cleSignee")
        assertTrue(verifierCleSignee(identitePublique(c.o("identite")), cleSignee(c.o("cle")).publique()))
    }

    @Test
    fun x3dh_meme_secret_des_deux_cotes() {
        val x = v.o("x3dh")
        val alice = identitePrivee(x.o("alice"))
        val bob = identitePrivee(x.o("bob"))
        val signee = cleSignee(x.o("cleSignee"))
        val unique = cleUnique(x.o("cleUnique"))
        val ephemere = x.b("ephemere").let { Paire(it, publiqueEchange(it)) }
        val (secret, ouverture) = ouvrirX3DH(alice, Paquet(bob.publique(), signee.publique(), unique.publique()), ephemere)
        assertArrayEquals(x.b("sk"), secret.sk)
        assertArrayEquals(x.b("ad"), secret.ad)
        val accepte = accepterX3DH(bob, signee, unique, ouverture)
        assertArrayEquals(x.b("sk"), accepte.sk)
    }

    @Test
    fun session_ouverte_par_le_web() {
        val s = v.o("session")
        val bob = identitePrivee(s.o("bob"))
        val signee = cleSignee(s.o("cleSignee"))
        val unique = cleUnique(s.o("cleUnique"))
        val cles = ClesLocales(bob, { if (it == signee.id) signee else null }, { if (it == unique.id) unique else null })
        val messages = s["messages"]!!.jsonArray.map { it.jsonObject }
        // Comme sur le web : reçus dans le désordre (1, 3, 2), le 2 par sa clé sautée.
        var c: Correspondant? = null
        for (i in listOf(0, 2, 1)) {
            val r = dechiffrer(c, messages[i].b("message"), cles)
            assertEquals(messages[i].t("clair"), texte(r.clair))
            c = r.correspondant
        }
        // Alice, telle que le web l'a laissée, lit la réponse de Bob (pas de ratchet DH côté réception).
        val alice = identitePrivee(s.o("alice"))
        val clesAlice = ClesLocales(alice, { null }, { null })
        val reponse = dechiffrer(correspondant(s.o("etatAlice")), s.o("reponse").b("message"), clesAlice)
        assertEquals(s.o("reponse").t("clair"), texte(reponse.clair))
    }

    @Test
    fun liaison_code_et_fichier() {
        val l = v.o("liaison")
        val code = lireCode(l.t("code"))!!
        val paireReponse = l.b("paireReponse").let { Paire(it, publiqueEchange(it)) }
        assertArrayEquals(l.b("cleReponse"), paireReponse.publique)
        assertArrayEquals(l.b("preuve"), preuveLiaison(code, paireReponse.publique))
        assertTrue(verifierPreuve(code, paireReponse.publique, l.b("preuve")))
        // Les deux appareils tirent la même clé, chacun de son côté de l'échange.
        assertArrayEquals(l.b("cle"), cleCommune(code, paireReponse, code.cle))
        val paireCode = l.b("paireCode").let { Paire(it, publiqueEchange(it)) }
        assertArrayEquals(l.b("cle"), cleCommune(code, paireCode, paireReponse.publique))
        val recue = ouvrirIdentite(l.b("cle"), code.canal, l.b("identiteScellee"))
        assertArrayEquals(l.o("identite").b("signature"), recue.signature.secrete)
        assertEquals(l.t("code"), encoderCode(code))

        val cs = v.o("code")
        val calcule = codeSecurite(
            Partie(cs.o("moi").t("compte"), identitePublique(cs.o("moi").o("identite"))),
            Partie(cs.o("autre").t("compte"), identitePublique(cs.o("autre").o("identite"))),
        )
        assertEquals(cs.t("chiffres"), calcule.chiffres)
        assertEquals(cs.t("qr"), calcule.qr)

        val f = v.o("fichier")
        assertArrayEquals(f.b("clair"), dechiffrerOctets(f.b("scelle"), f.b("cle")))
    }

    /** Une enveloppe complète du web (contenu scellé, clé par la session) ouverte par le déchiffreur de l'appli. */
    @Test
    fun enveloppe_du_web_ouverte_par_le_dechiffreur() {
        val s = v.o("session")
        val ve = v.o("enveloppe")
        val trousseau = io.github.nandrianina02.unichat.donnees.RangementMemoire()
        trousseau.ecrire("identite", identitePriveeJson(identitePrivee(s.o("bob"))))
        trousseau.ecrire("appareil", buildJsonObject { put("numero", ve.n("numeroBob")); put("jeton", versBase64(aleatoire(32))) })
        trousseau.ecrire("signees", kotlinx.serialization.json.JsonArray(listOf(cleSigneeJson(cleSignee(s.o("cleSignee"))))))
        val unique = cleUnique(s.o("cleUnique"))
        trousseau.ecrire("unique:${unique.id}", cleUniqueJson(unique))
        val api = io.github.nandrianina02.unichat.donnees.Reseau("http://localhost/", object : io.github.nandrianina02.unichat.donnees.StockageJeton {
            override fun lire(): String? = null
            override fun ecrire(jeton: String?) = Unit
        }).api
        val cles = io.github.nandrianina02.unichat.donnees.ClesAppareil(api, trousseau)
        val dechiffreur = io.github.nandrianina02.unichat.donnees.Dechiffreur(cles, trousseau, "22222222-2222-4222-8222-222222222222")

        val r = dechiffreur.dechiffrer(ve.o("enveloppe"))
        assertTrue(r is io.github.nandrianina02.unichat.donnees.Dechiffrement.Message)
        val contenu = (r as io.github.nandrianina02.unichat.donnees.Dechiffrement.Message).contenu
        assertEquals(ve.o("contenu").t("texte"), contenu.t("texte"))
        assertEquals("Citation", contenu.o("reponseA").t("extrait"))
        // La clé unique consommée par l'ouverture est effacée, la session est rangée.
        assertEquals(null, trousseau.lire("unique:${unique.id}"))
        assertTrue(trousseau.lire("correspondant:11111111-1111-4111-8111-111111111111:1") != null)
        // Rejouée, la même enveloppe ne s'ouvre plus : sa clé de message n'existe plus.
        assertTrue(dechiffreur.dechiffrer(ve.o("enveloppe")) is io.github.nandrianina02.unichat.donnees.Dechiffrement.Illisible)
    }

    /** Ce que Kotlin chiffre, pour que le web le relise (test/kotlin.test.ts). */
    @Test
    fun ecrire_la_sortie_pour_le_web() {
        val s = v.o("session")
        val bob = identitePrivee(s.o("bob"))
        val paquet = Paquet(bob.publique(), cleSignee(s.o("cleSignee")).publique(), cleUnique(s.o("cleUnique")).publique())

        // Une nouvelle personne, Carole, ouvre une session vers le Bob du web.
        val carole = creerIdentite()
        var c: Correspondant? = null
        val clairs = listOf("Bonjour Bob, ici Kotlin", "Deuxième message, accents compris : é à ç", "Troisième")
        val messages = clairs.map { m ->
            val r = chiffrer(c, carole, texteVersOctets(m), paquet)
            c = r.correspondant
            versBase64(r.message)
        }

        // Alice, reprise de l'état du web, lit la réponse de Bob puis lui répond : ratchet DH côté émission.
        val alice = identitePrivee(s.o("alice"))
        val lue = dechiffrer(correspondant(s.o("etatAlice")), s.o("reponse").b("message"), ClesLocales(alice, { null }, { null }))
        val suite = chiffrer(lue.correspondant, alice, texteVersOctets("Alice répond depuis Kotlin"))

        val l = v.o("liaison")
        val code = lireCode(l.t("code"))!!
        val fichierClair = aleatoire(777)
        val fichier = chiffrerOctets(fichierClair)

        val sortie = buildJsonObject {
            put("carole", buildJsonObject {
                put("signature", versBase64(carole.signature.publique))
                put("echange", versBase64(carole.echange.publique))
                put("preuve", versBase64(carole.preuve))
            })
            put("messages", buildJsonArray {
                messages.forEachIndexed { i, m -> add(buildJsonObject { put("message", m); put("clair", clairs[i]) }) }
            })
            put("suite", buildJsonObject { put("message", versBase64(suite.message)); put("clair", "Alice répond depuis Kotlin") })
            put("liaison", buildJsonObject {
                put("identiteScellee", versBase64(scellerIdentite(l.b("cle"), code.canal, carole)))
                put("signatureCarole", versBase64(carole.signature.secrete))
            })
            put("fichier", buildJsonObject {
                put("cle", versBase64(fichier.cle))
                put("scelle", versBase64(fichier.scelle))
                put("clair", versBase64(fichierClair))
            })
        }
        File("build").mkdirs()
        File("build/sortie-kotlin.json").writeText(sortie.toString())
    }
}
