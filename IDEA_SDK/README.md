# IDEA_SDK

IDEA 插件接入 SDK 使用 Gradle IntelliJ Platform Plugin 管理构建，包名和插件 ID 命名空间统一使用 `top.xzxsrq`。

## 当前能力

- 读取或创建项目根目录中的 `致心项目ID.md`。
- 使用 UUID 作为项目身份，避免项目迁移后因路径变化丢失关联。
- 固定连接中心服务地址格式为 `http://127.0.0.1:端口`，默认端口 `8866`。
- 提供 `META-INF/plugin.xml`，可作为 IDEA 插件被识别和安装。
- 提供“致心”工具窗口，加载本机中心服务提供的 `plugin.html`。
- 提供编辑器选区、编辑器标签页和项目文件树右键菜单入口，把上下文引用发送到致心输入区。

## 构建与依赖缓存

Gradle 仓库优先使用 `mavenLocal()`，本地 Maven 仓库已有依赖不会重复下载。

远程 Maven 仓库按用户指定接入阿里云公共镜像：

```md
https://maven.aliyun.com/repository/public
```

Gradle 自身下载缓存由 IDEA Gradle 集成和本机 IDE 配置管理，项目文件不写入个人机器的绝对缓存路径。

构建入口统一使用 IDEA Run Configuration，避免手工脚本重复维护 Java、Gradle 和缓存环境。
Java 编译使用 IDEA Gradle JVM 执行，并通过 Gradle `options.release = 21` 固定输出 Java 21 字节码；项目不启用 Gradle toolchain 自动查找或下载 JDK，避免脱离 IDEA 集成环境后报本机缺少 JDK 21。
当前插件没有 Settings 配置页，`buildSearchableOptions` 已禁用，避免 `buildPlugin` 打包阶段额外启动沙箱 IDE 导致构建长时间挂起。

可用配置：

```md
zhixin-agent-idea [clean]
zhixin-agent-idea [buildPlugin]
```

插件 ZIP 产物位于：

```md
build/distributions
```

各 IDE 插件平台的工程名和安装包名统一使用 `zhixin-agent-平台名` 格式；IDEA 平台固定为 `zhixin-agent-idea`。
插件安装包 ZIP 由 IntelliJ Platform Gradle Plugin 按当前 Gradle 工程名输出为 `zhixin-agent-idea-版本.zip`；普通归档产物也通过 `archivesName` 保持同名。
