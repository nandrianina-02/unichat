package io.github.nandrianina02.unichat.chiffrement

/*
 * Identité d'un compte et clés d'appareil, portées de identite.ts : une clé
 * de signature Ed25519 et une clé d'échange X25519 signée par la première,
 * partagées par tous les appareils du compte ; chaque appareil publie en
 * plus une clé signée et des clés à usage unique, comme dans X3DH.
 */

class IdentitePrivee(val signature: Paire, val echange: Paire, val preuve: ByteArray) {
    fun publique() = IdentitePublique(signature.publique, echange.publique, preuve)
}

class IdentitePublique(val signature: ByteArray, val echange: ByteArray, val preuve: ByteArray)

class CleSignee(val id: Long, val paire: Paire, val signature: ByteArray, val creeeLe: Long) {
    fun publique() = CleSigneePublique(id, paire.publique, signature)
}

class CleSigneePublique(val id: Long, val cle: ByteArray, val signature: ByteArray)

class CleUnique(val id: Long, val paire: Paire) {
    fun publique() = CleUniquePublique(id, paire.publique)
}

class CleUniquePublique(val id: Long, val cle: ByteArray)

/** Ce qu'il faut pour ouvrir une session avec un appareil. */
class Paquet(val identite: IdentitePublique, val cleSignee: CleSigneePublique, val cleUnique: CleUniquePublique? = null)

// Étiquettes de séparation : une signature produite pour un usage ne peut pas être présentée pour un autre.
private val ETIQUETTE_IDENTITE = texteVersOctets("UniChat-identite-v1")
private val ETIQUETTE_CLE_SIGNEE = texteVersOctets("UniChat-cle-signee-v1")

fun creerIdentite(): IdentitePrivee {
    val signature = paireSignature()
    val echange = paireEchange()
    return IdentitePrivee(signature, echange, signer(assembler(ETIQUETTE_IDENTITE, echange.publique), signature.secrete))
}

/** Une identité reçue en secrets seulement : les clés publiques sont recalculées. */
fun identiteDepuisSecrets(signature: ByteArray, echange: ByteArray, preuve: ByteArray) =
    IdentitePrivee(Paire(signature, publiqueSignature(signature)), Paire(echange, publiqueEchange(echange)), preuve)

fun verifierIdentite(i: IdentitePublique): Boolean =
    i.signature.size == TAILLE_CLE &&
        i.echange.size == TAILLE_CLE &&
        i.preuve.size == TAILLE_SIGNATURE &&
        verifierSignature(i.preuve, assembler(ETIQUETTE_IDENTITE, i.echange), i.signature)

fun memeIdentite(a: IdentitePublique, b: IdentitePublique) = egaux(a.signature, b.signature) && egaux(a.echange, b.echange)

/** Les deux clés publiques bout à bout : ce qui désigne l'identité dans les calculs. */
fun encoderIdentite(i: IdentitePublique) = assembler(i.signature, i.echange)

fun creerCleSignee(identite: IdentitePrivee, id: Long, maintenant: Long): CleSignee {
    val paire = paireEchange()
    return CleSignee(id, paire, signer(assembler(ETIQUETTE_CLE_SIGNEE, entier32(id), paire.publique), identite.signature.secrete), maintenant)
}

fun verifierCleSignee(identite: IdentitePublique, c: CleSigneePublique): Boolean =
    c.cle.size == TAILLE_CLE && verifierSignature(c.signature, assembler(ETIQUETTE_CLE_SIGNEE, entier32(c.id), c.cle), identite.signature)

/** Clés à usage unique, numérotées à partir de `premier` (le numéro 0 veut dire « aucune »). */
fun creerClesUniques(premier: Long, nombre: Int): List<CleUnique> {
    if (premier < 1) throw IllegalArgumentException("Les clés uniques sont numérotées à partir de 1.")
    return List(nombre) { CleUnique(premier + it, paireEchange()) }
}

/** Un paquet n'est utilisable que si l'identité se prouve et signe bien la clé de l'appareil. */
fun verifierPaquet(p: Paquet): Boolean =
    verifierIdentite(p.identite) &&
        verifierCleSignee(p.identite, p.cleSignee) &&
        (p.cleUnique == null || (p.cleUnique.id >= 1 && p.cleUnique.cle.size == TAILLE_CLE))
