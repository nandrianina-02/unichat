import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// La clé de l'ancienne appli (Trusted Web Activity), pour que l'appli native
// s'installe par-dessus comme une mise à jour. Elle n'existe en clair que sur
// le serveur d'intégration, le temps de la construction (voir le workflow).
val magasin: String? = System.getenv("UNICHAT_MAGASIN")

val google = Properties().apply { rootProject.file("google.properties").inputStream().use { load(it) } }

android {
    namespace = "io.github.nandrianina02.unichat"
    compileSdk = 35

    defaultConfig {
        // Même identifiant que l'appli Trusted Web Activity : la native la remplace.
        applicationId = "io.github.nandrianina02.unichat"
        minSdk = 26
        targetSdk = 35
        // Au-dessus de l'appli Trusted Web Activity (5) : sinon Android refuse la mise à jour.
        versionCode = 16
        versionName = "2.6.0"
        vectorDrawables.useSupportLibrary = true
        buildConfigField("String", "SERVEUR", "\"https://unichat.unichat-server.workers.dev/\"")
        buildConfigField("String", "GOOGLE_CLIENT_WEB", "\"" + google.getProperty("clientWeb") + "\"")
    }

    signingConfigs {
        create("publication") {
            if (magasin != null) {
                storeFile = file(magasin)
                storeType = "pkcs12"
                storePassword = System.getenv("UNICHAT_SECRET")
                keyAlias = System.getenv("UNICHAT_ALIAS")
                keyPassword = System.getenv("UNICHAT_SECRET")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (magasin != null) signingConfigs.getByName("publication") else signingConfigs.getByName("debug")
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging {
        // Fichiers de description de BouncyCastle, inutiles à l'appli et en double d'une version de Java à l'autre.
        resources.excludes += setOf("META-INF/versions/9/OSGI-INF/MANIFEST.MF", "META-INF/LICENSE.md", "META-INF/LICENSE-notice.md")
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.retrofit)
    implementation(libs.retrofit.kotlinx.serialization)
    implementation(libs.okhttp)
    implementation(libs.coil.compose)
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play.services)
    implementation(libs.googleid)
    // X25519, Ed25519 et HKDF du chiffrement de bout en bout (licence de type MIT, comme noble côté web).
    implementation(libs.bouncycastle)
    // Lecteur de QR code de Google Play : il s'ouvre par-dessus l'appli, sans autorisation de caméra pour elle.
    implementation(libs.code.scanner)

    testImplementation(libs.junit)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.kotlinx.coroutines.test)
}
