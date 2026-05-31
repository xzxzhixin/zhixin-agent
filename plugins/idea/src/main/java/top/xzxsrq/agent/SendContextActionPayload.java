package top.xzxsrq.agent;

import java.util.List;

/**
 * 发送上下文动作载荷。
 * <p>
 * IDEA 右键菜单动作把引用插入致心对话框输入区时使用该结构，不直接发起最终提问。
 */
public final class SendContextActionPayload {
    /** projectIdentity：当前 IDEA 项目身份，包含项目 UUID、显示名和根路径。 */
    private final ProjectIdentity projectIdentity;
    /** references：文件、文件夹或代码行引用列表。 */
    private final List<ContextReference> references;

    /**
     * SendContextActionPayload：创建右键发送上下文动作载荷。
     *
     * @param projectIdentity 项目身份信息。
     * @param references 本次右键菜单产生的引用列表。
     */
    public SendContextActionPayload(ProjectIdentity projectIdentity, List<ContextReference> references) {
        // projectIdentity：用于让中心服务识别当前项目会话。
        this.projectIdentity = projectIdentity;
        // references：只插入输入区，不直接触发发送。
        this.references = references;
    }

    /**
     * projectIdentity：读取项目身份信息。
     *
     * @return 项目身份信息。
     */
    public ProjectIdentity projectIdentity() {
        // projectIdentity：保持 record 风格访问方法，减少调用方改动。
        return projectIdentity;
    }

    /**
     * references：读取上下文引用列表。
     *
     * @return 上下文引用列表。
     */
    public List<ContextReference> references() {
        // references：返回文件、文件夹或代码行引用列表。
        return references;
    }
}

