import {
    BaseAgent,
    type AgentKind,
    type AgentToolName,
    type BaseAgentInput,
} from "./base-agent.js";

/**
 * MainAgent：系统主智能体。
 *
 * 用途：直接承接用户对话，并可创建长期智能体和一次性子智能体。
 */
export class MainAgent extends BaseAgent {
    /**
     * constructor：创建主智能体执行对象。
     *
     * @param input 主智能体身份输入。
     */
    constructor(input: BaseAgentInput = {
        agentId: "main",
        name: "致心",
    }) {
        super(input);
    }

    /**
     * getAgentKind：返回主智能体类型。
     *
     * @returns main。
     */
    getAgentKind(): AgentKind {
        return "main";
    }

    /**
     * getCreationTools：主智能体可创建长期智能体和子智能体。
     *
     * @returns 创建工具列表。
     */
    getCreationTools(): AgentToolName[] {
        return [
            "create-long-term-agent",
            "create-sub-agent",
        ];
    }
}
