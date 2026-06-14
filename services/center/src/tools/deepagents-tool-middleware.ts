import type {StructuredToolInterface} from "@langchain/core/tools";
import {z} from "zod/v3";

import {executeAddAgentTeamMemberTool} from "./add-agent-team-member-tool.js";
import {runCommandTool, type CommandToolRequest} from "./command-tool.js";
import {executeCreateAgentTeamTool} from "./create-agent-team-tool.js";
import {executeCreateLongTermAgentTool} from "./create-long-term-agent-tool.js";
import {executeCreateSubAgentTool} from "./create-sub-agent-tool.js";
import {
    CenterStructuredToolBase,
    type DeepAgentsStructuredToolFactory,
    type DeepAgentsToolExecutionContext,
    type DeepAgentsToolExecutionResult,
} from "./deepagents-tool-runtime.js";
import {executeDisbandAgentTeamTool} from "./disband-agent-team-tool.js";
import {
    listConfiguredMcpModelToolSpecs,
    readMcpDynamicToolName,
    runMcpTool,
    type McpToolRequest,
} from "./mcp-tool.js";
import {executeRemoveAgentTeamMemberTool} from "./remove-agent-team-member-tool.js";
import {toModelSafeToolName} from "./tool-capability-registry.js";

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

/**
 * CommandStructuredTool：命令结构化工具。
 */
class CommandStructuredTool extends CenterStructuredToolBase<typeof COMMAND_TOOL_SCHEMA> {
    /** description: 工具说明。 */
    override description = "在中心服务受控环境中执行明确的本机命令。";
    /** schema: 命令工具参数。 */
    override schema = COMMAND_TOOL_SCHEMA;

    /**
     * constructor：创建命令结构化工具。
     *
     * @param context 当前轮次工具执行上下文。
     */
    constructor(context: DeepAgentsToolExecutionContext) {
        super(
            context,
            "builtin.command.run",
            toModelSafeToolName("builtin.command.run"),
        );
    }

    /**
     * executeTool：执行命令工具。
     *
     * @param arg 工具参数。
     * @param toolCallId 当前工具调用 ID。
     * @returns 工具结果。
     */
    protected override async executeTool(
        arg: z.output<typeof COMMAND_TOOL_SCHEMA>,
        toolCallId: string,
    ): Promise<DeepAgentsToolExecutionResult> {
        const request: CommandToolRequest = {
            toolCallId,
            shellCommand: arg.shellCommand,
            executablePath: arg.executablePath ?? "",
            args: arg.args ?? [],
            inputSummary: arg.inputSummary,
        };
        const result = await runCommandTool(
            this.context.input.events,
            this.context.input.sent.sessionId,
            this.context.input.sent.taskId,
            this.context.input.sent.turnId,
            request,
        );
        return {
            outputText: result.status === "completed"
                ? result.outputSummary || "工具没有输出。"
                : result.failureReason ?? "工具执行失败。",
            status: result.status,
        };
    }
}

/**
 * DynamicMcpStructuredTool：动态 MCP 结构化工具。
 */
class DynamicMcpStructuredTool extends CenterStructuredToolBase<typeof MCP_TOOL_SCHEMA> {
    /** description: 工具说明。 */
    override description: string;
    /** schema: MCP 参数对象。 */
    override schema = MCP_TOOL_SCHEMA;
    /** serverId: MCP Server ID。 */
    private readonly serverId: string;
    /** innerToolName: MCP 内部工具名。 */
    private readonly innerToolName: string;

    /**
     * constructor：创建动态 MCP 结构化工具。
     *
     * @param context 当前轮次工具执行上下文。
     * @param modelToolName 模型可见工具名。
     * @param description 工具说明。
     * @param serverId MCP Server ID。
     * @param innerToolName MCP 内部工具名。
     */
    constructor(
        context: DeepAgentsToolExecutionContext,
        modelToolName: string,
        description: string,
        serverId: string,
        innerToolName: string,
    ) {
        super(
            context,
            "builtin.mcp.call",
            modelToolName,
        );
        this.description = description;
        this.serverId = serverId;
        this.innerToolName = innerToolName;
    }

