import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ksp)
    alias(libs.plugins.kotlin.serialization)
}

val localProperties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (!file.exists()) {
        throw GradleException("Falta local.properties. Copia local.properties.example y completa los valores.")
    }

    file.inputStream().use { load(it) }
}

fun requireLocalProperty(name: String): String {
    return localProperties.getProperty(name)
        ?: throw GradleException("Falta la propiedad $name en local.properties")
}

android {
    namespace = "atendedor.resto.resto_app"
    compileSdk = 35

    defaultConfig {
        applicationId = "atendedor.resto.resto_app"
        minSdk = 30
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "MQTT_HOST", "\"${requireLocalProperty("MQTT_HOST")}\"")
        buildConfigField("int", "MQTT_PORT", requireLocalProperty("MQTT_PORT"))
        buildConfigField("String", "MQTT_USERNAME", "\"${requireLocalProperty("MQTT_USERNAME")}\"")
        buildConfigField("String", "MQTT_PASSWORD", "\"${requireLocalProperty("MQTT_PASSWORD")}\"")
        buildConfigField("String", "MQTT_BASE_TOPIC", "\"${requireLocalProperty("MQTT_BASE_TOPIC")}\"")
        buildConfigField("int", "MQTT_TIMEOUT_SECONDS", requireLocalProperty("MQTT_TIMEOUT_SECONDS"))
        buildConfigField("String", "MQTT_DEVICE_ID", "\"${requireLocalProperty("MQTT_DEVICE_ID")}\"")
        buildConfigField("String", "BUSINESS_NAME", "\"${requireLocalProperty("BUSINESS_NAME")}\"")
        buildConfigField("String", "MANAGER_USERNAME", "\"${requireLocalProperty("MANAGER_USERNAME")}\"")
        buildConfigField("String", "MANAGER_PASSWORD", "\"${requireLocalProperty("MANAGER_PASSWORD")}\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        buildConfig = true
        compose = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material3.adaptive.navigation.suite)
    implementation(libs.eclipse.paho.mqtt)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.androidx.core.splashscreen)

    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}
