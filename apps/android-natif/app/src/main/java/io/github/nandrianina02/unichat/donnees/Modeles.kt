package io.github.nandrianina02.unichat.donnees

import kotlinx.serialization.Serializable

/* Les formes de l'API, reprises de packages/shared (types.ts, connexion.ts). */

@Serializable
data class NonceNatif(val etat: String, val nonce: String)

@Serializable
data class ConnexionNatif(val etat: String, val jeton: String, val appareil: String)

@Serializable
data class SessionNatif(val jeton: String)

@Serializable
data class RefusServeur(val erreur: String, val message: String)

@Serializable
data class Moi(
    val id: String,
    val email: String,
    val nom: String,
    val pseudo: String? = null,
    val infos: String = "",
    /** Version de la photo (elle invalide le cache) ; absente sans photo. */
    val photo: String? = null,
)

@Serializable
data class AppareilConnecte(
    val id: String,
    /** web, android ou desktop. */
    val plateforme: String,
    val appareil: String,
    val ville: String? = null,
    val pays: String? = null,
    val creeLe: Long,
    val vuLe: Long,
    val actuel: Boolean = false,
)

@Serializable
data class ListeAppareils(val appareils: List<AppareilConnecte>)
