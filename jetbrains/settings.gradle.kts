rootProject.name = "large-file-compare-jetbrains"

pluginManagement {
    repositories {
        maven("https://packages.jetbrains.team/maven/p/ij/intellij-platform")
        gradlePluginPortal()
        mavenCentral()
    }
}

plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "0.8.0"
}
