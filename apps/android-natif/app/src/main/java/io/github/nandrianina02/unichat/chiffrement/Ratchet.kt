package io.github.nandrianina02.unichat.chiffrement

/*
 * Double Ratchet, porté de ratchet.ts (signal.org/docs/specifications/
 * doubleratchet). Chaque message a sa propre clé, oubliée sitôt servie.
 * L'état est une donnée simple : l'appelant le range et le remplace après
 * chaque opération ; un échec laisse l'état d'origine intact.
 */

class EtatRatchet(
    /** Ma paire de ratchet du moment. */
    var dhs: Paire,
    /** La clé de ratchet de l'autre, inconnue tant qu'il n'a rien envoyé. */
    var dhr: ByteArray?,
    var rk: ByteArray,
    var cks: ByteArray?,
    var ckr: ByteArray?,
    var ns: Long,
    var nr: Long,
    var pn: Long,
    /** Clés de messages sautés (arrivés dans le désordre), par « clé de ratchet en hexadécimal:numéro ». */
    val sautees: MutableMap<String, ByteArray>,
    /** Ordre d'arrivée des clés sautées : les plus anciennes partent en premier. */
    val ordre: MutableList<String>,
) {
    /** Copie profonde : un déchiffrement qui échoue ne touche pas l'état d'origine. */
    fun copie() = EtatRatchet(
        Paire(dhs.secrete.copyOf(), dhs.publique.copyOf()), dhr?.copyOf(), rk.copyOf(), cks?.copyOf(), ckr?.copyOf(),
        ns, nr, pn, LinkedHashMap(sautees.mapValues { it.value.copyOf() }), ordre.toMutableList(),
    )
}

class EnTeteRatchet(val dh: ByteArray, val pn: Long, val n: Long)

/** Messages qu'une chaîne peut sauter d'un coup : au-delà, c'est une attaque ou une perte massive. */
const val SAUT_MAX = 1000L
/** Clés sautées gardées en tout, toutes chaînes confondues. */
const val SAUTEES_MAX = 2000
const val TAILLE_ENTETE = TAILLE_CLE + 8

private const val INFO_RACINE = "UniChat-ratchet-v1"
private const val INFO_MESSAGE = "UniChat-message-v1"
private val SEL_NUL = ByteArray(32)
private val GRAINE_MESSAGE = byteArrayOf(1)
private val GRAINE_CHAINE = byteArrayOf(2)

private fun kdfRacine(rk: ByteArray, dh: ByteArray): Pair<ByteArray, ByteArray> {
    val sortie = deriver(dh, rk, INFO_RACINE, 64)
    return sortie.tranche(0, 32) to sortie.tranche(32)
}

private fun kdfChaine(ck: ByteArray) = authentifier(ck, GRAINE_CHAINE) to authentifier(ck, GRAINE_MESSAGE)

/** Clé AES et nonce tirés de la clé de message : chacune ne sert qu'une fois. */
private fun cleEtNonce(mk: ByteArray): Pair<ByteArray, ByteArray> {
    val sortie = deriver(mk, SEL_NUL, INFO_MESSAGE, 44)
    return sortie.tranche(0, 32) to sortie.tranche(32)
}

fun encoderEnTete(e: EnTeteRatchet) = assembler(e.dh, entier32(e.pn), entier32(e.n))

fun lireEnTete(octets: ByteArray, decalage: Int = 0): EnTeteRatchet {
    if (octets.size < decalage + TAILLE_ENTETE) throw IllegalArgumentException("Message tronqué.")
    return EnTeteRatchet(
        octets.tranche(decalage, decalage + TAILLE_CLE),
        lireEntier32(octets, decalage + TAILLE_CLE),
        lireEntier32(octets, decalage + TAILLE_CLE + 4),
    )
}

/** Celui qui ouvre la session (après X3DH) : il connaît déjà la clé signée de l'autre. */
fun initierEmetteur(sk: ByteArray, cleSigneeDistante: ByteArray): EtatRatchet {
    val dhs = paireEchange()
    val (rk, cks) = kdfRacine(sk, echanger(dhs.secrete, cleSigneeDistante))
    return EtatRatchet(dhs, cleSigneeDistante, rk, cks, null, 0, 0, 0, LinkedHashMap(), mutableListOf())
}

