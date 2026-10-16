plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val serverUrl: String = (project.findProperty("rylaideServerUrl") as String?) ?: "https://rylaide.onrender.com"

android {
    namespace = "com.rylaide.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.rylaide.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "SERVER_URL", "\"$serverUrl\"")
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}
// No extra libraries: the app uses only the Android framework (WebView, TextToSpeech, Vibrator).
