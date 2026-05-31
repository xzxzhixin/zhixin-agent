package top.xzxsrq.agent;

/**
 * 会话页签状态标志。
 * <p>
 * 来源：阶段 7 计划中的 IDEA 插件多页签状态要求。
 * 含义：描述 plugin.html 内项目会话页签当前需要在宿主工具窗口中提示的状态。
 * 格式：固定枚举值。
 * 默认值：IDLE。
 * 约束：实际会话事实仍来自中心服务，IDEA 插件只展示宿主侧状态标志。
 */
public enum ConversationTabStatus {
    /** IDLE：会话页签空闲，没有特殊状态标志。 */
    IDLE(""),
    /** RUNNING：会话页签正在执行任务。 */
    RUNNING("执行中"),
    /** WAITING_USER：会话页签等待用户处理。 */
    WAITING_USER("等待用户"),
    /** FAILED：会话页签最近任务失败。 */
    FAILED("失败"),
    /** UNREAD：会话页签有未读更新。 */
    UNREAD("未读");

    /** displayText：工具窗口标题中展示的中文状态。 */
    private final String displayText;

    /**
     * ConversationTabStatus：绑定中文展示文本。
     *
     * @param displayText 工具窗口标题中展示的中文状态。
     */
    ConversationTabStatus(String displayText) {
        // displayText：只用于宿主 UI 展示，不写入中心服务事实源。
        this.displayText = displayText;
    }

    /**
     * displayText：读取中文展示文本。
     *
     * @return 中文状态文本。
     */
    public String displayText() {
        // displayText：空闲状态返回空字符串，避免标题出现噪音。
        return displayText;
    }
}
