import type {StructuredToolInterface} from "@langchain/core/tools";

import {
    AddAgentTeamMemberStructuredTool,
} from "./AddAgentTeamMemberStructuredTool.js";
import {
    CreateAgentTeamStructuredTool,
} from "./CreateAgentTeamStructuredTool.js";
import {
    CreateLongTermAgentStructuredTool,
} from "./CreateLongTermAgentStructuredTool.js";
import {
    CreateSubAgentStructuredTool,
} from "./CreateSubAgentStructuredTool.js";
import {CommandStructuredTool} from "./command-structured-tool.js";
import type {
    DeepAgentsStructuredToolFactory,
    DeepAgentsToolExecutionContext,
} from "./deepagents-tool-runtime.js";
import {
    DisbandAgentTeamStructuredTool,
} from "./DisbandAgentTeamStructuredTool.js";
import {
    listConfiguredMcpModelToolSpecs,
    readMcpDynamicToolName,
} from "./mcp-tool-specs.js";
import {DynamicMcpStructuredTool} from "./mcp-structured-tool.js";
import {
    RemoveAgentTeamMemberStructuredTool,
} from "./RemoveAgentTeamMemberStructuredTool.js";

/**
 * createDeepAgentsStructuredToolMiddleware：创建 Deep Agents 工具注入中间件。
 *
 * @param context 当前轮次工具执行上下文。
 * @returns 可构造结构化工具数组的中间件。
 */
export function createDeepAgentsStructuredToolMiddleware(
    context: DeepAgentsToolExecutionContext,
): DeepAgentsStructuredToolFactory {
    return {
        async buildTools(): Promise<StructuredToolInterface[]> {
            const tools: StructuredToolInterface[] = [];

            if (context.executionAgent.canUseToolCapability("builtin.command.run")) {
                tools.push(new CommandStructuredTool(context));
            }

            if (context.executionAgent.canUseToolCapability("builtin.mcp.call")) {
                const mcpSpecs = await listConfiguredMcpModelToolSpecs(context.centerDirectory);
                for (const toolSpec of mcpSpecs) {
                    const decoded = readMcpDynamicToolName(toolSpec.name);
                    if (!decoded) {
                        throw new Error(`MCP_DYNAMIC_TOOL_NAME_INVALID:${toolSpec.name}`);
                    }
                    tools.push(new DynamicMcpStructuredTool(
                        context,
                        toolSpec.name,
                        toolSpec.description,
                        decoded.serverId,
                        decoded.toolName,
                    ));
                }
            }

            if (context.executionAgent.canUseToolCapability("builtin.agent.createLongTerm")) {
                tools.push(new CreateLongTermAgentStructuredTool(context));
            }
            if (context.executionAgent.canUseToolCapability("builtin.agent.createSubAgent")) {
                tools.push(new CreateSubAgentStructuredTool(context));
            }
            if (context.executionAgent.canUseToolCapability("create-agent-team")) {
                tools.push(new CreateAgentTeamStructuredTool(context));
            }
            if (context.executionAgent.canUseToolCapability("disband-agent-team")) {
                tools.push(new DisbandAgentTeamStructuredTool(context));
            }
            if (context.executionAgent.canUseToolCapability("add-agent-team-member")) {
                tools.push(new AddAgentTeamMemberStructuredTool(context));
            }
            if (context.executionAgent.canUseToolCapability("remove-agent-team-member")) {
                tools.push(new RemoveAgentTeamMemberStructuredTool(context));
            }

            return tools;
        },
    };
}