    /**
     * executeTool：执行动态 MCP 工具。
     *
     * @param arg 工具参数。
     * @param toolCallId 当前工具调用 ID。
     * @returns 工具结果。
     */
    protected override async executeTool(
        arg: z.output<typeof MCP_TOOL_SCHEMA>,
        toolCallId: string,
    ): Promise<DeepAgentsToolExecutionResult> {
        const request: McpToolRequest = {
            toolCallId,
            serverId: this.serverId,
            toolName: this.innerToolName,
            arguments: arg,
            inputSummary: `调用 MCP ${this.serverId}.${this.innerToolName}`,
        };
        const result = await runMcpTool(
            this.context.input.events,
            this.context.centerDirectory,
            this.context.input.sent.sessionId,
            this.context.input.sent.taskId,
            this.context.input.sent.turnId,
            request,
        );
        return {
            outputText: result.status === "completed"
                ? result.outputSummary || "工具没有输出。"
                : result.failureReason ?? "工具执行失败。",
            status: result.status,
        };
    }
}

/**
 * CreateLongTermAgentStructuredTool：创建长期智能体结构化工具。
 */
class CreateLongTermAgentStructuredTool extends CenterStructuredToolBase<typeof CREATE_LONG_TERM_AGENT_SCHEMA> {
    /** description: 工具说明。 */
    override description = "创建长期智能体。";
    /** schema: 创建长期智能体参数。 */
    override schema = CREATE_LONG_TERM_AGENT_SCHEMA;

    /**
     * constructor：创建长期智能体结构化工具。
     *
     * @param context 当前轮次工具执行上下文。
     */
    constructor(context: DeepAgentsToolExecutionContext) {
        super(
            context,
            "builtin.agent.createLongTerm",
            toModelSafeToolName("builtin.agent.createLongTerm"),
        );
    }

    /**
     * executeTool：执行创建长期智能体。
     *
     * @param arg 工具参数。
     * @returns 工具结果。
     */
    protected override async executeTool(
        arg: z.output<typeof CREATE_LONG_TERM_AGENT_SCHEMA>,
    ): Promise<DeepAgentsToolExecutionResult> {
        const result = executeCreateLongTermAgentTool(
            this.context.input.database,
            this.context.input.events,
            this.context.centerDirectory,
            {
                name: arg.name,
                roleDescription: arg.roleDescription,
                capabilityBoundary: arg.capabilityBoundary,
            },
        );
        return {
            outputText: JSON.stringify(result),
            status: "completed",
        };
    }
}

/**
 * CreateSubAgentStructuredTool：创建子智能体结构化工具。
 */
class CreateSubAgentStructuredTool extends CenterStructuredToolBase<typeof CREATE_SUB_AGENT_SCHEMA> {
    /** description: 工具说明。 */
    override description = "创建子智能体。";
    /** schema: 创建子智能体参数。 */
    override schema = CREATE_SUB_AGENT_SCHEMA;

    /**
     * constructor：创建子智能体结构化工具。
     *
     * @param context 当前轮次工具执行上下文。
     */
    constructor(context: DeepAgentsToolExecutionContext) {
        super(
            context,
            "builtin.agent.createSubAgent",
            toModelSafeToolName("builtin.agent.createSubAgent"),
        );
    }

    /**
     * executeTool：执行创建子智能体。
     *
     * @param arg 工具参数。
     * @returns 工具结果。
     */
    protected override async executeTool(
        arg: z.output<typeof CREATE_SUB_AGENT_SCHEMA>,
    ): Promise<DeepAgentsToolExecutionResult> {
        const result = executeCreateSubAgentTool(
            this.context.input.events,
            this.context.subAgents,
            {
                parentAgentId: arg.parentAgentId ?? "main",
                parentAgentKind: arg.parentAgentKind ?? "main",
                taskId: this.context.input.sent.taskId,
                parentProviderId: this.context.runtime.provider.providerId,
                parentModelId: this.context.runtime.modelSelection.model,
                parentReasoningEffort: this.context.runtime.modelSelection.reasoningEffort,
                name: arg.name,
            },
        );
        return {
            outputText: JSON.stringify(result),
            status: "completed",
        };
    }
}

/**
 * CreateAgentTeamStructuredTool：创建 team 结构化工具。
 */
