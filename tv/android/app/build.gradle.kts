import java.io.File

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Version from the desktop package.json (one version for desktop and TV apps). versionCode grows monotonically:
// major*1_000_000 + minor*10_000 + patch*100 (+ prerelease number), so an update never goes backwards.
val pkg = groovy.json.JsonSlurper().parse(File(rootDir, "../../package.json")) as Map<*, *>
val appVersion = pkg["version"] as String
val match = Regex("""^(\d+)\.(\d+)\.(\d+)(?:-[a-z]+\.(\d+))?""").find(appVersion)
    ?: error("Unexpected version $appVersion")
val (major, minor, patch) = match.destructured
val pre = match.groupValues[4].ifEmpty { "99" }.toInt()
val code = major.toInt() * 1_000_000 + minor.toInt() * 10_000 + patch.toInt() * 100 + pre

// Release signing from CI secrets (never in the repo). Without them the build is signed with the development key
// (tv/android/debug.keystore) and marked as "debug" in resources/tv/manifest.json.
val keystore = System.getenv("ADRENALINE_ANDROID_KEYSTORE")

android {
    namespace = "com.jakubkonkol.adrenaline.tv"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.jakubkonkol.adrenaline.tv"
        minSdk = 28
        targetSdk = 35
        versionCode = code
        versionName = appVersion
    }

    signingConfigs {
        // A fixed development key kept in the repo (public, like Android's debug key): builds without the release
        // secrets are still signed with the same key every time, so they update each other on a TV.
        getByName("debug") {
            storeFile = file("../debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
        if (keystore != null) {
            create("release") {
                storeFile = file(keystore)
                storePassword = System.getenv("ADRENALINE_ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ADRENALINE_ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ADRENALINE_ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    // The TV web app (npm run build:tv → out/tv) is packed as assets/tv.
    sourceSets["main"].assets.srcDir(File(rootDir, "../../out/tv-android"))
}

dependencies {
    val media3 = "1.5.1"
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-exoplayer-hls:$media3")
    implementation("androidx.media3:media3-ui:$media3")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
}
