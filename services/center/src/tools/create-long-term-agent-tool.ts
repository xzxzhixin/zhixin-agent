import type {CenterDatabase} from "../database.js";
import type {CenterEventStore} from "../events.js";
import {createAgent} from "../domain/agent-domain.js";

/**
 * CreateLongTermAgentToolInput：创建长期智能体工具输入。
 */
export interface CreateLongTermAgentToolInput {
    /** name: 长期智能体名称，来源于主智能体规划或用户确认。 */
    name: string;
    /** roleDescription: 长期智能体角色说明。 */
    roleDescription: string;
    /** capabilityBoundary: 能力边界；为空时使用中心服务默认动态能力边界。 */
    capabilityBoundary?: string;
    /** defaultProviderId: 默认供应商 ID；未指定时继承会话默认策略。 */
    defaultProviderId?: string | null;
    /** defaultModel: 默认模型名；未指定时继承供应商默认模型。 */
    defaultModel?: string | null;
    /** reasoningEffort: 默认推理深度；未指定时继承会话配置。 */
    reasoningEffort?: string | null;
}

/**
 * executeCreateLongTermAgentTool：创建可固化的长期智能体。
 *
 * @param database 中心服务数据库事实源。
 * @param events 中心服务事件事实源。
 * @param centerDirectory 中心目录绝对路径。
 * @param input 工具输入。
 * @returns 创建出的长期智能体身份。
 */
export function executeCreateLongTermAgentTool(
    database: CenterDatabase,
    events: CenterEventStore,
    centerDirectory: string,
    input: CreateLongTermAgentToolInput,
): {
    /** agentId: 新长期智能体 ID。 */
    agentId: string;
    /** name: 新长期智能体名称。 */
    name: string;
} {
    return createAgent(
        database,
        events,
        centerDirectory,
        {
            ...input,
            createdBy: "main-agent-tool",
        },
    );
}
