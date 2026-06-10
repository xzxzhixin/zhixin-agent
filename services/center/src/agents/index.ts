import type {TaskRecord} from "@zhixin/shared";

import type {
    BaseAgentInput,
    AgentKind,
} from "./base-agent.js";
import {BaseAgent} from "./base-agent.js";
import {LongTermAgent} from "./long-term-agent.js";
import {MainAgent} from "./main-agent.js";
import {SubAgent} from "./sub-agent.js";

/**
 * AgentExecutionIdentity：执行链路传给 agents 目录的智能体身份。
 */
export interface AgentExecutionIdentity extends BaseAgentInput {
    /** kind: 智能体类型，来源于任务、运行期子智能体或长期智能体索引。 */
    kind: AgentKind;
}

export {
    BaseAgent,
    LongTermAgent,
    MainAgent,
    SubAgent,
};
export type {
    AgentKind,
    AgentToolName,
    BaseAgentInput,
    TodoListCreationInput,
} from "./base-agent.js";

/**
 * createAgentForExecution：按执行身份创建智能体类实例。
 *
 * @param identity 智能体执行身份。
 * @returns 对应的智能体派生类实例。
 */
export function createAgentForExecution(identity: AgentExecutionIdentity): BaseAgent {
    switch (identity.kind) {
        case "main":
            return new MainAgent({
                agentId: identity.agentId,
                name: identity.name,
            });
        case "long-term":
            return new LongTermAgent({
                agentId: identity.agentId,
                name: identity.name,
            });
        case "sub":
            return new SubAgent({
                agentId: identity.agentId,
                name: identity.name,
            });
        default:
            return new MainAgent();
    }
}

/**
 * createAgentForTask：从任务记录解析当前执行智能体。
 *
 * @param task 当前任务记录。
 * @returns 智能体执行实例。
 */
export function createAgentForTask(task: Pick<TaskRecord, "agentId"> | null): BaseAgent {
    const agentId = task?.agentId ?? "main";
    if (agentId === "main") {
        return new MainAgent();
    }
    if (agentId.startsWith("sub-")) {
        return new SubAgent({
            agentId,
            name: "子智能体",
        });
    }

    return new LongTermAgent({
        agentId,
        name: "长期智能体",
    });
}

/**
 * filterToolIdsForAgent：按智能体类型过滤模型可见工具。
 *
 * @param agent 当前执行智能体。
 * @param toolIds 工具 ID 列表。
 * @returns 当前智能体允许看到的工具 ID 列表。
 */
export function filterToolIdsForAgent(
    agent: BaseAgent,
    toolIds: string[],
): string[] {
    return toolIds.filter((toolId) => {
        return agent.canUseToolCapability(toolId);
    });
}
