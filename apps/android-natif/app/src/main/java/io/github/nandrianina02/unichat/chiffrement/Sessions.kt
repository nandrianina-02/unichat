package io.github.nandrianina02.unichat.chiffrement

/*
 * Sessions avec un appareil distant, portées de session.ts. Comme dans
 * Signal, on en garde plusieurs : quand deux appareils s'écrivent pour la
 * première fois au même instant, chacun ouvre la sienne ; la plus récemment
 * utilisée devient l'active.
 */

class SessionChiffree(
    val ratchet: EtatRatchet,
    val ad: ByteArray,
    /** Clé éphémère de l'ouverture X3DH : elle reconnaît la session. */
    val ephemere: ByteArray,
    /** Tant que l'autre n'a pas répondu, chaque message rejoint l'ouverture. */
    val ouverture: OuvertureX3DH?,
    val identite: IdentitePublique,
)

/** Les sessions avec un appareil, l'active d'abord. */
class Correspondant(val sessions: List<SessionChiffree>)

const val SESSIONS_MAX = 5

private const val VERSION: Byte = 1
private const val TYPE_MESSAGE: Byte = 1
private const val TYPE_OUVERTURE: Byte = 2
private const val TAILLE_OUVERTURE = TAILLE_CLE * 3 + TAILLE_SIGNATURE + 8

/** Clés de l'appareil qui reçoit : il les retrouve par leur numéro. */
class ClesLocales(
    val identite: IdentitePrivee,
    val cleSignee: (Long) -> CleSignee?,
    val cleUnique: (Long) -> CleUnique?,
)

class Dechiffre(
    val correspondant: Correspondant,
    val clair: ByteArray,
    /** Identité de l'expéditeur : à comparer à celle déjà connue (changement de clés). */
    val identite: IdentitePublique,
    /** Clé unique consommée par cette ouverture : à effacer une fois la session rangée. */
    val cleUniqueUtilisee: Long,
    val nouvelleSession: Boolean,
)

class Chiffre(val correspondant: Correspondant, val message: ByteArray)

private fun encoderOuverture(o: OuvertureX3DH) =
    assembler(o.identite.signature, o.identite.echange, o.identite.preuve, o.ephemere, entier32(o.cleSigneeId), entier32(o.cleUniqueId))

private fun lireOuverture(octets: ByteArray, d: Int): OuvertureX3DH {
    if (octets.size < d + TAILLE_OUVERTURE) throw IllegalArgumentException("Message tronqué.")
    fun tranche(debut: Int, taille: Int) = octets.tranche(d + debut, d + debut + taille)
    return OuvertureX3DH(
        IdentitePublique(tranche(0, 32), tranche(32, 32), tranche(64, 64)),
        tranche(128, 32),
        lireEntier32(octets, d + 160),
        lireEntier32(octets, d + 164),
    )
}

/**
 * Chiffre pour un appareil. Sans session active, il faut son paquet de clés
 * (demandé au serveur) : la session s'ouvre par X3DH.
 */
fun chiffrer(correspondant: Correspondant?, moi: IdentitePrivee, clair: ByteArray, paquet: Paquet? = null): Chiffre {
    var sessions = correspondant?.sessions ?: emptyList()
    var active = sessions.firstOrNull()
    if (active?.ratchet?.cks == null) {
        if (paquet == null) throw IllegalStateException("Aucune session avec cet appareil : son paquet de clés est nécessaire.")
        val (secret, ouverture) = ouvrirX3DH(moi, paquet)
        active = SessionChiffree(initierEmetteur(secret.sk, paquet.cleSignee.cle), secret.ad, ouverture.ephemere, ouverture, paquet.identite)
        sessions = (listOf(active) + sessions).take(SESSIONS_MAX)
    }
    val r = chiffrerRatchet(active.ratchet, clair, active.ad)
    val suite = SessionChiffree(r.etat, active.ad, active.ephemere, active.ouverture, active.identite)
    val message = if (suite.ouverture != null) {
        assembler(byteArrayOf(VERSION, TYPE_OUVERTURE), encoderOuverture(suite.ouverture), r.entete, r.chiffre)
    } else {
        assembler(byteArrayOf(VERSION, TYPE_MESSAGE), r.entete, r.chiffre)
    }
    return Chiffre(Correspondant(listOf(suite) + sessions.drop(1)), message)
}

