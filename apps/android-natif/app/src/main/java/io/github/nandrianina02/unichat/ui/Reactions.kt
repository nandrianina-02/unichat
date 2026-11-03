package io.github.nandrianina02.unichat.ui

import io.github.nandrianina02.unichat.R

/** Une réaction telle qu'elle s'affiche : un pictogramme, pas un emoji (comme Reactions.tsx du web). */
class ReactionAffichee(val code: String, val icone: Int, val libelle: String)

/** Dans l'ordre de REACTIONS (packages/shared) : la barre de choix et les pastilles suivent le même ordre partout. */
val REACTIONS = listOf(
    ReactionAffichee("pouce", R.drawable.lucide_thumbs_up, "J'aime"),
    ReactionAffichee("coeur", R.drawable.lucide_heart, "J'adore"),
    ReactionAffichee("rire", R.drawable.lucide_laugh, "Drôle"),
    ReactionAffichee("bravo", R.drawable.lucide_party_popper, "Bravo"),
    ReactionAffichee("triste", R.drawable.lucide_frown, "Triste"),
    ReactionAffichee("merci", R.drawable.lucide_hand_heart, "Merci"),
)