class CreateAgentTeamStructuredTool extends CenterStructuredToolBase<typeof CREATE_AGENT_TEAM_SCHEMA> {
    /** description: 工具说明。 */
    override description = "创建会话 team。";
    /** schema: 创建 team 参数。 */
    override schema = CREATE_AGENT_TEAM_SCHEMA;

    /**
     * constructor：创建 team 结构化工具。
     *
     * @param context 当前轮次工具执行上下文。
     */
    constructor(context: DeepAgentsToolExecutionContext) {
        super(
            context,
            "create-agent-team",
            toModelSafeToolName("create-agent-team"),
        );
    }

    /**
     * executeTool：执行创建 team。
     *
     * @param arg 工具参数。
     * @returns 工具结果。
     */
    protected override async executeTool(
        arg: z.output<typeof CREATE_AGENT_TEAM_SCHEMA>,
    ): Promise<DeepAgentsToolExecutionResult> {
        const result = executeCreateAgentTeamTool(
            {
                database: this.context.input.database,
                events: this.context.input.events,
                sessionId: this.context.input.sent.sessionId,
                turnId: this.context.input.sent.turnId,
                taskId: this.context.input.sent.taskId,
                creatorAgentId: "main",
                toolCallId: null,
            },
            {
                name: arg.name,
                description: arg.description ?? null,
                memberAgentIds: arg.memberAgentIds,
            },
        );
        return {
            outputText: JSON.stringify(result),
            status: "completed",
        };
    }
}

/**
 * DisbandAgentTeamStructuredTool：解散 team 结构化工具。
 */
class DisbandAgentTeamStructuredTool extends CenterStructuredToolBase<typeof DISBAND_AGENT_TEAM_SCHEMA> {
    /** description: 工具说明。 */
    override description = "解散会话 team。";
    /** schema: 解散 team 参数。 */
    override schema = DISBAND_AGENT_TEAM_SCHEMA;

    /**
     * constructor：创建解散 team 结构化工具。
     *
     * @param context 当前轮次工具执行上下文。
     */
    constructor(context: DeepAgentsToolExecutionContext) {
        super(
            context,
            "disband-agent-team",
            toModelSafeToolName("disband-agent-team"),
        );
    }

    /**
     * executeTool：执行解散 team。
     *
     * @param arg 工具参数。
     * @returns 工具结果。
     */
    protected override async executeTool(
        arg: z.output<typeof DISBAND_AGENT_TEAM_SCHEMA>,
    ): Promise<DeepAgentsToolExecutionResult> {
        const result = executeDisbandAgentTeamTool(
            {
                database: this.context.input.database,
                events: this.context.input.events,
                sessionId: this.context.input.sent.sessionId,
                turnId: this.context.input.sent.turnId,
                taskId: this.context.input.sent.taskId,
                creatorAgentId: "main",
                toolCallId: null,
            },
            {
                teamId: arg.teamId,
            },
        );
        return {
            outputText: JSON.stringify(result),
            status: "completed",
        };
    }
}

/**
 * AddAgentTeamMemberStructuredTool：添加 team 成员结构化工具。
 */
class AddAgentTeamMemberStructuredTool extends CenterStructuredToolBase<typeof ADD_AGENT_TEAM_MEMBER_SCHEMA> {
    /** description: 工具说明。 */
    override description = "添加会话 team 成员。";
    /** schema: 添加 team 成员参数。 */
    override schema = ADD_AGENT_TEAM_MEMBER_SCHEMA;

    /**
     * constructor：创建添加 team 成员结构化工具。
     *
     * @param context 当前轮次工具执行上下文。
     */
    constructor(context: DeepAgentsToolExecutionContext) {
        super(
            context,
            "add-agent-team-member",
            toModelSafeToolName("add-agent-team-member"),
        );
    }

    /**
     * executeTool：执行添加 team 成员。
     *
     * @param arg 工具参数。
     * @returns 工具结果。
     */
    protected override async executeTool(
        arg: z.output<typeof ADD_AGENT_TEAM_MEMBER_SCHEMA>,
    ): Promise<DeepAgentsToolExecutionResult> {
        const result = executeAddAgentTeamMemberTool(
            {
                database: this.context.input.database,
                events: this.context.input.events,
                sessionId: this.context.input.sent.sessionId,
                turnId: this.context.input.sent.turnId,
                taskId: this.context.input.sent.taskId,
                creatorAgentId: "main",
                toolCallId: null,
            },
            {
                teamId: arg.teamId,
                agentId: arg.agentId,
                role: arg.role,
            },
        );
        return {
            outputText: JSON.stringify(result),
            status: "completed",
        };
    }
}

