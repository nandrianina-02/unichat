package io.github.nandrianina02.unichat.donnees

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Noms et photos des personnes et des groupes : ce que l'historique a
 * apporté, sinon ce que le serveur dit (profil public, liste de mes
 * groupes), gardé ensuite dans la base.
 */
class Annuaire(private val api: UniChatApi, private val base: Base) {
    private val demandees = mutableSetOf<String>()

    fun nomPersonne(id: String): String? = base.personne(id)?.texteOuNul("nom")
    fun photoPersonne(id: String): String? = base.personne(id)?.texteOuNul("photo")
    fun nomGroupe(id: String): String? = base.groupe(id)?.texteOuNul("nom")

    /** Les personnes inconnues de la base sont demandées une fois au serveur. */
    suspend fun completer(personnes: Collection<String>) {
        val aDemander = personnes.filter { base.personne(it) == null && demandees.add(it) }
        for (id in aDemander) {
            appel { api.personne(id) }.onSuccess { p ->
                base.ecrirePersonne(buildJsonObject {
                    put("id", p.id)
                    put("nom", p.nom)
                    put("pseudo", p.pseudo?.let { JsonPrimitive(it) } ?: JsonPrimitive(null as String?))
                    put("photo", p.photo?.let { JsonPrimitive(it) } ?: JsonPrimitive(null as String?))
                    put("maj", System.currentTimeMillis())
                })
            }
        }
        if (aDemander.isNotEmpty()) base.signaler()
    }

    /**
     * Les membres d'un groupe, pour savoir à qui chiffrer. Relus au serveur
     * quand la base ne les a pas, ou quand il a refusé une liste périmée.
     * Null si je n'en fais plus partie.
     */
    suspend fun membres(groupe: String, frais: Boolean = false): List<String>? {
        val g = base.groupe(groupe)?.takeIf { !frais && it["membres"] is JsonArray }
            ?: appel { api.groupe(groupe) }.fold(
                onSuccess = { it.also { base.ecrireGroupe(it); base.signaler() } },
                // Le serveur ne montre un groupe qu'à ses membres.
                onFailure = { if (it is ErreurServeur && it.statut == 404) return null else throw it },
            )
        if (g["moiMembre"]?.jsonPrimitive?.booleanOrNull == false) return null
        return (g["membres"] as? JsonArray)?.mapNotNull { (it as? JsonObject)?.texteOuNul("id") }?.takeIf { it.isNotEmpty() }
    }

    /** Les noms de mes groupes, relus en bloc (un événement de groupe a pu les changer). */
    suspend fun rafraichirGroupes() {
        appel { api.groupes() }.onSuccess { liste ->
            liste.groupes.forEach { g ->
                val existant = base.groupe(g.id)
                base.ecrireGroupe((existant ?: buildJsonObject { put("id", g.id) }).avec("nom", g.nom))
            }
            base.signaler()
        }
    }
}
