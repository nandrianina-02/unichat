package io.github.nandrianina02.unichat.donnees

/*
 * Règles reprises de packages/shared (profil.ts, temps-reel.ts) : l'appli
 * ne lance une recherche que lorsque le serveur pourrait y répondre.
 */

private const val PSEUDO_MIN = 3
private const val PSEUDO_MAX = 30
private val PSEUDO = Regex("^[a-z][a-z0-9._]*$")
private val EMAIL = Regex("""^[^\s@]+@[^\s@]+\.[^\s@]+$""")

/** 032 et 037 Orange, 033 Airtel, 034 et 038 Yas, 039 : les mobiles que Mess sait joindre. */
private val PREFIXES_MOBILES = setOf("32", "33", "34", "37", "38", "39")

/** « 034 12 345 67 », « +261 34 12 345 67 »… deviennent « +261341234567 » ; null sinon (telephone.ts). */
fun normaliserTelephone(brut: String): String? {
    val c = brut.filterNot { it.isWhitespace() || it in ".-()" }
    val local = when {
        Regex("""^\+261\d{9}$""").matches(c) -> c.drop(4)
        Regex("""^00261\d{9}$""").matches(c) -> c.drop(5)
        Regex("""^261\d{9}$""").matches(c) -> c.drop(3)
        Regex("""^0\d{9}$""").matches(c) -> c.drop(1)
        else -> return null
    }
    return if (local.take(2) in PREFIXES_MOBILES) "+261$local" else null
}

/** « 034 12 345 67 », la forme qu'on écrit à Madagascar. */
fun afficherTelephone(numero: String): String {
    val l = numero.drop(4)
    if (l.length != 9) return numero
    return "0${l.substring(0, 2)} ${l.substring(2, 4)} ${l.substring(4, 7)} ${l.substring(7)}"
}

/**
 * Vrai pour un nom d'utilisateur complet (avec ou sans @), une adresse
 * e-mail entière ou un numéro de mobile malgache. UniChat ne propose pas de
 * résultats partiels : on ne devine pas qui est inscrit à partir de
 * quelques lettres.
 */
fun rechercheValide(brute: String): Boolean {
    val texte = brute.trim().lowercase()
    if (texte.isEmpty() || texte.length > 254) return false
    // Un nom d'utilisateur commence par une lettre : un chiffre ou « + » annonce un numéro.
    if (texte.first().isDigit() || texte.first() == '+') return normaliserTelephone(texte) != null
    if ('@' in texte && !texte.startsWith("@")) return EMAIL.matches(texte)
    val pseudo = texte.removePrefix("@")
    return pseudo.length in PSEUDO_MIN..PSEUDO_MAX && PSEUDO.matches(pseudo) && ".." !in pseudo && !pseudo.endsWith(".")
}

/** Identifiant d'une discussion à deux (conversationDirecte) : le même quel que soit celui qui écrit. */
fun conversationDirecte(a: String, b: String): String {
    val (x, y) = listOf(a, b).sorted()
    return "d:$x:$y"
}
