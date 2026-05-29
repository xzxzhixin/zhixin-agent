import org.jetbrains.intellij.platform.gradle.extensions.intellijPlatform

pluginManagement {
    repositories {
        // mavenLocal：优先复用用户本地 Maven 仓库中的 Gradle 插件和元数据。
        mavenLocal()
        // aliyunPublic：用户指定的阿里云 Maven 公共镜像，用于 Gradle 插件和插件依赖解析。
        maven {
            name = "aliyunPublic"
            url = uri("https://maven.aliyun.com/repository/public")
            mavenContent {
                releasesOnly()
            }
        }
        // gradlePluginPortal：Gradle 插件官方仓库，用于本地 Maven 缺失时下载插件。
        gradlePluginPortal()
        // mavenCentral：部分插件依赖会从 Maven Central 解析。
        mavenCentral()
    }
}

plugins {
    // org.jetbrains.intellij.platform.settings：让 settings.gradle.kts 可以使用 intellijPlatform 仓库 DSL。
    // 这里先加载 settings 插件，再在后续依赖仓库块里调用 JetBrains 官方仓库扩展。
    id("org.jetbrains.intellij.platform.settings") version "2.9.0"
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        // mavenLocal：必须排在远程仓库前面，避免已有依赖重复下载。
        mavenLocal()
        // aliyunPublic：用户指定的阿里云 Maven 公共镜像，用于优先解析 Maven 依赖。
        maven {
            name = "aliyunPublic"
            url = uri("https://maven.aliyun.com/repository/public")
            mavenContent {
                releasesOnly()
            }
        }
        // mavenCentral：普通 Java 测试依赖和 Gradle 插件传递依赖来源。
        mavenCentral()
        // intellijPlatform：JetBrains 官方平台依赖仓库集合。
        // 该 DSL 由 org.jetbrains.intellij.platform.settings 插件和顶部 import 共同提供。
        intellijPlatform {
            defaultRepositories()
        }
    }
}

// rootProject.name：IDE 插件平台包名，格式固定为 zhixin-agent-平台名。
// IDEA 平台使用 idea 后缀，确保 Gradle 工具窗口和安装包名称都能直接识别平台归属。
rootProject.name = "zhixin-agent-idea"
