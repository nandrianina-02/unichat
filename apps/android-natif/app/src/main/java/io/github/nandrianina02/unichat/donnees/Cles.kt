package io.github.nandrianina02.unichat.donnees

import io.github.nandrianina02.unichat.chiffrement.CleSignee
import io.github.nandrianina02.unichat.chiffrement.IdentitePrivee
import io.github.nandrianina02.unichat.chiffrement.aleatoire
import io.github.nandrianina02.unichat.chiffrement.cleSigneeJson
import io.github.nandrianina02.unichat.chiffrement.cleSigneeLue
import io.github.nandrianina02.unichat.chiffrement.cleUniqueJson
import io.github.nandrianina02.unichat.chiffrement.creerCleSignee
import io.github.nandrianina02.unichat.chiffrement.creerClesUniques
import io.github.nandrianina02.unichat.chiffrement.creerIdentite
import io.github.nandrianina02.unichat.chiffrement.depuisBase64
import io.github.nandrianina02.unichat.chiffrement.identitePriveeJson
import io.github.nandrianina02.unichat.chiffrement.identitePriveeLue
import io.github.nandrianina02.unichat.chiffrement.versBase64
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put

/*
 * Clés de cet appareil, portées d'apps/web/src/lib/cles.ts (même annuaire,
 * mêmes règles) :
 * - PRET : l'appareil est inscrit dans l'annuaire avec ses clés ;
 * - A_RELIER : le compte a déjà une identité, créée sur un autre appareil ;
 *   celui-ci doit lui être relié pour la recevoir ;
 * - INDISPONIBLE : l'annuaire n'a pas répondu, on réessaiera.
 */

enum class EtatChiffrement { PREPARATION, PRET, A_RELIER, INDISPONIBLE }

/** Clés uniques déposées par appareil : la réserve est refaite sous le seuil (CLES_UNIQUES côté web). */
private const val LOT_UNIQUES = 100
private const val SEUIL_UNIQUES = 40
private const val JOUR = 24 * 60 * 60 * 1000L
/** La clé signée change chaque mois ; l'ancienne reste lisible un mois de plus. */
private const val RENOUVELLEMENT_SIGNEE = 30 * JOUR
private const val CONSERVATION_SIGNEE = 60 * JOUR

class AppareilLocal(val numero: Int?, val jeton: ByteArray)

class ClesAppareil(private val api: UniChatApi, private val trousseau: Rangement, private val horloge: () -> Long = System::currentTimeMillis) {
    /** Un seul traitement à la fois touche aux clés : deux sessions avancées en même temps se désynchroniseraient. */
    val verrou = Mutex()

    fun identite(): IdentitePrivee? = trousseau.lire("identite")?.jsonObject?.let(::identitePriveeLue)

    fun appareil(): AppareilLocal? = trousseau.lire("appareil")?.jsonObject?.let { j ->
        AppareilLocal(j["numero"]?.jsonPrimitive?.intOrNull, depuisBase64(j["jeton"]!!.jsonPrimitive.content))
    }

    fun signees(): List<CleSignee> = trousseau.lire("signees")?.jsonArray?.map { cleSigneeLue(it.jsonObject) } ?: emptyList()

    private fun rangerAppareil(numero: Int?, jeton: ByteArray) = trousseau.ecrire("appareil", buildJsonObject {
        put("numero", numero?.let { JsonPrimitive(it) } ?: JsonNull)
        put("jeton", versBase64(jeton))
    })

    private fun rangerSignees(liste: List<CleSignee>) = trousseau.ecrire("signees", JsonArray(liste.map(::cleSigneeJson)))

    private fun versTransport(i: IdentitePrivee) =
        IdentiteEnvoyee(versBase64(i.signature.publique), versBase64(i.echange.publique), versBase64(i.preuve))

    private fun signeeTransport(c: CleSignee) = CleSigneeTransport(c.id, versBase64(c.paire.publique), versBase64(c.signature))

    private fun memeIdentite(locale: IdentitePrivee, distante: IdentiteCles) =
        versBase64(locale.signature.publique) == distante.signature && versBase64(locale.echange.publique) == distante.echange

    /** Au démarrage : l'appareil sait-il chiffrer, et ses réserves sont-elles pleines ? */
    suspend fun preparer(): EtatChiffrement = verrou.withLock {
        val etat = appel { api.etatCles() }.getOrElse { e ->
            if (e is ErreurServeur && e.statut == 401) throw e
            return@withLock EtatChiffrement.INDISPONIBLE
        }
        val identite = identite()
        val appareil = appareil()
        val reconnue = identite != null && etat.identite != null && memeIdentite(identite, etat.identite)

        etat.appareil?.let { serveur ->
            if (identite == null || appareil == null || !reconnue) return@withLock EtatChiffrement.A_RELIER
            // Inscription dont la réponse s'était perdue : on reprend le numéro attribué.
            if (appareil.numero == null) rangerAppareil(serveur.numero, appareil.jeton)
            else if (appareil.numero != serveur.numero) return@withLock EtatChiffrement.A_RELIER
            entretenir(identite, serveur)
            return@withLock EtatChiffrement.PRET
        }

        if (etat.identite == null) return@withLock inscrire(identite ?: creerIdentite())

        if (identite != null && reconnue && appareil?.numero != null) {
            return@withLock appel { api.reprendreCles(RepriseCles(appareil.numero, versBase64(appareil.jeton))) }.fold(
                onSuccess = { reprise ->
                    reprise.appareil?.let { entretenir(identite, it) }
                    EtatChiffrement.PRET
                },
                onFailure = { e ->
                    when {
                        e is ErreurServeur && e.code == "appareil_inconnu" -> EtatChiffrement.A_RELIER
                        e is ErreurServeur && e.statut == 401 -> throw e
                        else -> EtatChiffrement.INDISPONIBLE
                    }
                },
            )
        }
        EtatChiffrement.A_RELIER
    }

