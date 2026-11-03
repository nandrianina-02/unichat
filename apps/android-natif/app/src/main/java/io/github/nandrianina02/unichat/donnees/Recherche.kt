package io.github.nandrianina02.unichat.donnees

/*
 * Règles reprises de packages/shared (profil.ts, temps-reel.ts) : l'appli
 * ne lance une recherche que lorsque le serveur pourrait y répondre.
 */

private const val PSEUDO_MIN = 3
private const val PSEUDO_MAX = 30
private val PSEUDO = Regex("^[a-z][a-z0-9._]*$")
private val EMAIL = Regex("""^[^\s@]+@[^\s@]+\.[^\s@]+$""")

/**
 * Vrai pour un nom d'utilisateur complet (avec ou sans @) ou une adresse
 * e-mail entière. UniChat ne propose pas de résultats partiels : on ne
 * devine pas qui est inscrit à partir de quelques lettres.
 */
fun rechercheValide(brute: String): Boolean {
    val texte = brute.trim().lowercase()
    if (texte.isEmpty() || texte.length > 254) return false
    if ('@' in texte && !texte.startsWith("@")) return EMAIL.matches(texte)
    val pseudo = texte.removePrefix("@")
    return pseudo.length in PSEUDO_MIN..PSEUDO_MAX && PSEUDO.matches(pseudo) && ".." !in pseudo && !pseudo.endsWith(".")
}

/** Identifiant d'une discussion à deux (conversationDirecte) : le même quel que soit celui qui écrit. */
fun conversationDirecte(a: String, b: String): String {
    val (x, y) = listOf(a, b).sorted()
    return "d:$x:$y"
}
