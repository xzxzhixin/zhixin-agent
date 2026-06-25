import {
    BaseAgent,
    type AgentKind,
    type AgentToolName,
    type BaseAgentInput,
} from "./base-agent.js";

/**
 * MainAgent：系统主智能体。
 *
 * 用途：直接承接用户对话，并可创建长期智能体和会话级 team；短期子智能体委派使用 Deep Agents 原生 task 工具。
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
     * getCreationTools：主智能体可创建长期智能体，并管理会话级 team。
     *
     * @returns 创建和 team 管理工具列表。
     */
    getCreationTools(): AgentToolName[] {
        return [
            "create-long-term-agent",
            "create-agent-team",
            "disband-agent-team",
            "add-agent-team-member",
            "remove-agent-team-member",
        ];
    }

}
