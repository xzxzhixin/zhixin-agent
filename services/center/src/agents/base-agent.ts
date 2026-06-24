/**
 * AgentToolName：智能体可注入工具名称。
 */
export type AgentToolName =
    | "command-run"
    | "create-long-term-agent"
    | "create-sub-agent"
    | "create-agent-team"
    | "disband-agent-team"
    | "add-agent-team-member"
    | "remove-agent-team-member"
    | "mcp-call"
    | "skill-use";

/**
 * TOOL_CAPABILITY_AGENT_TOOL_MAP：统一工具 ID 到智能体权限名的映射。
 *
 * 来源：中心服务统一工具注册表和智能体权限边界设计。
 * 含义：调用方只传中心服务工具 ID，由智能体类层级统一判断可见性。
 * 约束：MCP adapter 工具由中心服务包装为 builtin.mcp.call 权限边界，不在调用点猜测权限。
 */
const TOOL_CAPABILITY_AGENT_TOOL_MAP: Readonly<Record<string, AgentToolName>> = {
    /** builtin.command.run: 中心服务内置命令执行工具。 */
    "builtin.command.run": "command-run",
    /** builtin.agent.createLongTerm: 主智能体专属长期智能体创建工具。 */
    "builtin.agent.createLongTerm": "create-long-term-agent",
    /** builtin.agent.createSubAgent: 主智能体和长期智能体可用的子智能体创建工具。 */
    "builtin.agent.createSubAgent": "create-sub-agent",
    /** create-agent-team: 主智能体专属 team 创建工具。 */
    "create-agent-team": "create-agent-team",
    /** disband-agent-team: 主智能体专属 team 解散工具。 */
    "disband-agent-team": "disband-agent-team",
    /** add-agent-team-member: 主智能体专属 team 成员添加工具。 */
    "add-agent-team-member": "add-agent-team-member",
    /** remove-agent-team-member: 主智能体专属 team 成员移除工具。 */
    "remove-agent-team-member": "remove-agent-team-member",
    /** builtin.mcp.call: MCP adapter 工具的统一权限边界。 */
    "builtin.mcp.call": "mcp-call",
    /** builtin.skill.use: skill 工作流使用权限。 */
    "builtin.skill.use": "skill-use",
};

/**
 * AgentKind：智能体执行类类型。
 */
export type AgentKind =
    | "main"
    | "long-term"
    | "sub";

/**
 * BaseAgentInput：智能体基类构造输入。
 */
export interface BaseAgentInput {
    /** agentId: 智能体 ID，主智能体固定为 main，子智能体使用运行期 ID。 */
    agentId: string;
    /** name: 智能体展示名称。 */
    name: string;
}

/**
 * AgentVisibleToolInput：模型工具可见性判断输入。
 */
export interface AgentVisibleToolInput {
    /** toolId: 统一工具注册表中的工具 ID，或 MCP adapter 工具名。 */
    toolId: string;
}

/**
 * BaseAgent：智能体执行基类。
 *
 * 用途：承载共享上下文、工具权限、任务执行、事件写入和记忆边界。
 * 关键逻辑：派生类只通过工具清单暴露权限，禁止调用方按字段猜测权限。
 */
export abstract class BaseAgent {
    /** agentId: 智能体 ID。 */
    protected readonly agentId: string;
    /** name: 智能体展示名称。 */
    protected readonly name: string;

    /**
     * constructor：保存智能体基础身份。
     *
     * @param input 智能体基础身份输入。
     */
    protected constructor(input: BaseAgentInput) {
        this.agentId = input.agentId;
        this.name = input.name;
    }

    /**
     * getAgentKind：返回智能体类型。
     *
     * @returns 智能体类型。
     */
    abstract getAgentKind(): AgentKind;

    /**
     * getCreationTools：返回当前智能体允许注入的创建类工具。
     *
     * @returns 工具名称列表。
     */
    abstract getCreationTools(): AgentToolName[];

    /**
     * getExecutionTools：返回所有智能体都可按上下文裁决使用的任务执行工具。
     *
     * @returns 任务执行类工具列表。
     */
    getExecutionTools(): AgentToolName[] {
        return [
            "command-run",
            "mcp-call",
            "skill-use",
        ];
    }

    /**
     * getAvailableTools：返回当前智能体可注入模型的完整工具集合。
     *
     * @returns 工具名称列表。
     */
    getAvailableTools(): AgentToolName[] {
        return [
            ...this.getExecutionTools(),
            ...this.getCreationTools(),
        ];
    }

    /**
     * canUseTool：判断当前智能体是否可使用指定工具。
     *
     * @param toolName 工具名称。
     * @returns 允许使用时返回 true。
     */
    canUseTool(toolName: AgentToolName): boolean {
        return this.getAvailableTools().includes(toolName);
    }

    /**
     * canUseCreationTool：判断当前智能体是否可使用某个创建工具。
     *
     * @param toolName 工具名称。
     * @returns 允许使用时返回 true。
     */
    canUseCreationTool(toolName: AgentToolName): boolean {
        return this.getCreationTools().includes(toolName);
    }

    /**
     * canUseToolCapability：按中心服务统一工具 ID 判断模型工具是否可注入或执行。
     *
     * @param toolId 统一工具注册表中的工具 ID。
     * @returns 当前智能体允许使用该工具时返回 true。
     */
    canUseToolCapability(toolId: string): boolean {
        const mappedToolName = mapToolCapabilityToAgentToolName(toolId);
        return mappedToolName ? this.canUseTool(mappedToolName) : false;
    }

    /**
     * canUseModelTool：判断工具是否能暴露给当前智能体模型请求。
     *
     * @param input 模型工具可见性判断输入。
     * @returns 当前智能体允许看到该工具时返回 true。
     */
    canUseModelTool(input: AgentVisibleToolInput): boolean {
        return this.canUseToolCapability(input.toolId);
    }

}

/**
 * mapToolCapabilityToAgentToolName：把统一工具注册表 ID 映射为智能体权限工具名。
 *
 * @param toolId 统一工具注册表中的工具 ID。
 * @returns 智能体工具名；未知工具返回 null 以便默认拒绝。
 */
export function mapToolCapabilityToAgentToolName(toolId: string): AgentToolName | null {
    // 兼容历史 mcp_ 前缀工具名；新 MCP adapter 工具由 wrapper 统一使用 builtin.mcp.call。
    if (toolId.startsWith("mcp_")) {
        return "mcp-call";
    }
    return TOOL_CAPABILITY_AGENT_TOOL_MAP[toolId] ?? null;
}
