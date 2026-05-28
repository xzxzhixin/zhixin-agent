package cn.zhixin.agent;

/**
 * 内部文件定位链接。
 * <p>
 * 聊天消息、插件页面和 Markdown 渲染内容点击该链接时，应由 IDEA 插件打开文件并跳转到指定行号。
 */
public final class InternalFileLink {
    /** projectId：目标文件所属项目 UUID。 */
    private final String projectId;
    /** absolutePath：目标文件绝对路径，用于本机 IDE 精确定位。 */
    private final String absolutePath;
    /** relativePath：目标文件相对项目路径，用于迁移和展示。 */
    private final String relativePath;
    /** startLine：跳转起始行号，从 1 开始；没有行号时为 0。 */
    private final int startLine;
    /** endLine：跳转结束行号，从 1 开始；没有行号时为 0。 */
    private final int endLine;
    /** label：链接展示短文本。 */
    private final String label;

    /**
     * InternalFileLink：创建内部文件定位链接。
     *
     * @param projectId 项目 UUID。
     * @param absolutePath 文件绝对路径。
     * @param relativePath 文件相对项目路径。
     * @param startLine 起始行号，未指定时为 0。
     * @param endLine 结束行号，未指定时为 0。
     * @param label UI 展示短标签。
     */
    public InternalFileLink(
            String projectId,
            String absolutePath,
            String relativePath,
            int startLine,
            int endLine,
            String label
    ) {
        // projectId：用于确认目标文件属于当前项目。
        this.projectId = projectId;
        // absolutePath：本机跳转时优先使用。
        this.absolutePath = absolutePath;
        // relativePath：项目迁移或路径变化时用于辅助定位。
        this.relativePath = relativePath;
        // startLine：没有行号时使用 0。
        this.startLine = startLine;
        // endLine：没有行号时使用 0。
        this.endLine = endLine;
        // label：用于 UI 短文本展示。
        this.label = label;
    }

    /** @return 项目 UUID。 */
    public String projectId() {
        return projectId;
    }

    /** @return 文件绝对路径。 */
    public String absolutePath() {
        return absolutePath;
    }

    /** @return 文件相对项目路径。 */
    public String relativePath() {
        return relativePath;
    }

    /** @return 起始行号。 */
    public int startLine() {
        return startLine;
    }

    /** @return 结束行号。 */
    public int endLine() {
        return endLine;
    }

    /** @return UI 展示短标签。 */
    public String label() {
        return label;
    }
}
