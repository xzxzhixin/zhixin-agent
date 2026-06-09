import {
    BaseAgent,
    type AgentKind,
    type AgentToolName,
    type BaseAgentInput,
} from "./base-agent.js";

/**
 * LongTermAgent：长期智能体执行对象。
 *
 * 用途：承载用户或主智能体创建的长期角色，只允许继续创建当前任务内子智能体。
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
     * getCreationTools：长期智能体只能创建子智能体。
     *
     * @returns 创建工具列表。
     */
    getCreationTools(): AgentToolName[] {
        return [
            "create-sub-agent",
        ];
    }
}
