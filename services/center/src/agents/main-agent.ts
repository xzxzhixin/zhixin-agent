import {
    BaseAgent,
    type AgentKind,
    type AgentToolName,
    type BaseAgentInput,
} from "./base-agent.js";

/**
 * MainAgent：系统主智能体。
 *
 * 用途：直接承接用户对话，并可创建长期智能体、一次性子智能体和会话级 team。
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
     * getCreationTools：主智能体可创建长期智能体、子智能体，并管理会话级 team。
     *
     * @returns 创建和 team 管理工具列表。
     */
    getCreationTools(): AgentToolName[] {
        return [
            "create-long-term-agent",
            "create-sub-agent",
            "create-agent-team",
            "disband-agent-team",
            "add-agent-team-member",
            "remove-agent-team-member",
        ];
    }

}
