import type {OpenAiToolSpec} from "../openai-chat-protocol.js";
import type {BaseAgent} from "../agents/index.js";
import {
    listUnifiedToolCapabilities,
    toModelSafeToolName,
} from "./tool-capability-registry.js";

/**
 * listAvailableModelToolSpecs：把中心服务工具能力转换为模型工具定义。
 *
 * @param agent 当前执行智能体；未传入时返回完整可用工具列表。
 * @returns 模型可见工具定义列表。
 */
export function listAvailableModelToolSpecs(agent?: BaseAgent): OpenAiToolSpec[] {
    return listUnifiedToolCapabilities()
        .filter((capability) => {
            return capability.availability === "available";
        })
        .filter((capability) => {
            // MCP 工具由官方 adapter 生成具体 tool name，builtin.mcp.call 只作为权限边界，不作为模型可调用静态工具。
            return capability.toolKind !== "mcp";
        })
        .filter((capability) => {
            return agent
                ? agent.canUseToolCapability(capability.toolId)
                : true;
        })
        .map((capability) => ({
            name: toModelSafeToolName(capability.toolId),
            sourceToolId: capability.toolId,
            description: capability.description,
            parametersJsonSchema: capability.inputSchema,
        }));
}

/**
 * listAvailableModelToolSpecsForCenter：读取中心服务静态模型工具定义。
 *
 * @param centerDirectory 中心目录绝对路径；MCP 官方 adapter 工具由 Deep Agents 注入层动态读取。
 * @param agent 当前执行智能体。
 * @returns 模型可见工具定义列表。
 */
export async function listAvailableModelToolSpecsForCenter(
    centerDirectory: string | null | undefined,
    agent?: BaseAgent,
): Promise<OpenAiToolSpec[]> {
    const staticTools = listAvailableModelToolSpecs(agent);
    void centerDirectory;
    return [
        ...staticTools,
    ];
}
