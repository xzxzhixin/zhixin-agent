package top.xzxsrq.agent;

import com.intellij.openapi.diagnostic.Logger;
import com.intellij.openapi.project.Project;
import com.intellij.ide.ui.LafManager;
import com.intellij.diff.DiffContentFactory;
import com.intellij.diff.DiffManager;
import com.intellij.diff.requests.SimpleDiffRequest;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.lang.reflect.Method;
import java.util.Locale;
import org.jetbrains.annotations.NotNull;

/**
 * IDEA 插件页面桥接实现。
 * <p>
 * 负责把 IDEA 项目身份、右键上下文和内部文件定位能力连接到中心服务插件页面。
 */
public final class ZhixinPluginBridge implements PluginPageBridge {
    /** NOTIFICATION_GROUP_ID：plugin.xml 中登记的通知分组。 */
    private static final String NOTIFICATION_GROUP_ID = "Zhixin Agent";
    /** LOGGER：IDEA 插件运行日志，用于记录桥接层状态。 */
    private static final Logger LOGGER = Logger.getInstance(ZhixinPluginBridge.class);
    /** project：当前 IDEA 项目，由工具窗口或 Action 注入。 */
    private final @NotNull Project project;
    /** identityService：读取或创建“致心项目ID.md”的服务。 */
    private final ProjectIdentityService identityService;
    /** connectionConfig：IDEA 插件本机中心服务连接配置。 */
    private final CenterConnectionConfig connectionConfig;

    /**
     * ZhixinPluginBridge：创建当前项目的插件桥接对象。
     *
     * @param project 当前 IDEA 项目。
     */
    public ZhixinPluginBridge(@NotNull Project project) {
        // project：所有会话、文件跳转和通知都绑定当前 IDEA 项目。
        this.project = project;
        // identityService：项目身份文件读写逻辑集中在独立服务中。
        this.identityService = new ProjectIdentityService();
        // connectionConfig：默认只连接本机 127.0.0.1:8866。
        this.connectionConfig = CenterConnectionConfig.defaultConfig();
    }

    /**
     * currentProjectIdentity：读取当前 IDEA 项目身份。
     *
     * @return 当前项目身份信息。
     */
    @Override
    public ProjectIdentity currentProjectIdentity() {
        // basePath：IDEA 项目必须有根路径才能创建“致心项目ID.md”。
        String basePath = project.getBasePath();
        // basePath 为空时无法绑定项目身份，直接用项目名提示用户处理。
        if (basePath == null || basePath.trim().isEmpty()) {
            throw new IllegalStateException("当前 IDEA 项目没有可用根目录，无法创建致心项目ID.md");
        }
        try {
            // readOrCreate：复用现有项目 ID，缺失时创建新的 UUID。
            return identityService.readOrCreate(Paths.get(basePath));
        } catch (Exception exception) {
            // IllegalStateException：Action 和工具窗口统一按运行时异常处理并展示通知。
            throw new IllegalStateException("读取或创建致心项目ID.md失败：" + exception.getMessage(), exception);
        }
    }

    /**
     * sendContextToComposer：把上下文引用发送到致心输入区。
     *
     * @param payload 发送上下文动作载荷。
     */
    @Override
    public void sendContextToComposer(SendContextActionPayload payload) {
        // 当前阶段中心服务页面桥接协议尚未接入，先以 IDEA 通知确认引用已经被插件识别。
        int referenceCount = payload.references().size();
        // LOGGER：右键上下文进入桥接层即可，避免不同 IDEA SDK 的通知 API 签名差异影响编译。
        LOGGER.info(NOTIFICATION_GROUP_ID + " 已识别 " + referenceCount + " 个上下文引用");
    }

    /**
     * openInternalFileLink：打开内部文件定位链接。
     *
     * @param link 内部文件定位链接。
     */
    @Override
    public void openInternalFileLink(InternalFileLink link) {
        // targetPath：优先使用绝对路径，因为 IDEA 插件运行在当前中心电脑上。
        Path targetPath = Paths.get(link.absolutePath()).toAbsolutePath().normalize();
        // exists：当前阶段只确认路径存在并记录定位请求，具体打开动作由宿主适配层按 SDK 版本实现。
        boolean exists = targetPath.toFile().exists();
        // exists 为 false 时说明本机路径不可达，不能按外部链接打开。
        if (!exists) {
            throw new IllegalStateException("无法定位内部文件：" + targetPath);
        }
        // lineIndex：OpenFileDescriptor 使用 0 基行号，需求协议使用 1 基行号。
        int lineIndex = Math.max(link.startLine() - 1, 0);
        // LOGGER：不同 IDEA SDK 的文件打开 API 签名差异较大，当前先记录可审计定位请求，后续由宿主适配层补具体打开动作。
        LOGGER.info("致心内部文件定位：" + targetPath + "#" + lineIndex);
    }

