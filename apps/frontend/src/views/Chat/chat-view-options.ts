/**
 * SelectOption：输入区下拉选项。
 *
 * 来源：执行模式和推理深度控件。
 * 含义：同时保存协议值、中文标签和说明，避免用户看到裸英文枚举。
 * 格式：固定字符串对象。
 * 默认值：无。
 * 约束：选项只服务当前输入框 UI，中心服务仍是审批和执行事实源。
 */
export interface SelectOption {
    /** value: 协议值。 */
    value: string;
    /** label: 中文标签。 */
    label: string;
    /** description: 选项解释。 */
    description: string;
}

/**
 * executionModeOptions：执行模式完整下拉，来源于需求中的三种执行模式。
 */
export const executionModeOptions: SelectOption[] = [
    {
        value: "suggest",
        label: "建议模式",
        description: "每一步副作用操作都需要用户确认，适合需要逐步审阅的对话。",
    },
    {
        value: "auto_edit",
        label: "自动编辑",
        description: "低风险读取或编辑流程可自动执行，高风险操作仍需用户确认。",
    },
    {
        value: "full_auto",
        label: "全自动",
        description: "在权限和沙箱范围内自动执行，写文件和命令会立即生效。",
    },
];

/**
 * reasoningEffortOptions：推理深度内置下拉；动态供应商推理深度接入前先提供明确中文解释。
 */
export const reasoningEffortOptions: SelectOption[] = [
    {
        value: "low",
        label: "低推理",
        description: "更快响应，适合简单问题",
    },
    {
        value: "medium",
        label: "中推理",
        description: "默认平衡速度和质量",
    },
    {
        value: "high",
        label: "高推理",
        description: "更充分分析复杂任务",
    },
    {
        value: "xhigh",
        label: "超高推理",
        description: "最充分分析，耗时更长",
    },
];
