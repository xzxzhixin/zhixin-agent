package cn.zhixin.agent;

/**
 * IDEA 项目会话范围。
 * <p>
 * 该对象要求 IDEA 插件只请求当前项目 ID 下的数据，不能展示其他项目会话。
 */
public final class IdeaProjectConversationScope {
    /** projectId：当前 IDEA 项目的 UUID。 */
    private final String projectId;

    /**
     * IdeaProjectConversationScope：创建当前项目会话范围。
     *
     * @param projectId 当前项目 UUID。
     */
    public IdeaProjectConversationScope(String projectId) {
        // projectId：来自“致心项目ID.md”，不能使用项目路径替代。
        this.projectId = projectId;
    }

    /**
     * sessionsPath：构造只读取当前项目会话的中心服务路径。
     *
     * @return 带 projectId 的会话查询路径。
     */
    public String sessionsPath() {
        // projectId：中心服务收到后按项目过滤，IDEA 插件不展示其他项目。
        return "/sessions?projectId=" + projectId;
    }

    /**
     * mcpPath：构造当前项目允许 MCP 能力查询路径。
     *
     * @return 带 projectId 的 MCP 查询路径。
     */
    public String mcpPath() {
        // projectId：项目聊天只能使用当前项目允许的 MCP 能力。
        return "/mcp?projectId=" + projectId;
    }
}
