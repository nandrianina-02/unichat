package io.github.nandrianina02.unichat.chiffrement

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put

/*
 * Forme JSON des clés et des sessions, rangées dans le trousseau de
 * l'appareil. Octets en base64 « URL », comme les jeux d'essai partagés avec
 * le web (packages/chiffrement/test/interop.ts) : un état exporté d'un côté
 * se relit de l'autre.
 */

private fun JsonObject.b(cle: String) = depuisBase64(this[cle]!!.jsonPrimitive.content)
private fun JsonObject.n(cle: String) = this[cle]!!.jsonPrimitive.long
private fun JsonObject.o(cle: String) = this[cle]!!.jsonObject
private fun JsonObject.facultatif(cle: String) = this[cle]?.takeIf { it !is JsonNull }

fun identitePriveeJson(i: IdentitePrivee) = buildJsonObject {
    put("signature", versBase64(i.signature.secrete))
    put("echange", versBase64(i.echange.secrete))
    put("preuve", versBase64(i.preuve))
}

fun identitePriveeLue(j: JsonObject) = identiteDepuisSecrets(j.b("signature"), j.b("echange"), j.b("preuve"))

fun identitePubliqueJson(i: IdentitePublique) = buildJsonObject {
    put("signature", versBase64(i.signature))
    put("echange", versBase64(i.echange))
    put("preuve", versBase64(i.preuve))
}

fun identitePubliqueLue(j: JsonObject) = IdentitePublique(j.b("signature"), j.b("echange"), j.b("preuve"))

fun cleSigneeJson(c: CleSignee) = buildJsonObject {
    put("id", c.id)
    put("secrete", versBase64(c.paire.secrete))
    put("publique", versBase64(c.paire.publique))
    put("signature", versBase64(c.signature))
    put("creeeLe", c.creeeLe)
}

fun cleSigneeLue(j: JsonObject) = CleSignee(j.n("id"), Paire(j.b("secrete"), j.b("publique")), j.b("signature"), j.n("creeeLe"))

fun cleUniqueJson(c: CleUnique) = buildJsonObject {
    put("id", c.id)
    put("secrete", versBase64(c.paire.secrete))
    put("publique", versBase64(c.paire.publique))
}

fun cleUniqueLue(j: JsonObject) = CleUnique(j.n("id"), Paire(j.b("secrete"), j.b("publique")))

private fun ratchetJson(r: EtatRatchet) = buildJsonObject {
    put("dhs", buildJsonObject {
        put("secrete", versBase64(r.dhs.secrete))
        put("publique", versBase64(r.dhs.publique))
    })
    put("dhr", r.dhr?.let { JsonPrimitive(versBase64(it)) } ?: JsonNull)
    put("rk", versBase64(r.rk))
    put("cks", r.cks?.let { JsonPrimitive(versBase64(it)) } ?: JsonNull)
    put("ckr", r.ckr?.let { JsonPrimitive(versBase64(it)) } ?: JsonNull)
    put("ns", r.ns)
    put("nr", r.nr)
    put("pn", r.pn)
    put("sautees", buildJsonObject { r.sautees.forEach { (k, v) -> put(k, versBase64(v)) } })
    put("ordre", buildJsonArray { r.ordre.forEach { add(JsonPrimitive(it)) } })
}

private fun ratchetLu(j: JsonObject): EtatRatchet {
    fun opt(cle: String) = j.facultatif(cle)?.jsonPrimitive?.content?.let(::depuisBase64)
    val sautees = LinkedHashMap<String, ByteArray>()
    j.o("sautees").forEach { (k, e) -> sautees[k] = depuisBase64(e.jsonPrimitive.content) }
    return EtatRatchet(
        Paire(j.o("dhs").b("secrete"), j.o("dhs").b("publique")), opt("dhr"), j.b("rk"), opt("cks"), opt("ckr"),
        j.n("ns"), j.n("nr"), j.n("pn"), sautees, j["ordre"]!!.jsonArray.map { it.jsonPrimitive.content }.toMutableList(),
    )
}

fun correspondantJson(c: Correspondant) = buildJsonObject {
    put("sessions", JsonArray(c.sessions.map { s ->
        buildJsonObject {
            put("ratchet", ratchetJson(s.ratchet))
            put("ad", versBase64(s.ad))
            put("ephemere", versBase64(s.ephemere))
            s.ouverture?.let { o ->
                put("ouverture", buildJsonObject {
                    put("identite", identitePubliqueJson(o.identite))
                    put("ephemere", versBase64(o.ephemere))
                    put("cleSigneeId", o.cleSigneeId)
                    put("cleUniqueId", o.cleUniqueId)
                })
            }
            put("identite", identitePubliqueJson(s.identite))
        }
    }))
}

fun correspondantLu(j: JsonObject) = Correspondant(
    j["sessions"]!!.jsonArray.map { e ->
        val s = e.jsonObject
        val o = s.facultatif("ouverture")?.jsonObject
        SessionChiffree(
            ratchetLu(s.o("ratchet")), s.b("ad"), s.b("ephemere"),
            o?.let { OuvertureX3DH(identitePubliqueLue(it.o("identite")), it.b("ephemere"), it.n("cleSigneeId"), it.n("cleUniqueId")) },
            identitePubliqueLue(s.o("identite")),
        )
    },
)

/** Utilitaire de lecture pour l'appelant : un élément JSON devenu objet. */
fun JsonElement.objet(): JsonObject = jsonObject