fun dechiffrer(correspondant: Correspondant?, message: ByteArray, cles: ClesLocales): Dechiffre {
    if (message.size < 2 || message[0] != VERSION) throw IllegalArgumentException("Version de message inconnue.")
    val sessions = correspondant?.sessions ?: emptyList()

    if (message[1] == TYPE_OUVERTURE) {
        val o = lireOuverture(message, 2)
        if (!verifierIdentite(o.identite)) throw IllegalArgumentException("Identité de l'expéditeur invalide.")
        val debut = 2 + TAILLE_OUVERTURE
        val entete = message.tranche(debut, minOf(debut + TAILLE_ENTETE, message.size))
        val chiffre = message.tranche(minOf(debut + TAILLE_ENTETE, message.size))
        // L'émetteur n'a pas encore eu de réponse : la session existe déjà ici.
        val connue = sessions.indexOfFirst { egaux(it.ephemere, o.ephemere) }
        if (connue >= 0) return dechiffrerSur(sessions, connue, entete, chiffre)

        val cleSignee = cles.cleSignee(o.cleSigneeId) ?: throw IllegalArgumentException("Clé signée inconnue ou trop ancienne.")
        val cleUnique = if (o.cleUniqueId != 0L) cles.cleUnique(o.cleUniqueId) else null
        if (o.cleUniqueId != 0L && cleUnique == null) throw IllegalArgumentException("Clé unique déjà utilisée.")
        val secret = accepterX3DH(cles.identite, cleSignee, cleUnique, o)
        val r = dechiffrerRatchet(initierRecepteur(secret.sk, cleSignee.paire), entete, chiffre, secret.ad)
        val nouvelle = SessionChiffree(r.etat, secret.ad, o.ephemere, null, o.identite)
        return Dechiffre(Correspondant((listOf(nouvelle) + sessions).take(SESSIONS_MAX)), r.clair, o.identite, o.cleUniqueId, true)
    }

    if (message[1] != TYPE_MESSAGE) throw IllegalArgumentException("Type de message inconnu.")
    val entete = message.tranche(2, minOf(2 + TAILLE_ENTETE, message.size))
    val chiffre = message.tranche(minOf(2 + TAILLE_ENTETE, message.size))
    var raison = "aucune session avec cet appareil"
    for (i in sessions.indices) {
        try {
            return dechiffrerSur(sessions, i, entete, chiffre)
        } catch (e: Exception) {
            // On essaie la session suivante ; la raison retenue est celle de l'active.
            if (i == 0) raison = e.message ?: e.toString()
        }
    }
    throw IllegalArgumentException("Message indéchiffrable : $raison")
}

private fun dechiffrerSur(sessions: List<SessionChiffree>, i: Int, entete: ByteArray, chiffre: ByteArray): Dechiffre {
    val session = sessions[i]
    val r = dechiffrerRatchet(session.ratchet, entete, chiffre, session.ad)
    // Un message reçu sur la session prouve que l'autre l'a : plus besoin de l'ouverture.
    val suite = SessionChiffree(r.etat, session.ad, session.ephemere, null, session.identite)
    return Dechiffre(Correspondant(listOf(suite) + sessions.filterIndexed { j, _ -> j != i }), r.clair, session.identite, 0, false)
}

/** Clés locales que réclame un message d'ouverture, lues avant de déchiffrer ; null pour un message ordinaire. */
fun exigencesOuverture(message: ByteArray): Pair<Long, Long>? {
    if (message.size < 2 + TAILLE_OUVERTURE || message[0] != VERSION || message[1] != TYPE_OUVERTURE) return null
    val o = lireOuverture(message, 2)
    return o.cleSigneeId to o.cleUniqueId
}
