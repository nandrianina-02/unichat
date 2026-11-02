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
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

/** Ce que montre la liste des discussions. */
data class ApercuDiscussion(val conversation: String, val dernier: JsonObject, val nonLus: Int)

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

    /** Les derniers messages d'une discussion, du plus ancien au plus récent. */
    fun messages(conversation: String, limite: Int = 500): List<JsonObject> =
        readableDatabase.rawQuery(
            "SELECT contenu FROM (SELECT contenu, le FROM messages WHERE conversation = ? ORDER BY le DESC LIMIT ?) ORDER BY le",
            arrayOf(conversation, limite.toString()),
        ).use { c -> buildList { while (c.moveToNext()) add(Json.parseToJsonElement(c.getString(0)).jsonObject) } }

    /** Une ligne par discussion : son dernier message et ses non-lus, la plus récente en haut. */
    fun discussions(moi: String): List<ApercuDiscussion> {
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
