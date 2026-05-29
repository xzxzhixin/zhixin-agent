package top.xzxsrq.agent;

import com.intellij.notification.NotificationGroupManager;
import com.intellij.notification.NotificationType;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.fileEditor.OpenFileDescriptor;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.vfs.LocalFileSystem;
import com.intellij.openapi.vfs.VirtualFile;

import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * IDEA 插件页面桥接实现。
 * <p>
 * 负责把 IDEA 项目身份、右键上下文和内部文件定位能力连接到中心服务插件页面。
 */
public final class ZhixinPluginBridge implements PluginPageBridge {
    /** NOTIFICATION_GROUP_ID：plugin.xml 中登记的通知分组。 */
    private static final String NOTIFICATION_GROUP_ID = "Zhixin Agent";
    /** project：当前 IDEA 项目，由工具窗口或 Action 注入。 */
    private final Project project;
    /** identityService：读取或创建“致心项目ID.md”的服务。 */
    private final ProjectIdentityService identityService;
    /** connectionConfig：IDEA 插件本机中心服务连接配置。 */
    private final CenterConnectionConfig connectionConfig;

    /**
     * ZhixinPluginBridge：创建当前项目的插件桥接对象。
     *
     * @param project 当前 IDEA 项目。
     */
    public ZhixinPluginBridge(Project project) {
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
        // notification：通知用户右键上下文已进入插件桥接层，后续接入 WebView 输入区。
        NotificationGroupManager.getInstance()
                .getNotificationGroup(NOTIFICATION_GROUP_ID)
                .createNotification(
                        "致心上下文已识别",
                        "已识别 " + referenceCount + " 个上下文引用，请在致心工具窗口中继续编辑发送。",
                        NotificationType.INFORMATION
                )
                .notify(project);
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
        // virtualFile：刷新查找文件，确保新生成文件也能被定位。
        VirtualFile virtualFile = LocalFileSystem.getInstance().refreshAndFindFileByNioFile(targetPath);
        // virtualFile 为空时说明本机路径不可达，不能按外部链接打开。
        if (virtualFile == null) {
            throw new IllegalStateException("无法定位内部文件：" + targetPath);
        }
        // lineIndex：OpenFileDescriptor 使用 0 基行号，需求协议使用 1 基行号。
        int lineIndex = Math.max(link.startLine() - 1, 0);
        // descriptor：只负责打开和跳转，不改变聊天消息内容。
        OpenFileDescriptor descriptor = new OpenFileDescriptor(project, virtualFile, lineIndex, 0);
        // openTextEditor：让 IDEA 在编辑器中打开目标文件。
        FileEditorManager.getInstance(project).openTextEditor(descriptor, true);
    }

    /**
     * pluginPageUrl：返回中心服务插件页面 URL。
     *
     * @return plugin.html 地址。
     */
    public String pluginPageUrl() {
        // PluginPageBridge 默认方法统一拼接 /plugin.html。
        return PluginPageBridge.super.pluginPageUrl(connectionConfig);
    }
}
