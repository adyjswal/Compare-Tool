import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType

plugins {
    id("org.jetbrains.intellij.platform") version "2.3.0"
    kotlin("jvm") version "2.0.21"
}

group = "com.adityakumar"
version = "0.2.0"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        intellijIdeaCommunity("2024.1")
    }
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.2")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

intellijPlatform {
    // This plugin contributes no Settings/preferences UI, so there is nothing to
    // index for search. Skipping it avoids launching a headless IDE at build time,
    // which is slow and flaky on CI runners (it crashed the release-jetbrains job).
    buildSearchableOptions = false

    pluginConfiguration {
        name = "Large File Compare"
        version = "0.2.0"
        ideaVersion {
            sinceBuild = "241"
            // null provider = no until-build in the output XML; the plugin installs on
            // any future IDE version instead of being pinned to IDEA 2024.1.x.
            untilBuild = provider { null }
        }
    }

    signing {
        // All three properties are required for signing; if any env var is absent the
        // provider has no value and Gradle skips the signPlugin task automatically.
        certificateChain = providers.environmentVariable("CERTIFICATE_CHAIN")
        privateKey = providers.environmentVariable("PRIVATE_KEY")
        password = providers.environmentVariable("PRIVATE_KEY_PASSWORD")
    }

    publishing {
        token = providers.environmentVariable("PUBLISH_TOKEN")
    }

    // Plugin Verifier — same check JetBrains Marketplace runs during moderation.
    // `recommended()` picks the IDE builds spanning our sinceBuild floor, so the
    // deprecated-API report here matches the email from the Marketplace.
    pluginVerification {
        ides {
            // Pin explicit, downloadable builds (recommended() resolved to an
            // unreleased 2025.3). 2024.3 showed no deprecations, so the two the
            // Marketplace flagged are in a newer build — verify against 2025.2.
            ide(IntelliJPlatformType.IntellijIdeaCommunity, "2025.2")
        }
    }
}

kotlin {
    // Compile with JDK 21 toolchain, emit Java 17 bytecode (IntelliJ Platform 2024.1
    // ships a Java 17 runtime; class files targeting 21 fail to load there).
    jvmToolchain(21)
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

tasks.test {
    useJUnitPlatform()
}