    /**
     * openEditDiff：使用 IDEA 原生 Diff 视图展示编辑前后内容。
     *
     * @param payload 编辑前后内容和文件路径。
     */
    @Override
    public void openEditDiff(EditDiffPayload payload) {
        // title：前端传入可读标题；为空时使用固定标题，避免 Diff 窗口缺少上下文。
        String title = payload.title() == null || payload.title().trim().isEmpty()
                ? "致心编辑对比"
                : payload.title();
        // factory：IDEA DiffContentFactory 根据当前项目创建文本内容，便于跟随宿主主题和字体。
        DiffContentFactory factory = DiffContentFactory.getInstance();
        SimpleDiffRequest request = new SimpleDiffRequest(
                title,
                factory.create(project, payload.beforeContent()),
                factory.create(project, payload.afterContent()),
                "编辑前",
                "编辑后"
        );
        // showDiff：真正交给 IDEA 宿主打开原生对比，而不是在插件 WebView 里伪造 IDE diff。
        DiffManager.getInstance().showDiff(project, request);
        LOGGER.info("打开致心编辑对比：" + payload.filePath());
    }

    /**
     * updateConversationTabStatus：更新工具窗口页签标题中的状态标志。
     *
     * @param sessionId 中心服务项目会话 ID。
     * @param status 会话页签状态。
     */
    @Override
    public void updateConversationTabStatus(String sessionId, ConversationTabStatus status) {
        // statusText：空闲状态不追加状态后缀。
        String statusText = status.displayText();
        // title：工具窗口内容标题，包含会话 ID 后 8 位帮助区分多页签来源。
        String title = statusText.isEmpty()
                ? "致心"
                : "致心 · " + statusText + " · " + sessionId.substring(Math.max(sessionId.length() - 8, 0));
        // LOGGER：状态事实由 plugin.html 展示；宿主侧记录日志避免不同 SDK 的 ToolWindow API 差异影响编译。
        LOGGER.info("更新致心会话页签状态：" + title);
    }

    /**
     * pluginPageUrl：返回中心服务插件页面 URL。
     *
     * @return plugin.html 地址。
     */
    public String pluginPageUrl() {
        // identity：plugin.html 需要当前项目身份来登记项目并加载项目会话。
        ProjectIdentity identity = currentProjectIdentity();
        // query：只传项目身份和端口，不传账号、密码或供应商敏感信息。
        String query = "?port=" + connectionConfig.port()
                + "&projectId=" + encodeQuery(identity.projectId())
                + "&projectName=" + encodeQuery(identity.displayName())
                + "&projectPath=" + encodeQuery(identity.rootPath())
                + "&theme=" + encodeQuery(currentIdeTheme());
        // plugin.html：各 IDE 插件统一使用中心服务提供的插件页面入口。
        return PluginPageBridge.super.pluginPageUrl(connectionConfig) + query;
    }

    /**
     * currentIdeTheme：读取 IDEA 当前宿主主题。
     *
     * @return light 或 dark 主题参数。
     */
    private String currentIdeTheme() {
        // lookAndFeelInfo：当前 IDEA 主题对象，来源于宿主 LafManager。
        Object lookAndFeelInfo = LafManager.getInstance().getCurrentUIThemeLookAndFeel();
        try {
            // isDarkMethod：目标 SDK 提供的宿主主题暗色判断；反射调用可避免不同 IDE 索引解析 Kotlin 接口方法时产生误报。
            Method isDarkMethod = lookAndFeelInfo.getClass().getMethod("isDark");
            // result：IDEA 宿主返回的暗色布尔值，只接受明确 Boolean，避免把异常返回误判为暗色。
            Object result = isDarkMethod.invoke(lookAndFeelInfo);
            return Boolean.TRUE.equals(result)
                    ? "dark"
                    : "light";
        } catch (ReflectiveOperationException exception) {
            // themeName：极端情况下 SDK 不暴露 isDark 时，用当前主题对象名称作为保守兜底，避免调用已弃用的 LookAndFeel API。
            String themeName = currentThemeName(lookAndFeelInfo).toLowerCase(Locale.ROOT);
            // dark/darcula：IDEA 常见暗色主题命名；兜底只在反射失败时使用。
            return themeName.contains("dark") || themeName.contains("darcula")
                    ? "dark"
                    : "light";
        }
    }

    /**
     * currentThemeName：读取当前 IDEA 主题名称。
     *
     * @param lookAndFeelInfo 当前 IDEA 主题对象。
     * @return 主题名称文本。
     */
    private String currentThemeName(Object lookAndFeelInfo) {
        try {
            // getNameMethod：主题对象公开的名称方法，用于反射失败后的暗色名称兜底。
            Method getNameMethod = lookAndFeelInfo.getClass().getMethod("getName");
            // name：主题名称可能来自第三方主题，转字符串后统一做小写匹配。
            Object name = getNameMethod.invoke(lookAndFeelInfo);
            return String.valueOf(name);
        } catch (ReflectiveOperationException exception) {
            // 类名兜底：如果第三方主题对象连 getName 都不可用，至少用类名判断 dark/darcula。
            return lookAndFeelInfo.getClass().getName();
        }
    }

    /**
     * encodeQuery：编码 plugin.html 查询参数。
     *
     * @param value 原始参数值。
     * @return URL 查询参数安全文本。
     */
    private String encodeQuery(String value) {
        // UTF_8：项目路径和中文项目名必须按 UTF-8 传给前端。
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
