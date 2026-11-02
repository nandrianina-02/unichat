package io.github.nandrianina02.unichat.donnees

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
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
import kotlin.math.min

enum class EtatConnexion { HORS_LIGNE, CONNEXION, CONNECTE }

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
private val RANG = mapOf("echec" to -1, "attente" to 0, "envoye" to 1, "remis" to 2, "lu" to 3)

/**
 * Le temps réel, porté d'apps/web/src/lib/messagerie.ts (réception) : la
 * boîte du compte remet son journal par lots ; chaque entrée est ouverte
 * (enveloppe chiffrée), appliquée à la base, puis acquittée. Le serveur
 * efface ce que tous les appareils ont reçu.
 */
class Messagerie(
    private val client: OkHttpClient,
    private val serveur: String,
    private val cles: ClesAppareil,
    private val dechiffreur: Dechiffreur,
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
                if (m.vrai("fin")) _connexion.value = EtatConnexion.CONNECTE
                else brut(m = buildJsonObject { put("t", "bonjour"); put("depuis", seq ?: 0L) })
            }
            "entree" -> m.objet("entree")?.let { appliquer(listOf(it)) }
            // accepte, refuse, ecrit, presence : concernent l'envoi et la présence (lots suivants).
        }
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
