package io.github.nandrianina02.unichat

import io.github.nandrianina02.unichat.donnees.afficherTelephone
import io.github.nandrianina02.unichat.donnees.conversationDirecte
import io.github.nandrianina02.unichat.donnees.normaliserTelephone
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
    fun numeros_malgaches_acceptes_et_normalises() {
        assertTrue(rechercheValide("034 12 345 67"))
        assertTrue(rechercheValide("+261 33 38 369 82"))
        assertFalse(rechercheValide("0612345678"))
        assertFalse(rechercheValide("034 12"))
        assertEquals("+261341234567", normaliserTelephone("034.12.345.67"))
        assertEquals("+261333836982", normaliserTelephone("00261333836982"))
        assertEquals(null, normaliserTelephone("0351234567"))
        assertEquals("034 12 345 67", afficherTelephone("+261341234567"))
    }

    @Test
    fun discussion_identique_quel_que_soit_l_ordre() {
        val a = "8f14e45f-ceea-467a-9575-0bb2b8e1a7d1"
        val b = "1679091c-5a88-4faf-afb6-e1a2b1c3d4e5"
        assertEquals("d:$b:$a", conversationDirecte(a, b))
        assertEquals(conversationDirecte(a, b), conversationDirecte(b, a))
    }
}