/** Celui qui reçoit la session : sa clé signée sert de première clé de ratchet. */
fun initierRecepteur(sk: ByteArray, cleSignee: Paire): EtatRatchet =
    EtatRatchet(cleSignee, null, sk, null, null, 0, 0, 0, LinkedHashMap(), mutableListOf())

class ChiffreRatchet(val etat: EtatRatchet, val entete: ByteArray, val chiffre: ByteArray)

fun chiffrerRatchet(etat: EtatRatchet, clair: ByteArray, associe: ByteArray): ChiffreRatchet {
    val cksActuelle = etat.cks ?: throw IllegalStateException("Session pas encore prête à envoyer.")
    val suivant = etat.copie()
    val (cks, mk) = kdfChaine(cksActuelle)
    suivant.cks = cks
    val entete = encoderEnTete(EnTeteRatchet(suivant.dhs.publique, suivant.pn, suivant.ns))
    suivant.ns += 1
    val (cle, nonce) = cleEtNonce(mk)
    return ChiffreRatchet(suivant, entete, chiffrerAead(cle, nonce, clair, assembler(associe, entete)))
}

class ClairRatchet(val etat: EtatRatchet, val clair: ByteArray)

/**
 * Déchiffre sur une copie de l'état : si l'authentification échoue, rien
 * n'a bougé (sinon un message forgé suffirait à désynchroniser la session).
 */
fun dechiffrerRatchet(etat: EtatRatchet, enteteOctets: ByteArray, chiffre: ByteArray, associe: ByteArray): ClairRatchet {
    val entete = lireEnTete(enteteOctets)
    val suivant = etat.copie()
    val aad = assembler(associe, enteteOctets)

    val repere = "${versHex(entete.dh)}:${entete.n}"
    suivant.sautees[repere]?.let { sautee ->
        val (cle, nonce) = cleEtNonce(sautee)
        val clair = dechiffrerAead(cle, nonce, chiffre, aad)
        suivant.sautees.remove(repere)
        suivant.ordre.remove(repere)
        return ClairRatchet(suivant, clair)
    }

    val dhr = suivant.dhr
    if (dhr == null || versHex(entete.dh) != versHex(dhr)) {
        sauter(suivant, entete.pn)
        // Pas de ratchet DH sans clé de l'autre : premier message reçu.
        suivant.pn = suivant.ns
        suivant.ns = 0
        suivant.nr = 0
        suivant.dhr = entete.dh
        kdfRacine(suivant.rk, echanger(suivant.dhs.secrete, entete.dh)).let { (rk, ckr) ->
            suivant.rk = rk
            suivant.ckr = ckr
        }
        suivant.dhs = paireEchange()
        kdfRacine(suivant.rk, echanger(suivant.dhs.secrete, entete.dh)).let { (rk, cks) ->
            suivant.rk = rk
            suivant.cks = cks
        }
    }
    sauter(suivant, entete.n)
    if (entete.n < suivant.nr) throw IllegalArgumentException("Message déjà reçu.")
    val (ckr, mk) = kdfChaine(suivant.ckr!!)
    suivant.ckr = ckr
    suivant.nr += 1
    val (cle, nonce) = cleEtNonce(mk)
    return ClairRatchet(suivant, dechiffrerAead(cle, nonce, chiffre, aad))
}

private fun sauter(etat: EtatRatchet, jusqua: Long) {
    if (etat.ckr == null) return
    if (jusqua - etat.nr > SAUT_MAX) throw IllegalArgumentException("Trop de messages manquants.")
    while (etat.nr < jusqua) {
        val (ckr, mk) = kdfChaine(etat.ckr!!)
        etat.ckr = ckr
        val repere = "${versHex(etat.dhr!!)}:${etat.nr}"
        etat.sautees[repere] = mk
        etat.ordre += repere
        etat.nr += 1
    }
    while (etat.ordre.size > SAUTEES_MAX) etat.sautees.remove(etat.ordre.removeAt(0))
}
