package io.github.nandrianina02.unichat.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * Les jetons de couleur du web (apps/web/src/styles.css), repris tels quels :
 * l'appli et le site doivent se reconnaître au premier coup d'œil.
 */
@Immutable
data class Palette(
    val fond: Color,
    val panneau: Color,
    val entete: Color,
    val bordure: Color,
    val texte: Color,
    val texte2: Color,
    val texte3: Color,
    val primaire: Color,
    val primaireDoux: Color,
    val primaireTexte: Color,
    val surPrimaire: Color,
    val danger: Color,
)

val PaletteClaire = Palette(
    fond = Color(0xFFEFF1F5),
    panneau = Color(0xFFFFFFFF),
    entete = Color(0xFFF0F2F5),
    bordure = Color(0xFFE6E8EF),
    texte = Color(0xFF111827),
    texte2 = Color(0xFF5F6577),
    texte3 = Color(0xFF8A8FA0),
    primaire = Color(0xFF4F46E5),
    primaireDoux = Color(0xFFE0E7FF),
    primaireTexte = Color(0xFF3730A3),
    surPrimaire = Color(0xFFFFFFFF),
    danger = Color(0xFFE11D48),
)

val PaletteSombre = Palette(
    fond = Color(0xFF0C0D12),
    panneau = Color(0xFF12131A),
    entete = Color(0xFF1B1C25),
    bordure = Color(0xFF262733),
    texte = Color(0xFFE8E9F0),
    texte2 = Color(0xFF9A9CAE),
    texte3 = Color(0xFF6F7184),
    primaire = Color(0xFF6366F1),
    primaireDoux = Color(0xFF2A2960),
    primaireTexte = Color(0xFFC7D2FE),
    surPrimaire = Color(0xFFFFFFFF),
    danger = Color(0xFFFB7185),
)

val LocalPalette = staticCompositionLocalOf { PaletteClaire }

@Composable
fun ThemeUniChat(contenu: @Composable () -> Unit) {
    val p = if (isSystemInDarkTheme()) PaletteSombre else PaletteClaire
    val couleurs = if (isSystemInDarkTheme()) {
        darkColorScheme(primary = p.primaire, background = p.fond, surface = p.panneau, onBackground = p.texte, onSurface = p.texte)
    } else {
        lightColorScheme(primary = p.primaire, background = p.fond, surface = p.panneau, onBackground = p.texte, onSurface = p.texte)
    }
    androidx.compose.runtime.CompositionLocalProvider(LocalPalette provides p) {
        MaterialTheme(colorScheme = couleurs, content = contenu)
    }
}
