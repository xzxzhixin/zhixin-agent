import {
    BaseAgent,
    type AgentKind,
    type AgentToolName,
    type BaseAgentInput,
} from "./base-agent.js";

/**
 * LongTermAgent：长期智能体执行对象。
 *
 * 用途：承载用户或主智能体创建的长期角色；短期子智能体委派使用 Deep Agents 原生 task 工具。
 */
export class LongTermAgent extends BaseAgent {
    /**
     * constructor：创建长期智能体执行对象。
     *
     * @param input 长期智能体身份输入。
     */
    constructor(input: BaseAgentInput) {
        super(input);
    }

    /**
     * getAgentKind：返回长期智能体类型。
     *
     * @returns long-term。
     */
    getAgentKind(): AgentKind {
        return "long-term";
    }

    /**
     * getCreationTools：长期智能体不注入中心服务创建类工具。
     *
     * @returns 创建工具列表。
     */
    getCreationTools(): AgentToolName[] {
        return [];
    }
}
