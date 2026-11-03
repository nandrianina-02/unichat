package io.github.nandrianina02.unichat.donnees

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.min

enum class EtatConnexion { HORS_LIGNE, CONNEXION, CONNECTE }

/** En ligne, ou vu pour la dernière fois (null : la personne ne le montre pas). */
data class Presence(val enLigne: Boolean, val vuLe: Long?)

/**
 * Fin des messages en clair (FIN_DU_CLAIR, packages/shared) : un contenu en
 * clair daté d'après ne vient d'aucun appareil, le serveur refuse ces
 * trames ; il ne pourrait venir que du serveur lui-même.
 */
const val FIN_DU_CLAIR = 1_793_664_000_000L
private val CONTENUS_EN_CLAIR = setOf("message", "reaction", "suppression", "modification", "epingle", "ephemere", "vote", "ouvert")
/** Code de fermeture : la session de l'appareil n'est plus valable (FERMETURE_SESSION). */
private const val FERMETURE_SESSION = 4001
private const val INTERVALLE_PING = 25_000L
private const val DELAI_MODIFICATION = 15 * 60 * 1000L
/** « En train d'écrire » s'efface sans nouveau signal (DUREE_ECRIT du web). */
private const val DUREE_ECRIT = 5000L
/** Rechiffrements après un refus « appareils » : au-delà, la liste ne se stabilise pas. */
private const val TENTATIVES_MAX = 2
private val RANG = mapOf("echec" to -1, "attente" to 0, "envoye" to 1, "remis" to 2, "lu" to 3)

/**
 * Le temps réel, porté d'apps/web/src/lib/messagerie.ts. À la réception,
 * la boîte du compte remet son journal par lots ; chaque entrée est ouverte
 * (enveloppe chiffrée), appliquée à la base, puis acquittée. Le serveur
 * efface ce que tous les appareils ont reçu. À l'envoi, le message est
 * rangé « en attente », chiffré pour chaque appareil, puis confirmé par le
 * serveur (accepte) ou refusé avec la raison.
 */
