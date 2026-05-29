package top.xzxsrq.agent;

/**
 * IDEA 右键菜单动作登记器抽象。
 * <p>
 * 真实 IDEA ActionSystem 接入时由插件宿主实现，本 SDK 固定菜单入口和载荷转换规则。
 */
public interface ContextMenuActionRegistrar {
    /**
     * registerEditorSelectionAction：登记编辑器选区发送入口。
     *
     * @param bridge 插件页面桥接能力。
     */
    void registerEditorSelectionAction(PluginPageBridge bridge);

    /**
     * registerEditorTabAction：登记编辑器标签页文件发送入口。
     *
     * @param bridge 插件页面桥接能力。
     */
    void registerEditorTabAction(PluginPageBridge bridge);

    /**
     * registerProjectTreeFileAction：登记项目文件树文件发送入口。
     *
     * @param bridge 插件页面桥接能力。
     */
    void registerProjectTreeFileAction(PluginPageBridge bridge);

    /**
     * registerProjectTreeDirectoryAction：登记项目文件树文件夹发送入口。
     *
     * @param bridge 插件页面桥接能力。
     */
    void registerProjectTreeDirectoryAction(PluginPageBridge bridge);
}

