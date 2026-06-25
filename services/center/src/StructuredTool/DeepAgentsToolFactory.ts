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
import {CommandStructuredTool} from "./CommandStructuredTool.js";
import type {
    DeepAgentsStructuredToolFactory,
    DeepAgentsToolExecutionContext,
} from "./deepagents-tool-runtime.js";
import {
    DisbandAgentTeamStructuredTool,
} from "./DisbandAgentTeamStructuredTool.js";
import {
    buildMcpToolsForDeepAgents,
} from "./McpToolProvider.js";
import {
    RemoveAgentTeamMemberStructuredTool,
} from "./RemoveAgentTeamMemberStructuredTool.js";

/** DeepAgentsToolFactory：按当前轮次上下文构造 Deep Agents 可用工具。 */
export class DeepAgentsToolFactory implements DeepAgentsStructuredToolFactory {
    /** context: 当前轮次工具执行上下文。 */
    private readonly context: DeepAgentsToolExecutionContext;

    /**
     * constructor：保存当前轮次工具执行上下文。
     *
     * @param context 当前轮次工具执行上下文。
     */
    constructor(context: DeepAgentsToolExecutionContext) {
        this.context = context;
    }

    /**
     * buildTools：构造当前轮次可注入 Deep Agents 的结构化工具列表。
     *
     * @returns 当前轮次可用工具列表。
     */
    async buildTools(): Promise<StructuredToolInterface[]> {
        const tools: StructuredToolInterface[] = [];

        if (this.context.executionAgent.canUseToolCapability("builtin.command.run")) {
            tools.push(new CommandStructuredTool(this.context));
        }

        if (this.context.executionAgent.canUseToolCapability("builtin.mcp.call")) {
            const mcpTools = await buildMcpToolsForDeepAgents(this.context);
            tools.push(...mcpTools);
        }

        if (this.context.executionAgent.canUseToolCapability("builtin.agent.createLongTerm")) {
            tools.push(new CreateLongTermAgentStructuredTool(this.context));
        }
        if (this.context.executionAgent.canUseToolCapability("create-agent-team")) {
            tools.push(new CreateAgentTeamStructuredTool(this.context));
        }
        if (this.context.executionAgent.canUseToolCapability("disband-agent-team")) {
            tools.push(new DisbandAgentTeamStructuredTool(this.context));
        }
        if (this.context.executionAgent.canUseToolCapability("add-agent-team-member")) {
            tools.push(new AddAgentTeamMemberStructuredTool(this.context));
        }
        if (this.context.executionAgent.canUseToolCapability("remove-agent-team-member")) {
            tools.push(new RemoveAgentTeamMemberStructuredTool(this.context));
        }

        return tools;
    }
}

/**
 * createDeepAgentsStructuredToolFactory：创建 Deep Agents 工具工厂。
 *
 * @param context 当前轮次工具执行上下文。
 * @returns 可构造结构化工具数组的工具工厂。
 */
export function createDeepAgentsStructuredToolFactory(
    context: DeepAgentsToolExecutionContext,
): DeepAgentsStructuredToolFactory {
    return new DeepAgentsToolFactory(context);
}
