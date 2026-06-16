import type {StructuredToolInterface} from "@langchain/core/tools";

import type {DeepAgentsToolExecutionContext} from "./deepagents-tool-runtime.js";
import {createMcpAdapterClient} from "./mcp-adapter-config.js";
import {McpToolWrapper} from "./McpToolWrapper.js";

/**
 * buildMcpToolsForDeepAgents：按当前轮次上下文发现并包装 MCP tools。
 *
 * @param context 当前轮次工具执行上下文。
 * @returns 可注入 Deep Agents 的 MCP 工具列表。
 */
export async function buildMcpToolsForDeepAgents(
    context: DeepAgentsToolExecutionContext,
): Promise<StructuredToolInterface[]> {
    const mcpClient = createMcpAdapterClient(
        context.centerDirectory,
        context.projectId,
    );
    context.cleanupCallbacks.push(async () => {
        await mcpClient.close();
    });
    const adapterTools = await mcpClient.getTools();
    return adapterTools.map((adapterTool) => {
        return new McpToolWrapper(
            context,
            adapterTool,
        );
    });
}
