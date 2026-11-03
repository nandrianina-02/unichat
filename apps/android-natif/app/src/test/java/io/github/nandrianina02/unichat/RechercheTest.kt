package io.github.nandrianina02.unichat

import io.github.nandrianina02.unichat.donnees.conversationDirecte
import io.github.nandrianina02.unichat.donnees.rechercheValide
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mêmes règles que lireRecherche et conversationDirecte (packages/shared). */
class RechercheTest {
    @Test
    fun noms_utilisateur_et_adresses_completes_acceptes() {
        assertTrue(rechercheValide("@ana.rakoto"))
        assertTrue(rechercheValide("ana_rakoto"))
        assertTrue(rechercheValide("  Ana.Rakoto  "))
        assertTrue(rechercheValide("ana@exemple.mg"))
    }

    @Test
    fun saisies_partielles_refusees() {
        assertFalse(rechercheValide(""))
        assertFalse(rechercheValide("an"))
        assertFalse(rechercheValide("1ana"))
        assertFalse(rechercheValide("ana..rakoto"))
        assertFalse(rechercheValide("ana."))
        assertFalse(rechercheValide("ana@"))
        assertFalse(rechercheValide("ana@exemple"))
        assertFalse(rechercheValide("a".repeat(31)))
    }

    @Test
    fun discussion_identique_quel_que_soit_l_ordre() {
        val a = "8f14e45f-ceea-467a-9575-0bb2b8e1a7d1"
        val b = "1679091c-5a88-4faf-afb6-e1a2b1c3d4e5"
        assertEquals("d:$b:$a", conversationDirecte(a, b))
        assertEquals(conversationDirecte(a, b), conversationDirecte(b, a))
    }
}
