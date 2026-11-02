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

// --- Annuaire des clés (packages/shared/src/cles.ts) ----------------------------------

@Serializable
data class IdentiteCles(val signature: String, val echange: String, val preuve: String, val version: Int? = null)

/** L'identité telle que l'inscription l'envoie : le schéma du serveur est strict, sans « version ». */
@Serializable
data class IdentiteEnvoyee(val signature: String, val echange: String, val preuve: String)

@Serializable
data class AppareilCles(val numero: Int, val cleSigneeId: Long, val cleSigneeLe: Long, val clesUniques: Int)

@Serializable
data class EtatCles(val identite: IdentiteCles? = null, val appareilsInscrits: Int = 0, val appareil: AppareilCles? = null)

@Serializable
data class CleSigneeTransport(val id: Long, val cle: String, val signature: String)

@Serializable
data class CleUniqueTransport(val id: Long, val cle: String)

@Serializable
data class AppareilInscription(val cleSignee: CleSigneeTransport, val clesUniques: List<CleUniqueTransport>, val jeton: String)

@Serializable
data class InscriptionCles(val identite: IdentiteEnvoyee, val appareil: AppareilInscription)

@Serializable
data class RepriseCles(val numero: Int, val jeton: String)

@Serializable
data class EnvoiClesUniques(val cles: List<CleUniqueTransport>)

@Serializable
data class EnvoiCleSignee(val cleSignee: CleSigneeTransport)

@Serializable
data class AppareilRelie(val canal: String, val appareil: AppareilInscription)

@Serializable
data class ReponseLiaison(val cle: String, val preuve: String)

@Serializable
data class EtatLiaison(
    /** attente, repondu, cles, termine. */
    val etat: String,
    val role: String,
    val expireLe: Long = 0,
    val reponse: ReponseLiaison? = null,
    val cles: String? = null,
    val autre: String? = null,
)

@Serializable
data class EtatHistorique(val etat: String, val deposes: Int = 0, val morceaux: Int? = null, val cle: String? = null)

// --- Personnes et groupes ----------------------------------------------------------------

@Serializable
data class CarteProfil(val id: String, val nom: String, val pseudo: String? = null, val photo: String? = null)

@Serializable
data class GroupeCourt(val id: String, val nom: String)

@Serializable
data class ListeGroupes(val groupes: List<GroupeCourt>)

