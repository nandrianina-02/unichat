package io.github.nandrianina02.unichat.chiffrement

/*
 * X3DH, porté de x3dh.ts (signal.org/docs/specifications/x3dh) : deux
 * appareils conviennent d'un secret à partir du paquet de clés déposé sur le
 * serveur. L'identité porte deux clés (Ed25519, X25519) au lieu d'une seule
 * clé XEdDSA.
 */

/** Ce que l'émetteur joint à ses premiers messages pour que l'autre retrouve le secret. */
class OuvertureX3DH(
    val identite: IdentitePublique,
    /** Clé éphémère de l'émetteur : elle désigne la session de façon unique. */
    val ephemere: ByteArray,
    val cleSigneeId: Long,
    /** 0 : le serveur n'avait plus de clé unique à donner. */
    val cleUniqueId: Long,
)

class SecretX3DH(val sk: ByteArray, val ad: ByteArray)

private const val INFO = "UniChat-X3DH-v1"
private val PREFIXE = ByteArray(32) { 0xff.toByte() }
private val SEL = ByteArray(32)

private fun secret(dh: List<ByteArray>) = deriver(assembler(PREFIXE, *dh.toTypedArray()), SEL, INFO, 32)

/** Données associées : les deux identités, liées à chaque message de la session. */
fun associeX3DH(emetteur: IdentitePublique, recepteur: IdentitePublique) = assembler(encoderIdentite(emetteur), encoderIdentite(recepteur))

fun ouvrirX3DH(moi: IdentitePrivee, paquet: Paquet, ephemere: Paire = paireEchange()): Pair<SecretX3DH, OuvertureX3DH> {
    if (!verifierPaquet(paquet)) throw IllegalArgumentException("Paquet de clés invalide : signature incorrecte.")
    val dh = mutableListOf(
        echanger(moi.echange.secrete, paquet.cleSignee.cle),
        echanger(ephemere.secrete, paquet.identite.echange),
        echanger(ephemere.secrete, paquet.cleSignee.cle),
    )
    paquet.cleUnique?.let { dh += echanger(ephemere.secrete, it.cle) }
    val identite = moi.publique()
    return SecretX3DH(secret(dh), associeX3DH(identite, paquet.identite)) to
        OuvertureX3DH(identite, ephemere.publique, paquet.cleSignee.id, paquet.cleUnique?.id ?: 0)
}

fun accepterX3DH(moi: IdentitePrivee, cleSignee: CleSignee, cleUnique: CleUnique?, o: OuvertureX3DH): SecretX3DH {
    val dh = mutableListOf(
        echanger(cleSignee.paire.secrete, o.identite.echange),
        echanger(moi.echange.secrete, o.ephemere),
        echanger(cleSignee.paire.secrete, o.ephemere),
    )
    cleUnique?.let { dh += echanger(it.paire.secrete, o.ephemere) }
    return SecretX3DH(secret(dh), associeX3DH(o.identite, moi.publique()))
}