class Messagerie(
    private val client: OkHttpClient,
    private val serveur: String,
    private val cles: ClesAppareil,
    private val dechiffreur: Dechiffreur,
    private val chiffreur: Chiffreur,
    private val annuaire: Annuaire,
    private val base: Base,
    private val moi: String,
    private val portee: CoroutineScope,
    private val surSessionFermee: () -> Unit,
    private val sessionValide: suspend () -> Boolean,
) {
    private val _connexion = MutableStateFlow(EtatConnexion.HORS_LIGNE)
    val connexion: StateFlow<EtatConnexion> = _connexion.asStateFlow()

    private var ws: WebSocket? = null
    private var arretee = true
    private var tentative = 0
    private var seq: Long? = base.reglage("seq")?.toLongOrNull()
    private var ping: Job? = null
    private var accuse: Job? = null
    private var reconnexion: Job? = null
    /** Un envoi en route (message ou action) : ses rechiffrements, et comment le refaire pour d'autres comptes. */
    private class Envoi(var tentatives: Int, val relancer: suspend (List<String>?) -> Unit)
    private val envois = ConcurrentHashMap<String, Envoi>()
    /** Les messages en attente repartent une fois par connexion, après le rattrapage du journal. */
    private var renvoyes = false
    private val dernierEcrit = ConcurrentHashMap<String, Long>()
    private val finsEcrit = ConcurrentHashMap<String, Job>()

    private val _ecrit = MutableStateFlow<Map<String, String>>(emptyMap())
    /** Qui écrit, par discussion. */
    val ecrit: StateFlow<Map<String, String>> = _ecrit.asStateFlow()

    private val _presences = MutableStateFlow<Map<String, Presence>>(emptyMap())
    val presences: StateFlow<Map<String, Presence>> = _presences.asStateFlow()

    /** Les trames sont traitées une à une, dans l'ordre d'arrivée. */
    private val file = Channel<JsonObject>(Channel.UNLIMITED)

    init {
        portee.launch { for (m in file) traiter(m) }
    }

    fun demarrer() {
        if (!arretee) return
        arretee = false
        connecter()
    }

    fun arreter() {
        arretee = true
        reconnexion?.cancel()
        ping?.cancel()
        ws?.close(1000, null)
        ws = null
        _connexion.value = EtatConnexion.HORS_LIGNE
    }

    private fun connecter() {
        if (arretee) return
        _connexion.value = EtatConnexion.CONNEXION
        val adresse = serveur.replaceFirst("https://", "wss://").replaceFirst("http://", "ws://") + "api/temps-reel"
        val socket = client.newWebSocket(Request.Builder().url(adresse).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                tentative = 0
                renvoyes = false
                brut(webSocket, buildJsonObject { put("t", "bonjour"); put("depuis", seq?.let { JsonPrimitive(it) } ?: JsonPrimitive(null as Long?)) })
                ping?.cancel()
                // Maintien de connexion : le serveur répond sans se réveiller.
                ping = portee.launch {
                    while (isActive) {
                        delay(INTERVALLE_PING)
                        webSocket.send("""{"t":"ping"}""")
                    }
                }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                runCatching { Json.parseToJsonElement(text).jsonObject }.getOrNull()?.let { file.trySend(it) }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, null)
                fermee(webSocket, code)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = fermee(webSocket, null)
        })
        ws = socket
    }

    private fun fermee(socket: WebSocket, code: Int?) {
        if (ws !== socket) return
        ws = null
        ping?.cancel()
        if (arretee) return
        _connexion.value = EtatConnexion.HORS_LIGNE
        if (code == FERMETURE_SESSION) {
            surSessionFermee()
            return
        }
        val delai = min(30_000L, 1000L shl min(tentative, 5)) + (0..500).random()
        tentative += 1
        reconnexion?.cancel()
        reconnexion = portee.launch {
            delay(delai)
            // Un échec d'ouverture ne dit pas pourquoi : on vérifie d'abord la session.
            if (!sessionValide()) {
                surSessionFermee()
                return@launch
            }
            connecter()
        }
    }

    private fun brut(socket: WebSocket? = ws, m: JsonObject): Boolean = socket?.send(m.toString()) ?: false

    private suspend fun traiter(m: JsonObject) {
        when (m.texte("t")) {
            "lot" -> {
                appliquer(m["entrees"]?.jsonArray?.map { it.jsonObject } ?: emptyList())
                if (m.vrai("fin")) {
                    _connexion.value = EtatConnexion.CONNECTE
                    if (!renvoyes) {
                        renvoyes = true
                        portee.launch { base.enAttente(moi).forEach { expedier(it) } }
                    }
                } else {
                    brut(m = buildJsonObject { put("t", "bonjour"); put("depuis", seq ?: 0L) })
                }
            }
            "entree" -> m.objet("entree")?.let { appliquer(listOf(it)) }
            "accepte" -> accepte(m)
            "refuse" -> refuse(m)
            "ecrit" -> {
                val conversation = m.texte("conversation")
                _ecrit.update { it + (conversation to m.texte("de")) }
                finsEcrit.remove(conversation)?.cancel()
                finsEcrit[conversation] = portee.launch {
                    delay(DUREE_ECRIT)
                    _ecrit.update { it - conversation }
                }
            }
            "presence" -> _presences.update { it + (m.texte("de") to Presence(m.vrai("enLigne"), m.entier("vuLe"))) }
        }
    }

    // --- Envoi ---------------------------------------------------------------------------

    private fun autreParticipant(conversation: String): String {
        val (_, x, y) = conversation.split(":")
        return if (x == moi) y else x
    }

    /** Durée des messages éphémères de la discussion, si elle les a activés. */
    private fun ephemereDe(conversation: String): Long? = base.conversation(conversation)?.entier("ephemere")?.takeIf { it > 0 }

    /**
     * Un message écrit sur cet appareil : rangé tout de suite « en attente »,
     * puis chiffré et envoyé. Hors connexion, il part au retour de celle-ci.
     * Lancé dans la portée du compte : quitter l'écran ne l'interrompt pas.
     */
    fun envoyer(conversation: String, texte: String, reponseA: JsonObject? = null) {
        val propre = texte.trim()
        if (propre.isEmpty()) return
        portee.launch {
            val maintenant = System.currentTimeMillis()
            var message = buildJsonObject {
                put("id", UUID.randomUUID().toString())
                put("conversation", conversation)
                put("de", moi)
                put("a", if (conversation.startsWith("d:")) autreParticipant(conversation) else conversation.removePrefix("g:"))
                put("texte", propre)
                put("le", maintenant)
                put("type", "texte")
                put("etat", "attente")
            }
            ephemereDe(conversation)?.let { message = message.avec("ephemere", it).avec("expireLe", maintenant + it) }
            reponseA?.let { message = message.avec("reponseA", it) }
            base.ecrireMessage(message)
            base.signaler()
            expedier(message)
        }
    }

    /** Un envoi en échec repart, comme si on venait de l'écrire. */
    fun reessayer(id: String) {
        portee.launch {
            val msg = base.message(id)?.takeIf { it.texte("de") == moi && it.texteOuNul("etat") == "echec" } ?: return@launch
            envois.remove(id)
            val enAttente = msg.avec("etat", "attente").avec("erreur", null)
            base.ecrireMessage(enAttente)
            base.signaler()
            expedier(enAttente)
        }
    }

    /**
     * À qui chiffrer. Pour un groupe, ses membres, ou ceux qu'impose le
     * serveur après un refus (liste périmée) ; faute de membres connus, on
     * échoue plutôt que de partir en clair.
     */
    private suspend fun destination(conversation: String, imposes: List<String>?): Destination {
        if (conversation.startsWith("d:")) {
            val a = autreParticipant(conversation)
            return Destination(conversation, a = a, comptes = listOf(a))
        }
        val groupe = conversation.removePrefix("g:")
        if (imposes != null) portee.launch { runCatching { annuaire.membres(groupe, frais = true) } }
        val membres = imposes ?: annuaire.membres(groupe) ?: throw ErreurChiffrement("groupe", "Vous ne faites plus partie de ce groupe.")
        return Destination(conversation, groupe = groupe, comptes = membres)
    }

    /**
     * Toujours chiffré. Hors connexion, le message attend ; sinon l'échec
     * dit pourquoi, et rien ne part jamais en clair.
     */
    private suspend fun expedier(m: JsonObject, imposes: List<String>? = null) {
        if (_connexion.value != EtatConnexion.CONNECTE) return
        val id = m.texte("id")
        try {
            val destination = destination(m.texte("conversation"), imposes)
            val contenu = buildJsonObject {
                put("v", 1)
                put("texte", m.texte("texte"))
                m.entier("ephemere")?.let { put("ephemere", it) }
                // La citation voyage réduite à ce qui s'affiche : l'original reste chez chacun.
                m.objet("reponseA")?.let { r ->
                    put("reponseA", buildJsonObject {
                        put("id", r.texte("id"))
                        put("de", r.texte("de"))
                        put("extrait", r.texte("extrait"))
                    })
                }
            }
            val enveloppe = cles.verrou.withLock { chiffreur.chiffrer(destination, id, "message", contenu) }
            envois.putIfAbsent(id, Envoi(0) { imposes -> base.message(id)?.let { expedier(it, imposes) } })
            brut(m = enveloppe)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (_connexion.value != EtatConnexion.CONNECTE) return
            envois.remove(id)
            val raison = when {
                e is ErreurChiffrement && e.raison == "sans-cles" ->
                    "${annuaire.nomPersonne(m.texte("a")) ?: "Cette personne"} n'a pas encore ouvert une version d'UniChat qui chiffre les messages. Réessayez quand ce sera fait."
                e is ErreurChiffrement -> e.message ?: "Envoi impossible."
                else -> "Envoi impossible pour le moment. Réessayez."
            }
            modifier(id) { it.avec("etat", "echec").avec("erreur", raison) }
        }
    }

    private fun accepte(m: JsonObject) {
        val id = m.texte("id")
        envois.remove(id)
        modifier(id) { msg ->
            // Un accusé « remis » ou « lu » peut précéder la confirmation : l'état n'y recule pas.
            val actuel = msg.texteOuNul("etat")?.takeIf { it != "echec" } ?: "attente"
            val etat = if ((RANG[actuel] ?: 0) >= RANG.getValue("envoye")) actuel else "envoye"
            msg.avec("le", m.entier("le") ?: msg.entier("le") ?: 0L)
                .avec("attendus", m.entier("destinataires"))
                .avec("erreur", null)
                .avec("etat", etat)
        }
    }

    private fun refuse(m: JsonObject) {
        val id = m.texteOuNul("id") ?: return
        val envoi = envois[id]
        // Appareils de la discussion changés depuis la dernière liste : on rechiffre pour les bons.
        if (envoi != null && m.texte("code") == "appareils" && envoi.tentatives < TENTATIVES_MAX) {
            val comptes = m.objet("appareils")?.keys?.toList().orEmpty()
            envoi.tentatives += 1
            chiffreur.oublier(comptes)
            portee.launch { runCatching { envoi.relancer(comptes.ifEmpty { null }) } }
            return
        }
        envois.remove(id)
        modifier(id) { it.avec("etat", "echec").avec("erreur", m.texte("message")) }
    }

    private fun modifier(id: String, changement: (JsonObject) -> JsonObject) {
        val msg = base.message(id) ?: return
        base.ecrireMessage(changement(msg))
        base.signaler()
    }

    // --- Actions sur un message ------------------------------------------------------------

    /**
     * Une action (réaction, modification, suppression) part chiffrée comme un
     * message, vers les mêmes appareils. Faux si elle n'a pas pu partir :
     * l'appelant défait alors ce qu'il avait affiché.
     */
    private suspend fun agir(conversation: String, contenu: JsonObject): Boolean {
        if (_connexion.value != EtatConnexion.CONNECTE) return false
        val id = UUID.randomUUID().toString()
        suspend fun partir(imposes: List<String>?): Boolean {
            val destination = destination(conversation, imposes)
            val enveloppe = cles.verrou.withLock { chiffreur.chiffrer(destination, id, "action", contenu) }
            envois.putIfAbsent(id, Envoi(0) { partir(it) })
            return brut(m = enveloppe)
        }
        return try {
            partir(null)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            false
        }
    }

    private fun action(nom: String, message: String, champs: JsonObject.() -> JsonObject = { this }) =
        buildJsonObject {
            put("v", 1)
            put("action", nom)
            put("message", message)
        }.champs()

    /** Réagir, ou retirer sa réaction avec null. Affichée tout de suite, retirée si elle ne part pas. */
    suspend fun reagir(id: String, code: String?): Boolean {
        val msg = base.message(id) ?: return false
        if (_connexion.value != EtatConnexion.CONNECTE || msg.vrai("supprime")) return false
        val avant = msg.objet("reactions") ?: JsonObject(emptyMap())
        modifier(id) { it.avec("reactions", avant.avec(moi, code)) }
        val ok = agir(msg.texte("conversation"), action("reaction", id) { avec("code", code?.let { JsonPrimitive(it) } ?: JsonNull) })
        if (!ok) modifier(id) { it.avec("reactions", avant) }
        return ok
    }

    /** Modifier son message, dans les 15 minutes qui suivent l'envoi (les autres appareils vérifient aussi le délai). */
    suspend fun modifierTexte(id: String, texte: String): Boolean {
        val propre = texte.trim()
        val msg = base.message(id) ?: return false
        if (!modifiable(msg) || propre.isEmpty()) return false
        if (propre == msg.texte("texte")) return true
        if (!agir(msg.texte("conversation"), action("modification", id) { avec("texte", propre) })) return false
        modifier(id) { it.avec("texte", propre).avec("modifieLe", System.currentTimeMillis()) }
        return true
    }

    fun modifiable(msg: JsonObject): Boolean =
        msg.texte("de") == moi && !msg.vrai("supprime") && msg.objet("media") == null && msg.texte("texte").isNotEmpty() &&
            msg.texteOuNul("etat") != "attente" && msg.texteOuNul("etat") != "echec" &&
            System.currentTimeMillis() - (msg.entier("le") ?: 0) <= DELAI_MODIFICATION

    /** Supprimer pour tout le monde : réservé à l'auteur, et seulement en ligne (les autres doivent être prévenus). */
    suspend fun supprimerPourTous(id: String): Boolean {
        val msg = base.message(id) ?: return false
        if (msg.texte("de") != moi || msg.vrai("supprime")) return false
        if (!agir(msg.texte("conversation"), action("suppression", id))) return false
        modifier(id) { it.avec("texte" to "", "supprime" to true, "reactions" to JsonObject(emptyMap()), "reponseA" to null, "media" to null) }
        return true
    }

    /** Supprimer pour moi : le message disparaît de cet appareil seulement. */
    fun supprimerPourMoi(id: String) {
        base.supprimerMessage(id)
        base.signaler()
    }

    /** « En train d'écrire » : un signal au plus toutes les 3 s (5 s dans un groupe, relayé à chacun). */
    fun signalerEcriture(conversation: String) {
        val maintenant = System.currentTimeMillis()
        val intervalle = if (conversation.startsWith("d:")) 3000L else 5000L
        if (maintenant - (dernierEcrit[conversation] ?: 0) < intervalle) return
        dernierEcrit[conversation] = maintenant
        brut(m = buildJsonObject { put("t", "ecrit"); put("conversation", conversation) })
    }

    /** La présence n'est pas poussée : on la demande en ouvrant la discussion. */
    fun demanderPresence(autre: String) {
        brut(m = buildJsonObject { put("t", "presence"); put("de", autre) })
    }

    /** Messages lus sur cet appareil : leurs auteurs l'apprennent (et mes autres appareils), comme sur le web. */
    fun marquerLu(conversation: String) {
        val lus = base.marquerLus(conversation, moi).filter { (id, _) -> base.message(id)?.texte("type") != "evenement" }
        lus.groupBy({ it.second }, { it.first }).forEach { (auteur, ids) ->
            ids.chunked(500).forEach { lot ->
                brut(m = buildJsonObject {
                    put("t", "lu")
                    put("conversation", conversation)
                    put("auteur", auteur)
                    put("ids", JsonArray(lot.map { JsonPrimitive(it) }))
                })
            }
        }
    }

    // --- Application des entrées --------------------------------------------------------

    /** Contenu en clair daté d'après la fin du clair : forgé, il est écarté. */
    private fun forge(e: JsonObject): Boolean {
        val type = e.texte("type")
        if (type !in CONTENUS_EN_CLAIR) return false
        val le = if (type == "message") e.objet("message")?.entier("le") ?: 0 else e.entier("le") ?: 0
        return le >= FIN_DU_CLAIR
    }

    /** Une enveloppe ouverte redevient l'entrée qu'elle aurait été en clair : la suite la traite pareil. */
    private fun ouvrir(e: JsonObject): JsonObject? {
        if (forge(e)) return null
        if (e.texte("type") != "chiffre") return e
        val env = e.objet("enveloppe") ?: return null
        val seq = e.entier("seq") ?: 0
        val commun = buildJsonObject {
            put("seq", seq)
            put("conversation", env.texte("conversation"))
            put("par", env.texte("de"))
            put("le", env.entier("le") ?: 0)
        }
        return when (val r = dechiffreur.dechiffrer(env)) {
            Dechiffrement.Ignore -> null
            Dechiffrement.Illisible -> if (env.texte("genre") == "message") {
                buildJsonObject {
                    put("seq", seq)
                    put("type", "illisible")
                    put("message", buildJsonObject {
                        put("id", env.texte("id"))
                        put("conversation", env.texte("conversation"))
                        put("de", env.texte("de"))
                        put("a", env.texte("a"))
                        put("le", env.entier("le") ?: 0)
                    })
                }
            } else {
                null
            }
            is Dechiffrement.Action -> {
                val a = r.contenu
                val action = a.texte("action")
                JsonObject(commun + a.filterKeys { it != "v" && it != "action" } + ("type" to JsonPrimitive(action)))
            }
            is Dechiffrement.Message -> {
                val c = r.contenu
                var message = buildJsonObject {
                    put("id", env.texte("id"))
                    put("conversation", env.texte("conversation"))
                    put("de", env.texte("de"))
                    put("a", env.texte("a"))
                    put("texte", c.texte("texte").trim())
                    put("le", env.entier("le") ?: 0)
                }
                for (champ in listOf("media", "reponseA", "transfere", "lien", "ephemere", "position", "contact", "sondage", "mentions")) {
                    c[champ]?.let { message = message.avec(champ, it) }
                }
                buildJsonObject {
                    put("seq", seq)
                    put("type", "message")
                    put("message", message)
                }
            }
        }
    }

    private suspend fun appliquer(recues: List<JsonObject>) {
        if (recues.isEmpty()) return
        // Le déchiffrement fait avancer les sessions : sous le verrou des clés, comme sur le web.
        val entrees = cles.verrou.withLock { recues.mapNotNull { ouvrir(it) } }
        val groupesAChanger = mutableSetOf<String>()
        base.transaction {
            for (e in entrees) appliquerUne(e, groupesAChanger)
        }
        val dernier = recues.maxOf { it.entier("seq") ?: 0 }
        seq = maxOf(seq ?: 0, dernier)
        base.ecrireReglage("seq", seq.toString())
        base.signaler()
        planifierAccuse()
        if (groupesAChanger.isNotEmpty()) portee.launch { rafraichirGroupes?.invoke() }
    }

    /** Rafraîchit les noms des groupes (événement de groupe reçu) ; branché par le conteneur. */
    var rafraichirGroupes: (suspend () -> Unit)? = null

    private fun appliquerUne(e: JsonObject, groupesAChanger: MutableSet<String>) {
        when (e.texte("type")) {
            "message" -> {
                val m = e.objet("message") ?: return
                val existant = base.message(m.texte("id"))
                val ephemere = m.entier("ephemere")?.let { m.entier("le")!! + it }
                if (m.texte("de") == moi) {
                    // Mon message, envoyé d'un autre de mes appareils.
                    var local = JsonObject((existant ?: JsonObject(emptyMap())) + m).avec("type", "texte").avec("lu", true)
                    if (ephemere != null) local = local.avec("expireLe", ephemere)
                    if (local.texteOuNul("etat") == null) local = local.avec("etat", "envoye")
                    base.ecrireMessage(local)
                } else if (existant == null || existant.vrai("indechiffrable")) {
                    // Le message attendu est arrivé : son auteur n'écrit plus.
                    _ecrit.update { it - m.texte("conversation") }
                    var local = m.avec("type", "texte").avec("lu", false)
                    if (ephemere != null) local = local.avec("expireLe", ephemere)
                    base.ecrireMessage(local)
                }
            }
            "illisible" -> {
                val m = e.objet("message") ?: return
                if (base.message(m.texte("id")) == null) {
                    val mien = m.texte("de") == moi
                    var local = m.avec("texte", "").avec("type", "texte").avec("indechiffrable", true).avec("lu", mien)
                    if (mien) local = local.avec("etat", "envoye")
                    base.ecrireMessage(local)
                }
            }
            "accuse" -> {
                val etat = e.texte("etat")
                for (id in e["ids"]?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList()) {
                    val msg = base.message(id) ?: continue
                    // Seuls mes messages de cette discussion peuvent changer d'état.
                    if (msg.texte("de") != moi || msg.texte("conversation") != e.texte("conversation")) continue
                    val actuel = msg.texteOuNul("etat")
                    if ((RANG[etat] ?: 0) > (RANG[actuel] ?: 0)) base.ecrireMessage(msg.avec("etat", etat))
                }
            }
            "lu" -> {
                for (id in e["ids"]?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList()) {
                    val msg = base.message(id) ?: continue
                    if (msg.texte("de") != moi && !msg.vrai("lu")) base.ecrireMessage(msg.avec("lu", true))
                }
            }
            "reaction" -> {
                val msg = base.message(e.texte("message")) ?: return
                if (msg.texte("conversation") != e.texte("conversation") || msg.vrai("supprime")) return
                val reactions = (msg.objet("reactions") ?: JsonObject(emptyMap())).let { r ->
                    val code = e.texteOuNul("code")
                    if (code != null) r.avec(e.texte("par"), code) else r.avec(e.texte("par"), null)
                }
                base.ecrireMessage(msg.avec("reactions", reactions))
            }
            "suppression" -> {
                val msg = base.message(e.texte("message")) ?: return
                // Seul l'auteur peut supprimer son message pour tout le monde.
                if (msg.texte("conversation") == e.texte("conversation") && msg.texte("de") == e.texte("par")) {
                    base.ecrireMessage(msg.avec("texte" to "", "supprime" to true, "reactions" to JsonObject(emptyMap()), "reponseA" to null, "media" to null))
                }
            }
            "modification" -> {
                val msg = base.message(e.texte("message")) ?: return
                // Seul l'auteur modifie, et seulement dans le délai : on ne fait pas confiance au seul serveur.
                val le = e.entier("le") ?: 0
                if (msg.texte("conversation") == e.texte("conversation") && msg.texte("de") == e.texte("par") && !msg.vrai("supprime") &&
                    le - (msg.entier("le") ?: 0) <= DELAI_MODIFICATION + 60_000
                ) {
                    base.ecrireMessage(msg.avec("texte", e.texte("texte").trim()).avec("modifieLe", le))
                }
            }
            "ephemere" -> {
                // Retenue sur la discussion : mes prochains messages en héritent.
                val conversation = e.texte("conversation")
                val duree = e.entier("duree")?.takeIf { it > 0 }
                base.ecrireConversation((base.conversation(conversation) ?: buildJsonObject { put("id", conversation) }).avec("ephemere", duree))
                val id = "ephemere:${e.texte("par")}:${e.entier("le")}"
                if (base.message(id) == null) {
                    base.ecrireMessage(buildJsonObject {
                        put("id", id)
                        put("conversation", e.texte("conversation"))
                        put("de", e.texte("par"))
                        put("a", "")
                        put("texte", "")
                        put("le", e.entier("le") ?: 0)
                        put("type", "systeme")
                        put("systeme", buildJsonObject {
                            put("action", "ephemere")
                            put("duree", e["duree"] ?: JsonPrimitive(null as Long?))
                        })
                        put("lu", true)
                    })
                }
            }
            "groupe" -> {
                val ev = e.objet("evenement") ?: return
                if (base.message(ev.texte("id")) == null) {
                    base.ecrireMessage(buildJsonObject {
                        put("id", ev.texte("id"))
                        put("conversation", ev.texte("conversation"))
                        put("de", ev.texte("par"))
                        put("a", ev.texte("conversation").removePrefix("g:"))
                        put("texte", "")
                        put("le", ev.entier("le") ?: 0)
                        put("type", "evenement")
                        put("evenement", ev)
                        put("lu", true)
                    })
                }
                groupesAChanger += ev.texte("conversation")
                // Les membres ont pu changer : ils seront relus au prochain envoi.
                val gid = ev.texte("conversation").removePrefix("g:")
                base.groupe(gid)?.let { base.ecrireGroupe(it.avec("membres", null)) }
            }
            // epingle, important, vote, ouvert, blocage, preference : rien à montrer encore dans l'appli.
        }
    }

    /** Accusé de réception groupé : une seule écriture côté serveur pour une rafale de messages. */
    private fun planifierAccuse() {
        accuse?.cancel()
        accuse = portee.launch {
            delay(250)
            seq?.let { s -> brut(m = buildJsonObject { put("t", "recu"); put("jusqua", s) }) }
        }
    }
}
