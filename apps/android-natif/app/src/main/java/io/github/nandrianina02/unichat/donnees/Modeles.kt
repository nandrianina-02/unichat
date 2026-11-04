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
    /** Numéro vérifié par SMS (+261…), visible de soi seul : il sert à être trouvé. */
    val telephone: String? = null,
    val trouvableParTelephone: Boolean = true,
    /** Numéro qui attend le code reçu par SMS. */
    val verificationTelephone: VerificationTelephone? = null,
    /** « google », ou « telephone » pour un compte ouvert par son seul numéro. */
    val connexion: String = "google",
)

@Serializable
data class DemandeConnexionTelephone(val demande: String, val numero: String, val expireLe: Long)

@Serializable
data class ConnexionTelephone(val demande: String, val code: String, val appareil: String)

@Serializable
data class VerificationTelephone(val numero: String, val expireLe: Long)

@Serializable
data class DemandeTelephone(val numero: String)

@Serializable
data class CodeTelephone(val code: String)

@Serializable
data class MajTrouvableTelephone(val trouvableParTelephone: Boolean)

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
data class CarteProfil(
    val id: String,
    val nom: String,
    val pseudo: String? = null,
    val photo: String? = null,
    val infos: String? = null,
    val estContact: Boolean = false,
    val estSoi: Boolean = false,
    /** Je l'ai bloquée. L'inverse n'est jamais révélé. */
    val bloque: Boolean = false,
)

@Serializable
data class ResultatsRecherche(val resultats: List<CarteProfil>)

@Serializable
data class ListeContacts(val contacts: List<CarteProfil>)

@Serializable
data class AjoutContact(val id: String)

@Serializable
data class GroupeCourt(val id: String, val nom: String)

@Serializable
data class ListeGroupes(val groupes: List<GroupeCourt>)

/** Les membres invités doivent être des contacts (vérifié par le serveur), 40 personnes au plus avec moi. */
@Serializable
data class CreationGroupe(val nom: String, val membres: List<String>)

@Serializable
data class MajGroupe(val nom: String? = null, val description: String? = null)

@Serializable
data class AjoutMembres(val membres: List<String>)


// --- Envoi chiffré (Chiffreur.chiffrer, apps/web/src/lib/chiffrement.ts) ---------------

@Serializable
data class DemandeAppareils(val comptes: List<String>)

/** Appareils inscrits d'un compte : pour qui chiffrer, sans consommer de clé unique. */
@Serializable
data class AppareilsDuCompte(val id: String, val identite: IdentiteCles, val appareils: List<Int>)

@Serializable
data class AppareilsDesComptes(val comptes: List<AppareilsDuCompte>)

@Serializable
data class DemandePaquet(val id: String, val appareils: List<Int>)

@Serializable
data class DemandePaquets(val comptes: List<DemandePaquet>)

@Serializable
data class PaquetAppareil(val numero: Int, val cleSignee: CleSigneeTransport, val cleUnique: CleUniqueTransport? = null)

@Serializable
data class PaquetsDuCompte(val id: String, val identite: IdentiteCles, val appareils: List<PaquetAppareil>)

@Serializable
data class ListePaquets(val comptes: List<PaquetsDuCompte>)
