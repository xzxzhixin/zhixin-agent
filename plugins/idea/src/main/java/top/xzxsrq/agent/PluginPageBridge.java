package top.xzxsrq.agent;

/**
 * 插件页面桥接能力接口。
 * <p>
 * WebView 加载中心服务提供的 plugin.html 后，通过宿主 IDEA 插件实现这些能力。
 */
public interface PluginPageBridge {
    /**
     * currentProjectIdentity：获取当前 IDEA 项目身份。
     *
     * @return 当前项目身份信息。
     */
    ProjectIdentity currentProjectIdentity();

    /**
     * sendContextToComposer：把右键菜单产生的引用插入致心对话框输入区。
     *
     * @param payload 发送上下文动作载荷。
     */
    void sendContextToComposer(SendContextActionPayload payload);

    /**
     * openInternalFileLink：打开内部文件定位链接。
     *
     * @param link 内部文件定位链接。
     */
    void openInternalFileLink(InternalFileLink link);

    /**
     * updateConversationTabStatus：更新当前工具窗口会话页签状态标志。
     *
     * @param sessionId 中心服务项目会话 ID。
     * @param status 会话页签状态。
     */
    void updateConversationTabStatus(String sessionId, ConversationTabStatus status);

    /**
     * pluginPageUrl：返回中心服务提供的 plugin.html 地址。
     *
     * @param config IDEA 插件本机中心服务连接配置。
     * @return WebView 需要加载的插件页面 URL。
     */
    default String pluginPageUrl(CenterConnectionConfig config) {
        // plugin.html：各 IDE 插件统一使用中心服务提供的插件页面入口。
        return config.baseUrl() + "/plugin.html";
    }
}

