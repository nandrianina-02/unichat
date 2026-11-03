package io.github.nandrianina02.unichat

import io.github.nandrianina02.unichat.donnees.dernierePubliee
import io.github.nandrianina02.unichat.donnees.plusRecente
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MiseAJourTest {
    @Test
    fun versions_comparees_chiffre_par_chiffre() {
        assertTrue(plusRecente("2.10.0", "2.9.1"))
        assertTrue(plusRecente("3.0", "2.99.99"))
        assertFalse(plusRecente("2.8.0", "2.8.0"))
        assertFalse(plusRecente("2.7.9", "2.8.0"))
    }

    private fun publication(tag: String, apk: String = "unichat.apk", prerelease: Boolean = false) =
        """{"tag_name":"$tag","draft":false,"prerelease":$prerelease,"assets":[{"name":"$apk","browser_download_url":"https://exemple/$tag/$apk","size":11828010}]}"""

    @Test
    fun seule_la_plus_recente_version_native_publiee_compte() {
        val json = "[" + listOf(
            publication("natif-v2.9.0-essai", "unichat-essai.apk", prerelease = true),
            publication("natif-v2.8.0"),
            publication("android-v9.0.0"),
            publication("natif-v2.10.0"),
            publication("natif-v3.0.0", "autre.apk"),
        ).joinToString(",") + "]"
        val v = dernierePubliee(json)!!
        assertEquals("2.10.0", v.version)
        assertEquals("https://exemple/natif-v2.10.0/unichat.apk", v.adresse)
        assertEquals(11.28, v.tailleMo!!, 0.01)
    }

    @Test
    fun rien_a_proposer() {
        assertNull(dernierePubliee("[]"))
        assertNull(dernierePubliee("pas du json"))
        assertNull(dernierePubliee("[" + publication("android-v1.0.0") + "]"))
    }
}
