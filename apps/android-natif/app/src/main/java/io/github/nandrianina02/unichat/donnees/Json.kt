package io.github.nandrianina02.unichat.donnees

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

/*
 * Petits outils sur les objets JSON du protocole et de la base : les
 * messages restent dans la forme du web, et l'appli les lit et les modifie
 * champ par champ.
 */

fun JsonObject.texte(cle: String): String = this[cle]?.takeIf { it !is JsonNull }?.jsonPrimitive?.content ?: ""
fun JsonObject.texteOuNul(cle: String): String? = this[cle]?.takeIf { it !is JsonNull }?.jsonPrimitive?.content
fun JsonObject.entier(cle: String): Long? = this[cle]?.takeIf { it !is JsonNull }?.jsonPrimitive?.longOrNull
fun JsonObject.vrai(cle: String): Boolean = this[cle]?.takeIf { it !is JsonNull }?.jsonPrimitive?.booleanOrNull == true
fun JsonObject.objet(cle: String): JsonObject? = this[cle]?.takeIf { it is JsonObject }?.jsonObject

/** Le même objet, un champ changé (ou retiré avec null). */
fun JsonObject.avec(cle: String, valeur: Any?): JsonObject {
    val element: JsonElement? = when (valeur) {
        null -> null
        is JsonElement -> valeur
        is String -> JsonPrimitive(valeur)
        is Boolean -> JsonPrimitive(valeur)
        is Number -> JsonPrimitive(valeur)
        else -> throw IllegalArgumentException("Valeur JSON inattendue.")
    }
    return JsonObject(if (element == null) this - cle else this + (cle to element))
}

fun JsonObject.avec(vararg champs: Pair<String, Any?>): JsonObject = champs.fold(this) { o, (k, v) -> o.avec(k, v) }
