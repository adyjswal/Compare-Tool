import org.jetbrains.intellij.platform.gradle.TestFrameworkType

plugins {
    id("org.jetbrains.intellij.platform") version "2.3.0"
    kotlin("jvm") version "2.0.21"
}

group = "com.adityakumar"
version = "0.1.0"

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
    pluginConfiguration {
        name = "Large File Compare"
        version = "0.1.0"
        ideaVersion {
            sinceBuild = "241"
            // untilBuild is intentionally NOT set — leaving it open allows install on future IDE versions
        }
    }
    signing {
        // Signing config populated at publish time via environment variables
    }
    publishing {
        token = providers.environmentVariable("PUBLISH_TOKEN")
    }
}

kotlin {
    // Compile with the installed JDK 21 toolchain, but emit Java 17 bytecode:
    // IntelliJ Platform 2024.1 (since-build 241) runs plugins/tests on Java 17,
    // so 21-targeted class files fail to load at test/runtime.
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
