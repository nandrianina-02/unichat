package io.github.nandrianina02.unichat.donnees

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

/**
 * Ce que montre la liste des discussions. Les réglages (sourdine, épingle,
 * archive, « non lu ») sont ceux du web, partagés entre mes appareils.
 */
data class ApercuDiscussion(
    val conversation: String,
    val dernier: JsonObject,
    val nonLus: Int,
    val epinglee: Boolean = false,
    val archivee: Boolean = false,
    val muette: Boolean = false,
    /** « Marquer comme non lu » : un point dans la liste jusqu'à la prochaine ouverture. */
    val marqueeNonLue: Boolean = false,
)

/**
 * La base d'un compte sur l'appareil : messages, personnes et groupes. Comme
 * sur le web (une base par compte), l'historique vit sur l'appareil, le
 * serveur ne le garde que le temps de le remettre.
 *
 * Un message est rangé dans la forme du web (MessageLocal, en JSON) : un
 * historique transmis par l'ordinateur s'y range tel quel, sans rien perdre
 * des champs que l'appli ne montre pas encore. Les champs qui servent aux
 * recherches ont en plus leur colonne.
 */
class Base(contexte: Context, compte: String) : SQLiteOpenHelper(contexte, "unichat-$compte.db", null, 1) {
    private val _version = MutableStateFlow(0L)
    /** Change à chaque écriture : les écrans relisent. */
    val version: StateFlow<Long> = _version.asStateFlow()

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """CREATE TABLE messages (
                id TEXT PRIMARY KEY,
                conversation TEXT NOT NULL,
                de TEXT NOT NULL,
                le INTEGER NOT NULL,
                lu INTEGER NOT NULL DEFAULT 1,
                indechiffrable INTEGER NOT NULL DEFAULT 0,
                contenu TEXT NOT NULL
            )""",
        )
        db.execSQL("CREATE INDEX messages_conversation ON messages (conversation, le)")
        db.execSQL("CREATE TABLE personnes (id TEXT PRIMARY KEY, contenu TEXT NOT NULL)")
        db.execSQL("CREATE TABLE groupes (id TEXT PRIMARY KEY, contenu TEXT NOT NULL)")
        db.execSQL("CREATE TABLE conversations (id TEXT PRIMARY KEY, contenu TEXT NOT NULL)")
        db.execSQL("CREATE TABLE reglages (cle TEXT PRIMARY KEY, valeur TEXT NOT NULL)")
    }

    override fun onUpgrade(db: SQLiteDatabase, ancienne: Int, nouvelle: Int) = Unit

    fun signaler() {
        _version.value += 1
    }

    // --- Messages -------------------------------------------------------------------

    fun message(id: String): JsonObject? =
        readableDatabase.rawQuery("SELECT contenu FROM messages WHERE id = ?", arrayOf(id)).use { c ->
            if (c.moveToFirst()) Json.parseToJsonElement(c.getString(0)).jsonObject else null
        }

    fun ecrireMessage(m: JsonObject, db: SQLiteDatabase = writableDatabase) {
        val valeurs = ContentValues().apply {
            put("id", m.texte("id"))
            put("conversation", m.texte("conversation"))
            put("de", m.texte("de"))
            put("le", m["le"]!!.jsonPrimitive.longOrNull ?: 0L)
            put("lu", if (m["lu"]?.jsonPrimitive?.booleanOrNull == false) 0 else 1)
            put("indechiffrable", if (m["indechiffrable"]?.jsonPrimitive?.booleanOrNull == true) 1 else 0)
            put("contenu", m.toString())
        }
        db.insertWithOnConflict("messages", null, valeurs, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun supprimerMessage(id: String) {
        writableDatabase.delete("messages", "id = ?", arrayOf(id))
    }

    /** Les derniers messages d'une discussion, du plus ancien au plus récent. */
    fun messages(conversation: String, limite: Int = 500): List<JsonObject> =
        readableDatabase.rawQuery(
            "SELECT contenu FROM (SELECT contenu, le FROM messages WHERE conversation = ? ORDER BY le DESC LIMIT ?) ORDER BY le",
            arrayOf(conversation, limite.toString()),
        ).use { c -> buildList { while (c.moveToNext()) add(Json.parseToJsonElement(c.getString(0)).jsonObject) } }

    /**
     * Une ligne par discussion : son dernier message et ses non-lus. Les
     * épinglées d'abord, puis la plus récente en haut. Une discussion effacée
     * (sans être supprimée) reste dans la liste, à la date de l'effacement.
     */
    fun discussions(moi: String, maintenant: Long = System.currentTimeMillis()): List<ApercuDiscussion> {
        val reglages = HashMap<String, JsonObject>()
        readableDatabase.rawQuery("SELECT id, contenu FROM conversations", null).use { c ->
            while (c.moveToNext()) reglages[c.getString(0)] = Json.parseToJsonElement(c.getString(1)).jsonObject
        }
        fun avecReglages(a: ApercuDiscussion): ApercuDiscussion {
            val r = reglages[a.conversation]?.objet("reglages") ?: return a
            val muet = r.entier("muetJusqua")
            return a.copy(
                epinglee = r.vrai("epingle"),
                archivee = r.vrai("archive"),
                muette = muet != null && muet > maintenant,
                marqueeNonLue = r.vrai("nonLu"),
            )
        }
        val parMessages = discussionsDesMessages(moi)
        val presentes = parMessages.map { it.conversation }.toSet()
        val videes = reglages.values.filter { it.texte("id") !in presentes && it.entier("videeLe") != null }.map { c ->
            ApercuDiscussion(c.texte("id"), buildJsonObject {
                put("id", "")
                put("conversation", c.texte("id"))
                put("de", "")
                put("texte", "")
                put("type", "texte")
                put("le", c.entier("videeLe") ?: 0L)
            }, 0)
        }
        return (parMessages + videes).map(::avecReglages)
            .sortedWith(compareByDescending<ApercuDiscussion> { it.epinglee }.thenByDescending { it.dernier.entier("le") ?: 0L })
    }

    private fun discussionsDesMessages(moi: String): List<ApercuDiscussion> {
        val nonLus = HashMap<String, Int>()
        readableDatabase.rawQuery("SELECT conversation, COUNT(*) FROM messages WHERE lu = 0 AND de <> ? GROUP BY conversation", arrayOf(moi)).use { c ->
            while (c.moveToNext()) nonLus[c.getString(0)] = c.getInt(1)
        }
        return readableDatabase.rawQuery(
            """SELECT m.conversation, m.contenu FROM messages m
               JOIN (SELECT conversation, MAX(le) AS le FROM messages GROUP BY conversation) d
                 ON d.conversation = m.conversation AND d.le = m.le
               ORDER BY m.le DESC""",
            null,
        ).use { c ->
            val vues = HashSet<String>()
            buildList {
                while (c.moveToNext()) {
                    // Deux messages à la même milliseconde : un seul représente la discussion.
                    if (!vues.add(c.getString(0))) continue
                    add(ApercuDiscussion(c.getString(0), Json.parseToJsonElement(c.getString(1)).jsonObject, nonLus[c.getString(0)] ?: 0))
                }
            }
        }
    }

    /**
     * Mes messages pas encore partis, du plus ancien au plus récent : ils
     * partent dès que la connexion revient. L'état vit dans le contenu (forme
     * du web) ; le filtre SQL dégrossit, la lecture tranche.
     */
    fun enAttente(moi: String): List<JsonObject> =
        readableDatabase.rawQuery("SELECT contenu FROM messages WHERE de = ? AND contenu LIKE '%\"attente\"%' ORDER BY le", arrayOf(moi)).use { c ->
            buildList { while (c.moveToNext()) add(Json.parseToJsonElement(c.getString(0)).jsonObject) }
        }.filter { it.texteOuNul("etat") == "attente" }

    /** Messages reçus d'une discussion marqués lus sur cet appareil ; rend leurs identifiants et auteurs. */
    fun marquerLus(conversation: String, moi: String): List<Pair<String, String>> {
        val db = writableDatabase
        val lus = db.rawQuery("SELECT id, de, contenu FROM messages WHERE conversation = ? AND lu = 0 AND de <> ?", arrayOf(conversation, moi)).use { c ->
            buildList { while (c.moveToNext()) add(Triple(c.getString(0), c.getString(1), Json.parseToJsonElement(c.getString(2)).jsonObject)) }
        }
        if (lus.isEmpty()) return emptyList()
        db.beginTransaction()
        try {
            lus.forEach { (_, _, m) -> ecrireMessage(m.avec("lu", true), db) }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        signaler()
        return lus.map { it.first to it.second }
    }

    // --- Personnes, groupes, discussions, réglages --------------------------------------

    private fun lireObjet(table: String, id: String): JsonObject? =
        readableDatabase.rawQuery("SELECT contenu FROM $table WHERE id = ?", arrayOf(id)).use { c ->
            if (c.moveToFirst()) Json.parseToJsonElement(c.getString(0)).jsonObject else null
        }

    private fun ecrireObjet(table: String, id: String, contenu: JsonObject) {
        writableDatabase.insertWithOnConflict(table, null, ContentValues().apply {
            put("id", id)
            put("contenu", contenu.toString())
        }, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun personne(id: String) = lireObjet("personnes", id)
    fun ecrirePersonne(p: JsonObject) = ecrireObjet("personnes", p.texte("id"), p)
    fun groupe(id: String) = lireObjet("groupes", id)
    fun ecrireGroupe(g: JsonObject) = ecrireObjet("groupes", g.texte("id"), g)
    fun conversation(id: String) = lireObjet("conversations", id)

    /**
     * Un réglage de discussion, reçu de mes autres appareils ou décidé ici
     * (appliquerPreference du web) : effacement des messages jusqu'à une
     * date, retrait de la liste, sourdine, épingle, archive, « non lu ».
     */
    fun appliquerPreference(conversation: String, p: JsonObject) {
        val db = writableDatabase
        p.entier("effaceAvant")?.let { avant ->
            // Un message pas encore parti n'a pas d'heure définitive : on le garde.
            val ids = db.rawQuery("SELECT id, contenu FROM messages WHERE conversation = ? AND le <= ?", arrayOf(conversation, avant.toString())).use { c ->
                buildList {
                    while (c.moveToNext()) {
                        if (Json.parseToJsonElement(c.getString(1)).jsonObject.texteOuNul("etat") != "attente") add(c.getString(0))
                    }
                }
            }
            ids.forEach { db.delete("messages", "id = ?", arrayOf(it)) }
        }
        if (p.vrai("supprimee")) {
            db.delete("conversations", "id = ?", arrayOf(conversation))
            return
        }
        val existante = conversation(conversation) ?: buildJsonObject { put("id", conversation) }
        var reglages = existante.objet("reglages") ?: JsonObject(emptyMap())
        for (cle in listOf("muetJusqua", "favori", "archive", "epingle", "nonLu")) {
            if (cle in p) reglages = reglages.avec(cle, p[cle])
        }
        var c = existante.avec("reglages", reglages)
        p.entier("effaceAvant")?.let { c = c.avec("videeLe", it) }
        ecrireConversation(c)
    }

    /** Heure du dernier message d'une discussion, 0 si elle n'en a pas. */
    fun dernierLe(conversation: String): Long =
        readableDatabase.rawQuery("SELECT MAX(le) FROM messages WHERE conversation = ?", arrayOf(conversation)).use { c ->
            if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else 0L
        }
    fun ecrireConversation(c: JsonObject) = ecrireObjet("conversations", c.texte("id"), c)

    fun reglage(cle: String): String? =
        readableDatabase.rawQuery("SELECT valeur FROM reglages WHERE cle = ?", arrayOf(cle)).use { c -> if (c.moveToFirst()) c.getString(0) else null }

    fun ecrireReglage(cle: String, valeur: String) {
        writableDatabase.insertWithOnConflict("reglages", null, ContentValues().apply {
            put("cle", cle)
            put("valeur", valeur)
        }, SQLiteDatabase.CONFLICT_REPLACE)
    }

    /** Plusieurs écritures d'un coup : un lot du journal se range entièrement, ou pas du tout. */
    fun <T> transaction(bloc: () -> T): T {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val r = bloc()
            db.setTransactionSuccessful()
            return r
        } finally {
            db.endTransaction()
        }
    }
}
