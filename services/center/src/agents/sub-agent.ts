import {
    BaseAgent,
    type AgentKind,
    type AgentToolName,
    type BaseAgentInput,
} from "./base-agent.js";

/**
 * SubAgent：一次性子智能体执行对象。
 *
 * 用途：只执行当前任务内的短期工作，禁止继续创建任何智能体。
 */
export class SubAgent extends BaseAgent {
    /**
     * constructor：创建子智能体执行对象。
     *
     * @param input 子智能体身份输入。
     */
    constructor(input: BaseAgentInput) {
        super(input);
    }

    /**
     * getAgentKind：返回子智能体类型。
     *
     * @returns sub。
     */
    getAgentKind(): AgentKind {
        return "sub";
    }

    /**
     * getCreationTools：子智能体只允许维护自己的 todoList，禁止注入创建智能体工具。
     *
     * @returns todoList 工具列表。
     */
    getCreationTools(): AgentToolName[] {
        // 禁止：子智能体不能创建长期智能体，也不能继续创建子智能体；只保留自身 todoList 工具。
        return [
            "todo-list",
        ];
    }
}