    /**
     * Clés neuves de l'appareil pour une identité : clé signée, réserve de
     * clés uniques, jeton de reprise. Rangées avant l'envoi : si la réponse
     * se perd, l'appareil retrouvera sa place.
     */
    private fun ranger(identite: IdentitePrivee): Pair<AppareilInscription, ByteArray> {
        val signee = creerCleSignee(identite, 1, horloge())
        val uniques = creerClesUniques(1, LOT_UNIQUES)
        val jeton = aleatoire(32)
        trousseau.vider()
        trousseau.ecrire("identite", identitePriveeJson(identite))
        rangerAppareil(null, jeton)
        rangerSignees(listOf(signee))
        trousseau.ecrire("prochaine-unique", JsonPrimitive(LOT_UNIQUES + 1))
        uniques.forEach { trousseau.ecrire("unique:${it.id}", cleUniqueJson(it)) }
        return AppareilInscription(signeeTransport(signee), uniques.map { CleUniqueTransport(it.id, versBase64(it.paire.publique)) }, versBase64(jeton)) to jeton
    }

    /** Premier appareil du compte : identité, clé signée, réserve de clés uniques. */
    private suspend fun inscrire(identite: IdentitePrivee): EtatChiffrement {
        val (appareil, jeton) = ranger(identite)
        return appel { api.inscrireCles(InscriptionCles(versTransport(identite), appareil)) }.fold(
            onSuccess = {
                rangerAppareil(it.appareil!!.numero, jeton)
                EtatChiffrement.PRET
            },
            onFailure = { e ->
                when {
                    // Un autre appareil a créé l'identité du compte entre-temps.
                    e is ErreurServeur && e.code == "identite_existante" -> EtatChiffrement.A_RELIER
                    e is ErreurServeur && e.statut == 401 -> throw e
                    else -> EtatChiffrement.INDISPONIBLE
                }
            },
        )
    }

    /** Appareil relié : il range l'identité reçue et s'inscrit au nom de la liaison. */
    suspend fun relier(canal: String, identite: IdentitePrivee): EtatChiffrement = verrou.withLock {
        val (appareil, jeton) = ranger(identite)
        val etat = appel { api.relierAppareil(AppareilRelie(canal, appareil)) }.getOrThrow()
        rangerAppareil(etat.appareil!!.numero, jeton)
        EtatChiffrement.PRET
    }

    /** Réserve de clés uniques refaite sous le seuil, clé signée renouvelée chaque mois. */
    private suspend fun entretenir(identite: IdentitePrivee, serveur: AppareilCles) {
        runCatching {
            if (serveur.clesUniques < SEUIL_UNIQUES) {
                val premier = trousseau.lire("prochaine-unique")?.jsonPrimitive?.long ?: 1L
                val uniques = creerClesUniques(premier, LOT_UNIQUES)
                uniques.forEach { trousseau.ecrire("unique:${it.id}", cleUniqueJson(it)) }
                trousseau.ecrire("prochaine-unique", JsonPrimitive(premier + LOT_UNIQUES))
                appel { api.ajouterClesUniques(EnvoiClesUniques(uniques.map { CleUniqueTransport(it.id, versBase64(it.paire.publique)) })) }.getOrThrow()
            }
            val maintenant = horloge()
            var signees = signees()
            var derniere = signees.lastOrNull()
            if (derniere == null || maintenant - derniere.creeeLe > RENOUVELLEMENT_SIGNEE) {
                derniere = creerCleSignee(identite, (derniere?.id ?: 0) + 1, maintenant)
                signees = signees + derniere
            }
            // Les anciennes restent le temps que les sessions ouvertes avec elles arrivent.
            signees = signees.filterIndexed { i, s -> i >= signees.size - 2 || maintenant - s.creeeLe < CONSERVATION_SIGNEE }
            rangerSignees(signees)
            if (derniere.id > serveur.cleSigneeId) appel { api.publierCleSignee(EnvoiCleSignee(signeeTransport(derniere))) }.getOrThrow()
        }.onFailure { e ->
            // Hors connexion : la réserve est encore suffisante, on refera au prochain démarrage.
            if (e is ErreurServeur && e.statut == 401) throw e
        }
    }
}