/**
 * RemoveAgentTeamMemberStructuredTool：移除 team 成员结构化工具。
 */
class RemoveAgentTeamMemberStructuredTool extends CenterStructuredToolBase<typeof REMOVE_AGENT_TEAM_MEMBER_SCHEMA> {
    /** description: 工具说明。 */
    override description = "移除会话 team 成员。";
    /** schema: 移除 team 成员参数。 */
    override schema = REMOVE_AGENT_TEAM_MEMBER_SCHEMA;

    /**
     * constructor：创建移除 team 成员结构化工具。
     *
     * @param context 当前轮次工具执行上下文。
     */
    constructor(context: DeepAgentsToolExecutionContext) {
        super(
            context,
            "remove-agent-team-member",
            toModelSafeToolName("remove-agent-team-member"),
        );
    }

    /**
     * executeTool：执行移除 team 成员。
     *
     * @param arg 工具参数。
     * @returns 工具结果。
     */
    protected override async executeTool(
        arg: z.output<typeof REMOVE_AGENT_TEAM_MEMBER_SCHEMA>,
    ): Promise<DeepAgentsToolExecutionResult> {
        const result = executeRemoveAgentTeamMemberTool(
            {
                database: this.context.input.database,
                events: this.context.input.events,
                sessionId: this.context.input.sent.sessionId,
                turnId: this.context.input.sent.turnId,
                taskId: this.context.input.sent.taskId,
                creatorAgentId: "main",
                toolCallId: null,
            },
            {
                teamId: arg.teamId,
                agentId: arg.agentId,
            },
        );
        return {
            outputText: JSON.stringify(result),
            status: "completed",
        };
    }
}

/**
 * COMMAND_TOOL_SCHEMA：命令工具参数 schema。
 */
const COMMAND_TOOL_SCHEMA = z.object({
    shellCommand: z.string().optional(),
    executablePath: z.string().optional(),
    args: z.array(z.string()).optional(),
    inputSummary: z.string(),
});

/**
 * MCP_TOOL_SCHEMA：动态 MCP 工具参数 schema。
 */
const MCP_TOOL_SCHEMA = z.record(z.unknown());

/**
 * CREATE_LONG_TERM_AGENT_SCHEMA：创建长期智能体参数 schema。
 */
const CREATE_LONG_TERM_AGENT_SCHEMA = z.object({
    name: z.string(),
    roleDescription: z.string(),
    capabilityBoundary: z.string().optional(),
});

/**
 * CREATE_SUB_AGENT_SCHEMA：创建子智能体参数 schema。
 */
const CREATE_SUB_AGENT_SCHEMA = z.object({
    name: z.string(),
    parentAgentId: z.string().optional(),
    parentAgentKind: z.enum([
        "main",
        "long-term",
        "sub",
    ]).optional(),
});

/**
 * CREATE_AGENT_TEAM_SCHEMA：创建 team 参数 schema。
 */
const CREATE_AGENT_TEAM_SCHEMA = z.object({
    name: z.string(),
    description: z.string().optional(),
    memberAgentIds: z.array(z.string()),
});

/**
 * DISBAND_AGENT_TEAM_SCHEMA：解散 team 参数 schema。
 */
const DISBAND_AGENT_TEAM_SCHEMA = z.object({
    teamId: z.string(),
});

/**
 * ADD_AGENT_TEAM_MEMBER_SCHEMA：添加 team 成员参数 schema。
 */
const ADD_AGENT_TEAM_MEMBER_SCHEMA = z.object({
    teamId: z.string(),
    agentId: z.string(),
    role: z.string().optional(),
});

/**
 * REMOVE_AGENT_TEAM_MEMBER_SCHEMA：移除 team 成员参数 schema。
 */
const REMOVE_AGENT_TEAM_MEMBER_SCHEMA = z.object({
    teamId: z.string(),
    agentId: z.string(),
});
