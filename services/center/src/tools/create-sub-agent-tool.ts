import type {CenterEventStore} from "../events.js";
import type {SubAgentRuntimeRecord} from "../types.js";
import {createSubAgentRuntime} from "../domain/workflow-domain.js";

/**
 * CreateSubAgentToolInput：创建一次性子智能体工具输入。
 */
export interface CreateSubAgentToolInput {
    /** parentAgentId: 创建者智能体 ID，来源于当前执行上下文。 */
    parentAgentId: string;
    /** parentAgentKind: 创建者类型；子智能体不能继续创建任何智能体。 */
    parentAgentKind: "main" | "long-term" | "sub";
    /** taskId: 当前任务 ID，子智能体只绑定当前任务上下文。 */
    taskId: string;
    /** name: 子智能体展示名称。 */
    name: string;
}

/**
 * executeCreateSubAgentTool：创建当前任务内的一次性子智能体。
 *
 * @param events 中心服务事件事实源。
 * @param subAgents 运行期子智能体表。
 * @param input 工具输入。
 * @returns 子智能体运行期身份。
 */
export function executeCreateSubAgentTool(
    events: CenterEventStore,
    subAgents: Map<string, SubAgentRuntimeRecord>,
    input: CreateSubAgentToolInput,
): {
    /** subAgentId: 子智能体运行期 ID。 */
    subAgentId: string;
    /** parentAgentId: 创建它的智能体 ID。 */
    parentAgentId: string;
    /** taskId: 所属任务 ID。 */
    taskId: string;
    /** persistent: 子智能体不固化为长期定义。 */
    persistent: false;
    /** createdAt: 创建时间。 */
    createdAt: string;
} {
    if (input.parentAgentKind === "sub") {
        throw new Error("SUB_AGENT_CREATE_AGENT_FORBIDDEN");
    }
    return createSubAgentRuntime(
        events,
        subAgents,
        input.parentAgentId,
        input.taskId,
        input.name,
    );
}
