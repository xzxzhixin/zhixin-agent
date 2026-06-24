/**
 * SelectOption：输入区下拉选项。
 *
 * 来源：执行模式和推理深度控件。
 * 含义：同时保存协议值、显示标签和说明；推理深度控件必须直接显示模型协议值。
 * 格式：固定字符串对象。
 * 默认值：无。
 * 约束：选项只服务当前输入框 UI，中心服务仍是审批和执行事实源。
 */
export interface SelectOption {
    /** value: 协议值。 */
    value: string;
    /** label: 显示标签。 */
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
 * reasoningEffortOptions：推理深度内置下拉，直接使用模型协议值作为显示文本和提交值。
 */
export const reasoningEffortOptions: SelectOption[] = [
    {
        value: "minimal",
        label: "minimal",
        description: "minimal",
    },
    {
        value: "low",
        label: "low",
        description: "low",
    },
    {
        value: "medium",
        label: "medium",
        description: "medium",
    },
    {
        value: "high",
        label: "high",
        description: "high",
    },
];
