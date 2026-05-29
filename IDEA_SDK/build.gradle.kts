plugins {
    // java：编译 IDEA 插件 Java 源码。
    java
    // intellijPlatform：JetBrains 官方 IntelliJ Platform 插件构建工具。
    id("org.jetbrains.intellij.platform")
}

// group：插件 Maven 坐标命名空间，和包名保持一致。
group = "top.xzxsrq"
// version：插件版本，和 plugin.xml 版本保持一致。
version = "0.1.0"

base {
    // archivesName：普通归档产物名称，和各 IDE 插件平台包名规则保持一致。
    archivesName.set("zhixin-agent-idea")
}


dependencies {
    // intellijPlatform：下载目标 IDEA Ultimate 平台并提供插件编译、运行、打包任务。
    intellijPlatform {
        intellijIdeaUltimate("2026.1")
        bundledPlugin("com.intellij.java")
        pluginVerifier()
        zipSigner()
    }

    // testImplementation：JUnit 用于验证项目 ID、插件描述文件和连接配置。
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.4")
}

intellijPlatform {
    pluginConfiguration {
        // id：IDEA 插件安装和升级识别 ID。
        id = "top.xzxsrq.zhixin-agent"
        // name：插件管理器中展示的中文名称。
        name = "致心智能体"
        // version：使用项目版本作为插件版本。
        version = project.version.toString()

        ideaVersion {
            // sinceBuild：插件面向 IDEA 2026.1 起始构建号。
            sinceBuild = "261"
        }
    }
}

tasks {
    // withType<JavaCompile>：使用 IDEA 配置的 Gradle JVM 编译，但固定输出 Java 21 字节码。
    // 这样不要求本机额外安装 JDK 21，避免 Gradle toolchain 在 IDEA 集成环境外自行查找或下载 JDK。
    withType<JavaCompile>().configureEach {
        options.release.set(21)
    }

    // buildSearchableOptions：当前插件没有 Settings 配置页，不需要生成可搜索配置索引。
    // 禁用该任务可以避免 buildPlugin 打包阶段额外启动沙箱 IDE 导致构建长时间挂起。
    named("buildSearchableOptions") {
        enabled = false
    }

    // test：统一使用 JUnit Platform。
    test {
        useJUnitPlatform()
    }

    // patchPluginXml：让 Gradle 插件把版本等信息写入 plugin.xml。
    patchPluginXml {
        sinceBuild.set("261")
    }
}
