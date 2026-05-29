package top.xzxsrq.agent;

/**
 * 项目身份信息。
 * <p>
 * IDEA 插件打开项目时读取或创建“致心项目ID.md”，然后把项目 ID、项目名称和项目路径发送给中心服务。
 */
public final class ProjectIdentity {
    /** projectId：项目 UUID，跟随项目目录迁移。 */
    private final String projectId;
    /** displayName：项目显示名，默认来自项目文件夹名。 */
    private final String displayName;
    /** rootPath：项目根目录绝对路径。 */
    private final String rootPath;

    /**
     * ProjectIdentity：创建项目身份信息。
     *
     * @param projectId 项目 UUID，跟随项目目录迁移。
     * @param displayName 项目显示名，默认来自项目文件夹名。
     * @param rootPath 项目根目录绝对路径。
     */
    public ProjectIdentity(String projectId, String displayName, String rootPath) {
        // projectId：调用方必须传入“致心项目ID.md”中的 UUID。
        this.projectId = projectId;
        // displayName：用于 UI 展示，默认来自项目目录名。
        this.displayName = displayName;
        // rootPath：用于计算项目内相对路径。
        this.rootPath = rootPath;
    }

    /**
     * projectId：读取项目 UUID。
     *
     * @return 项目 UUID。
     */
    public String projectId() {
        // projectId：保持 record 风格访问方法，减少调用方改动。
        return projectId;
    }

    /**
     * displayName：读取项目显示名。
     *
     * @return 项目显示名。
     */
    public String displayName() {
        // displayName：返回中心服务和插件页面展示名称。
        return displayName;
    }

    /**
     * rootPath：读取项目根目录绝对路径。
     *
     * @return 项目根目录绝对路径。
     */
    public String rootPath() {
        // rootPath：返回计算上下文引用相对路径的根路径。
        return rootPath;
    }
}

