package top.xzxsrq.agent;

/**
 * 发送到致心对话框输入区的上下文引用。
 * <p>
 * 右键菜单点击后只插入引用，不直接发起最终提问，用户可以继续编辑文本后再发送。
 */
public final class ContextReference {
    /** type：引用类型，决定 UI 标签图标和内部定位能力。 */
    private final ContextReferenceType type;
    /** projectId：项目 UUID，避免项目路径变化后无法关联会话。 */
    private final String projectId;
    /** absolutePath：本机 IDE 打开文件或文件夹时使用的绝对路径。 */
    private final String absolutePath;
    /** relativePath：迁移和展示时使用的项目相对路径。 */
    private final String relativePath;
    /** displayText：输入框引用标签展示文本。 */
    private final String displayText;
    /** startLine：代码引用起始行号，从 1 开始；非代码引用为 0。 */
    private final int startLine;
    /** endLine：代码引用结束行号，从 1 开始；非代码引用为 0。 */
    private final int endLine;
    /** selectedText：选中的代码内容；非代码引用为空字符串。 */
    private final String selectedText;

    /**
     * ContextReference：创建发送到致心输入区的上下文引用。
     *
     * @param type 引用类型，区分文件、文件夹和代码。
     * @param projectId 项目 UUID，来自“致心项目ID.md”。
     * @param absolutePath 引用目标绝对路径。
     * @param relativePath 引用目标相对项目根目录路径。
     * @param displayText UI 标签展示文本，例如 文件名 或 文件名#L1-L3。
     * @param startLine 代码引用起始行号，文件和文件夹引用为 0。
     * @param endLine 代码引用结束行号，文件和文件夹引用为 0。
     * @param selectedText 选中代码内容，文件和文件夹引用为空字符串。
     */
    public ContextReference(
            ContextReferenceType type,
            String projectId,
            String absolutePath,
            String relativePath,
            String displayText,
            int startLine,
            int endLine,
            String selectedText
    ) {
        // type：决定中心服务和 UI 如何解释该引用。
        this.type = type;
        // projectId：用于把引用归属到正确项目会话。
        this.projectId = projectId;
        // absolutePath：用于本机 IDE 精确打开目标。
        this.absolutePath = absolutePath;
        // relativePath：用于项目迁移后辅助识别目标。
        this.relativePath = relativePath;
        // displayText：用于输入框引用标签短展示。
        this.displayText = displayText;
        // startLine：代码引用定位起点，非代码引用固定 0。
        this.startLine = startLine;
        // endLine：代码引用定位终点，非代码引用固定 0。
        this.endLine = endLine;
        // selectedText：代码引用携带选区内容，文件和文件夹引用为空字符串。
        this.selectedText = selectedText;
    }

    /** @return 引用类型。 */
    public ContextReferenceType type() {
        return type;
    }

    /** @return 项目 UUID。 */
    public String projectId() {
        return projectId;
    }

    /** @return 引用目标绝对路径。 */
    public String absolutePath() {
        return absolutePath;
    }

    /** @return 引用目标相对项目路径。 */
    public String relativePath() {
        return relativePath;
    }

    /** @return UI 标签展示文本。 */
    public String displayText() {
        return displayText;
    }

    /** @return 代码引用起始行号。 */
    public int startLine() {
        return startLine;
    }

    /** @return 代码引用结束行号。 */
    public int endLine() {
        return endLine;
    }

    /** @return 选中代码内容。 */
    public String selectedText() {
        return selectedText;
    }
}

