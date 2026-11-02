package io.github.nandrianina02.unichat.donnees

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Tout ce qui appartient à un compte sur l'appareil : son trousseau, sa
 * base, ses clés, son temps réel. Comme sur le web (une base par compte),
 * deux comptes qui se succèdent sur le téléphone ne se mélangent pas, et se
 * déconnecter ne fait que fermer la session : les discussions restent.
 */
class EspaceCompte(
    contexte: Context,
    reseau: Reseau,
    serveur: String,
    val session: Session,
    val moi: String,
    portee: CoroutineScope,
) {
    private val trousseau = Trousseau(contexte, moi)
    val base = Base(contexte, moi)
    val cles = ClesAppareil(reseau.api, trousseau)
    val annuaire = Annuaire(reseau.api, base)
    val liaison = LiaisonAppareil(reseau.api, cles, base)
    val messagerie = Messagerie(
        reseau.client, serveur, cles, Dechiffreur(cles, trousseau, moi), base, moi, portee,
        surSessionFermee = { session.oublier() },
        sessionValide = { session.connecte { reseau.api.moi() }.isSuccess },
    ).also { it.rafraichirGroupes = { annuaire.rafraichirGroupes() } }

    private val _chiffrement = MutableStateFlow(EtatChiffrement.PREPARATION)
    val chiffrement: StateFlow<EtatChiffrement> = _chiffrement.asStateFlow()

    /**
     * Les clés d'abord, le temps réel ensuite : un appareil sans clés qui
     * accuserait réception du journal perdrait des messages qu'il ne peut
     * pas lire (seul l'historique transmis à la liaison les lui rendrait).
     */
    suspend fun preparer() {
        _chiffrement.value = EtatChiffrement.PREPARATION
        val etat = try {
            cles.preparer()
        } catch (e: ErreurServeur) {
            if (e.statut == 401) session.oublier()
            EtatChiffrement.INDISPONIBLE
        }
        _chiffrement.value = etat
        if (etat == EtatChiffrement.PRET) {
            messagerie.demarrer()
            annuaire.rafraichirGroupes()
        }
    }

    fun fermer() = messagerie.arreter()
}
