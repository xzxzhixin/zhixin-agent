/**
 * AgentToolName：智能体可注入工具名称。
 */
export type AgentToolName =
    | "create-long-term-agent"
    | "create-sub-agent";

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
 * BaseAgent：智能体执行基类。
 *
 * 用途：承载共享上下文、工具权限、任务执行、事件写入和记忆边界。
 * 关键逻辑：派生类只通过 getCreationTools 暴露允许的创建工具，禁止调用方按字段猜测权限。
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
     * getCreationTools：返回当前智能体允许注入的创建工具。
     *
     * @returns 工具名称列表。
     */
    abstract getCreationTools(): AgentToolName[];

    /**
     * canUseCreationTool：判断当前智能体是否可使用某个创建工具。
     *
     * @param toolName 工具名称。
     * @returns 允许使用时返回 true。
     */
    canUseCreationTool(toolName: AgentToolName): boolean {
        return this.getCreationTools().includes(toolName);
    }
}
