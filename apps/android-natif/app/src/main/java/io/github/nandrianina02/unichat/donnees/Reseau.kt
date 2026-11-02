package io.github.nandrianina02.unichat.donnees

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Response
import retrofit2.HttpException
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import okhttp3.ResponseBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Le serveur ajoute des champs au fil des versions : l'appli ignore ceux qu'elle ne connaît pas. */
val JsonUniChat = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
}

/**
 * Pose le jeton de session sur chaque requête, et range celui que le serveur
 * renvoie quand il le renouvelle (en-tête X-UniChat-Jeton) : l'ancien ne vaut
 * plus après un court délai de grâce, et le réutiliser fermerait la session.
 */
class IntercepteurJeton(private val stockage: StockageJeton) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val jeton = stockage.lire()
        val requete = if (jeton != null) {
            chain.request().newBuilder().header("Authorization", "Bearer $jeton").build()
        } else {
            chain.request()
        }
        val reponse = chain.proceed(requete)
        reponse.header("X-UniChat-Jeton")?.let(stockage::ecrire)
        return reponse
    }
}

interface UniChatApi {
    @POST("api/auth/natif/nonce")
    suspend fun nonce(): NonceNatif

    @POST("api/auth/natif")
    suspend fun connexion(@Body demande: ConnexionNatif): SessionNatif

    @POST("api/auth/deconnexion")
    suspend fun deconnexion()

    @GET("api/moi")
    suspend fun moi(): Moi

    @GET("api/sessions")
    suspend fun appareils(): ListeAppareils

    // --- Annuaire des clés --------------------------------------------------------------

    @GET("api/cles")
    suspend fun etatCles(): EtatCles

    @POST("api/cles/identite")
    suspend fun inscrireCles(@Body inscription: InscriptionCles): EtatCles

    @POST("api/cles/reprendre")
    suspend fun reprendreCles(@Body reprise: RepriseCles): EtatCles

    @POST("api/cles/uniques")
    suspend fun ajouterClesUniques(@Body envoi: EnvoiClesUniques): EtatCles

    @PUT("api/cles/signee")
    suspend fun publierCleSignee(@Body envoi: EnvoiCleSignee): EtatCles

    @POST("api/cles/appareil")
    suspend fun relierAppareil(@Body relie: AppareilRelie): EtatCles

    @POST("api/cles/appareils")
    suspend fun appareilsCles(@Body demande: DemandeAppareils): AppareilsDesComptes

    @POST("api/cles/paquets")
    suspend fun paquets(@Body demande: DemandePaquets): ListePaquets

    // --- Liaison et historique (lot 8 du web) --------------------------------------------

    @GET("api/cles/liaisons/{canal}")
    suspend fun liaison(@Path("canal") canal: String): EtatLiaison

    @POST("api/cles/liaisons/{canal}/reponse")
    suspend fun repondreLiaison(@Path("canal") canal: String, @Body reponse: ReponseLiaison): EtatLiaison

    @GET("api/cles/liaisons/{canal}/historique")
    suspend fun etatHistorique(@Path("canal") canal: String): EtatHistorique

    @GET("api/cles/liaisons/{canal}/historique/{indice}")
    suspend fun morceauHistorique(@Path("canal") canal: String, @Path("indice") indice: Int): ResponseBody

    @DELETE("api/cles/liaisons/{canal}/historique")
    suspend fun supprimerHistorique(@Path("canal") canal: String)

    // --- Personnes et groupes -----------------------------------------------------------

    @GET("api/personnes/{id}")
    suspend fun personne(@Path("id") id: String): CarteProfil

    @GET("api/groupes")
    suspend fun groupes(): ListeGroupes

    /** Le groupe dans la forme du web (Groupe, packages/shared) : il se range tel quel dans la base. */
    @GET("api/groupes/{id}")
    suspend fun groupe(@Path("id") id: String): JsonObject
}

class Reseau(serveur: String, stockage: StockageJeton) {
    val client: OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(IntercepteurJeton(stockage))
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    val api: UniChatApi = Retrofit.Builder()
        .baseUrl(serveur)
        .client(client)
        .addConverterFactory(JsonUniChat.asConverterFactory("application/json".toMediaType()))
        .build()
        .create(UniChatApi::class.java)
}

/** Une erreur du serveur, avec son code stable et son message en français. */
class ErreurServeur(val statut: Int, val code: String, message: String) : Exception(message)

/** Le message à montrer pour une erreur, réseau ou serveur. */
fun messageErreur(e: Throwable): String = when (e) {
    is ErreurServeur -> e.message ?: "Une erreur est survenue."
    is IOException -> "Pas de connexion au serveur. Vérifiez votre réseau."
    else -> "Une erreur est survenue. Réessayez dans un instant."
}

/** Un appel à l'API, ses refus ramenés à ErreurServeur ({ erreur, message } du serveur). */
suspend fun <T> appel(bloc: suspend () -> T): Result<T> = try {
    Result.success(bloc())
} catch (e: HttpException) {
    val corps = runCatching { e.response()?.errorBody()?.string() }.getOrNull()
    val refus = corps?.let { runCatching { JsonUniChat.decodeFromString(RefusServeur.serializer(), it) }.getOrNull() }
    Result.failure(ErreurServeur(e.code(), refus?.erreur ?: "inconnu", refus?.message ?: "Le serveur a répondu ${e.code()}."))
} catch (e: kotlinx.coroutines.CancellationException) {
    throw e
} catch (e: Exception) {
    Result.failure(e)
}
