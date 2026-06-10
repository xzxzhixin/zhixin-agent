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
    | "skill-use"
    | "todo-list";

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
 * TodoListCreationInput：判断是否需要创建任务拆解 todoList 的输入。
 */
export interface TodoListCreationInput {
    /** taskSummary: 当前任务摘要，来源于用户输入或父级调度摘要。 */
    taskSummary: string;
    /** plannedStepCount: 已识别的计划步骤数量；简单任务通常不超过 1。 */
    plannedStepCount: number;
}

/**
 * AgentVisibleToolInput：模型工具可见性判断输入。
 */
export interface AgentVisibleToolInput {
    /** toolId: 统一工具注册表中的工具 ID，或 MCP 动态工具名。 */
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
     * getAvailableTools：返回当前智能体可注入模型的完整工具集合。
     *
     * @returns 工具名称列表。
     */
    getAvailableTools(): AgentToolName[] {
        return this.getCreationTools();
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
     * canUseTool：判断当前智能体是否可使用指定工具。
     *
     * @param toolName 工具名称。
     * @returns 允许使用时返回 true。
     */
    canUseTool(toolName: AgentToolName): boolean {
        return this.getAvailableTools().includes(toolName);
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

    /**
     * canUseTodoListTool：判断当前智能体是否允许使用 todoList 工具。
     *
     * @returns 智能体具备 todo-list 工具权限时返回 true。
     */
    canUseTodoListTool(): boolean {
        return this.canUseTool("todo-list");
    }

    /**
     * shouldCreateTodoListForTask：判断当前任务是否需要创建 todoList。
     *
     * @param input 当前任务摘要和计划步骤数量。
     * @returns 具备 todoList 工具权限且任务被拆成多个步骤时返回 true。
     */
    shouldCreateTodoListForTask(input: TodoListCreationInput): boolean {
        // 长任务拆解才需要 todoList；简单任务直接执行，避免无意义地膨胀任务状态。
        return this.canUseTodoListTool()
            && input.plannedStepCount > 1;
    }
}

/**
 * mapToolCapabilityToAgentToolName：把统一工具注册表 ID 映射为智能体权限工具名。
 *
 * @param toolId 统一工具注册表中的工具 ID。
 * @returns 智能体工具名；未知工具返回 null 以便默认拒绝。
 */
export function mapToolCapabilityToAgentToolName(toolId: string): AgentToolName | null {
    // MCP 动态工具没有单独注册 ID，统一继承 builtin.mcp.call 的权限边界。
    if (toolId.startsWith("mcp_")) {
        return "mcp-call";
    }
    if (toolId === "builtin.command.run") {
        return "command-run";
    }
    if (toolId === "builtin.agent.createLongTerm") {
        return "create-long-term-agent";
    }
    if (toolId === "builtin.agent.createSubAgent") {
        return "create-sub-agent";
    }
    if (toolId === "create-agent-team") {
        return "create-agent-team";
    }
    if (toolId === "disband-agent-team") {
        return "disband-agent-team";
    }
    if (toolId === "add-agent-team-member") {
        return "add-agent-team-member";
    }
    if (toolId === "remove-agent-team-member") {
        return "remove-agent-team-member";
    }
    if (toolId === "builtin.mcp.call") {
        return "mcp-call";
    }
    if (toolId === "builtin.skill.use") {
        return "skill-use";
    }
    return null;
}
