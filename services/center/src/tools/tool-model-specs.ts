import type {OpenAiToolSpec} from "../openai-chat-protocol.js";
import type {BaseAgent} from "../agents/index.js";
import {listConfiguredMcpModelToolSpecs} from "./mcp-tool-specs.js";
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
 * listAvailableModelToolSpecsForCenter：读取静态工具和中心目录中的 MCP 动态工具。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @param agent 当前执行智能体。
 * @returns 模型可见工具定义列表。
 */
export async function listAvailableModelToolSpecsForCenter(
    centerDirectory: string | null | undefined,
    agent?: BaseAgent,
): Promise<OpenAiToolSpec[]> {
    const staticTools = listAvailableModelToolSpecs(agent);
    const dynamicMcpTools = centerDirectory && (!agent || agent.canUseToolCapability("builtin.mcp.call"))
        ? await listConfiguredMcpModelToolSpecs(centerDirectory)
        : [];
    return [
        ...staticTools,
        ...dynamicMcpTools,
    ];
}
