import type {
    StructuredToolInterface,
    ToolInputSchemaBase,
    ToolInputSchemaOutputType,
} from "@langchain/core/tools";

import {CenterStructuredToolBase} from "./CenterStructuredToolBase.js";
import {SessionRepository} from "../data-access/session-repository.js";
import type {
    DeepAgentsToolExecutionContext,
    DeepAgentsToolExecutionResult,
} from "./deepagents-tool-runtime.js";

/** MCP_ADAPTER_INTERNAL_TOOL_ID：官方 MCP adapter 工具统一继承的中心服务权限 ID。 */
export const MCP_ADAPTER_INTERNAL_TOOL_ID = "builtin.mcp.call";

/**
 * McpAdapterStructuredTool：中心服务对官方 MCP adapter tool 的审计包装。
 *
 * 关键约束：MCP 协议发现和 tools/call 由官方 @langchain/mcp-adapters 执行，
 * 本类只负责中心服务事件、结果摘要和失败收尾，不重写 MCP 协议。
 */
export class McpAdapterStructuredTool extends CenterStructuredToolBase<ToolInputSchemaBase> {
    /** description: 复用官方 adapter tool 描述。 */
    override description: string;
    /** schema: 复用官方 adapter tool schema。 */
    override schema: ToolInputSchemaBase;
    /** adapterTool: 官方 adapter 返回的 LangChain tool。 */
    private readonly adapterTool: StructuredToolInterface;

    /**
     * constructor：创建 MCP adapter 工具包装。
     *
     * @param context 当前轮次工具执行上下文。
     * @param adapterTool 官方 adapter 返回的 LangChain tool。
     */
    constructor(
        context: DeepAgentsToolExecutionContext,
        adapterTool: StructuredToolInterface,
    ) {
        super(
            context,
            MCP_ADAPTER_INTERNAL_TOOL_ID,
            adapterTool.name,
        );
        this.adapterTool = adapterTool;
        this.description = normalizeMcpAdapterDescription(adapterTool);
        this.schema = adapterTool.schema;
    }

    /**
     * executeTool：调用官方 adapter tool 并归一化返回文本。
     *
     * @param arg 模型传入的 MCP 工具参数。
     * @param toolCallId 当前工具调用 ID。
     * @returns 工具执行结果。
     */
    protected override async executeTool(
        arg: ToolInputSchemaOutputType<ToolInputSchemaBase>,
        toolCallId: string,
    ): Promise<DeepAgentsToolExecutionResult> {
        const normalizedArg = this.normalizeMcpToolArguments(arg);
        this.appendMcpStartedEvent(
            normalizedArg as Record<string, unknown>,
            toolCallId,
        );
        try {
            const output = await this.adapterTool.invoke(normalizedArg);
            const outputText = normalizeMcpAdapterOutput(output);
            this.appendMcpCompletedEvent(
                outputText,
                toolCallId,
            );
            return {
                outputText,
                status: "completed",
            };
        } catch (error) {
            const failureReason = error instanceof Error
                ? error.message
                : "MCP_ADAPTER_TOOL_CALL_FAILED";
            this.appendMcpFailedEvent(
                failureReason,
                toolCallId,
            );
            return {
                outputText: failureReason,
                status: "failed",
            };
        }
    }

    /**
     * normalizeMcpToolArguments：补全 MCP 工具执行所需的宿主上下文参数。
     *
     * @param arg 模型传入的 MCP 工具参数。
     * @returns 可直接交给官方 adapter tool 的参数。
     */
    private normalizeMcpToolArguments(
        arg: ToolInputSchemaOutputType<ToolInputSchemaBase>,
    ): ToolInputSchemaOutputType<ToolInputSchemaBase> {
        if (this.name !== "mcp__idea__get_all_open_file_paths") {
            return arg;
        }
        if (!arg || typeof arg !== "object" || Array.isArray(arg)) {
            return arg;
        }
        const argumentRecord = arg as Record<string, unknown>;
        const projectPath = argumentRecord.projectPath;
        if (typeof projectPath === "string" && projectPath.trim() && projectPath.trim() !== "/") {
            return arg;
        }
        const currentProjectPath = this.resolveCurrentProjectPath();
        if (!currentProjectPath) {
            return arg;
        }
        return {
            ...argumentRecord,
            // projectPath：模型选对 IDEA MCP 工具但传空路径时，使用当前项目会话登记路径，避免 IDEA MCP 以空根路径返回异常结构。
            projectPath: currentProjectPath,
        } as ToolInputSchemaOutputType<ToolInputSchemaBase>;
    }

    /**
     * resolveCurrentProjectPath：读取当前项目会话登记的最近项目根目录。
     *
     * @returns 当前项目路径；普通会话或项目未登记时返回空字符串。
     */
    private resolveCurrentProjectPath(): string {
        if (!this.context.projectId) {
            return "";
        }
        const project = new SessionRepository(this.context.input.database).findProject(this.context.projectId) as {
            /** latestPath: 项目登记时保存的最近项目根目录。 */
            latestPath?: unknown;
        } | null;
        return typeof project?.latestPath === "string"
            ? project.latestPath
            : "";
    }

    /**
     * appendMcpStartedEvent：写入 MCP 调用开始事件。
     *
     * @param arg 工具参数。
     * @param toolCallId 当前工具调用 ID。
     * @returns 没有返回值。
     */
    private appendMcpStartedEvent(
        arg: Record<string, unknown>,
        toolCallId: string,
    ): void {
        this.context.input.events.append({
            eventType: "tool.mcp.started",
            scopeType: "tool",
            scopeId: this.context.input.sent.taskId,
            sessionId: this.context.input.sent.sessionId,
            turnId: this.context.input.sent.turnId,
            taskId: this.context.input.sent.taskId,
            status: "running",
            title: "MCP 调用开始",
            summary: `调用 MCP 工具 ${this.name}`,
            payload: {
                toolId: MCP_ADAPTER_INTERNAL_TOOL_ID,
                toolKind: "mcp",
                toolCallId,
                toolName: this.name,
                argumentsJson: arg,
            },
        });
    }

    /**
     * appendMcpCompletedEvent：写入 MCP 调用完成事件。
     *
     * @param outputText 输出摘要。
     * @param toolCallId 当前工具调用 ID。
     * @returns 没有返回值。
     */
    private appendMcpCompletedEvent(
        outputText: string,
        toolCallId: string,
    ): void {
        this.context.input.events.append({
            eventType: "tool.mcp.completed",
            scopeType: "tool",
            scopeId: this.context.input.sent.taskId,
            sessionId: this.context.input.sent.sessionId,
            turnId: this.context.input.sent.turnId,
            taskId: this.context.input.sent.taskId,
            status: "completed",
            title: "MCP 调用完成",
            summary: outputText.slice(
                0,
                240,
            ),
            payload: {
                toolId: MCP_ADAPTER_INTERNAL_TOOL_ID,
                toolKind: "mcp",
                toolCallId,
                toolName: this.name,
                outputSummary: outputText.slice(
                    0,
                    2000,
                ),
            },
        });
    }

    /**
     * appendMcpFailedEvent：写入 MCP 调用失败事件。
     *
     * @param failureReason 失败原因。
     * @param toolCallId 当前工具调用 ID。
     * @returns 没有返回值。
     */
    private appendMcpFailedEvent(
        failureReason: string,
        toolCallId: string,
    ): void {
        this.context.input.events.append({
            eventType: "tool.mcp.failed",
            scopeType: "tool",
            scopeId: this.context.input.sent.taskId,
            sessionId: this.context.input.sent.sessionId,
            turnId: this.context.input.sent.turnId,
            taskId: this.context.input.sent.taskId,
            status: "failed",
            title: "MCP 调用失败",
            summary: failureReason,
            payload: {
                toolId: MCP_ADAPTER_INTERNAL_TOOL_ID,
                toolKind: "mcp",
                toolCallId,
                toolName: this.name,
                failureReason,
            },
        });
    }
}

/**
 * wrapMcpAdapterToolsForCenter：把官方 adapter tools 包装成中心服务可审计工具。
 *
 * @param context 当前轮次工具执行上下文。
 * @param adapterTools 官方 adapter 返回的工具列表。
 * @returns 中心服务包装后的 MCP 工具列表。
 */
export function wrapMcpAdapterToolsForCenter(
    context: DeepAgentsToolExecutionContext,
    adapterTools: StructuredToolInterface[],
): StructuredToolInterface[] {
    return adapterTools.map((tool) => {
        return new McpAdapterStructuredTool(
            context,
            tool,
        );
    });
}

/**
 * normalizeMcpAdapterOutput：把官方 adapter 工具输出归一化为可回填模型的文本。
 *
 * @param output 官方 adapter tool 返回值。
 * @returns 文本摘要。
 */
function normalizeMcpAdapterOutput(output: unknown): string {
    if (typeof output === "string") {
        return output;
    }
    if (isContentAndArtifactOutput(output)) {
        return normalizeMcpAdapterOutput(output[0]);
    }
    if (isMcpTextContentBlock(output)) {
        return output.text;
    }
    if (Array.isArray(output)) {
        return output.map((item) => normalizeMcpAdapterOutput(item)).join("\n");
    }
    if (output && typeof output === "object") {
        return JSON.stringify(
            output,
            null,
            2,
        );
    }
    return String(output ?? "");
}

/**
 * isContentAndArtifactOutput：识别 LangChain content_and_artifact 二元返回值。
 *
 * @param output 官方 adapter tool 返回值。
 * @returns 是 `[content, artifact]` 结构时返回 true。
 */
function isContentAndArtifactOutput(output: unknown): output is [unknown, unknown] {
    return Array.isArray(output)
        && output.length === 2
        && Array.isArray(output[0])
        && Array.isArray(output[1]);
}

/**
 * isMcpTextContentBlock：识别 MCP 文本 content block。
 *
 * @param output 单个输出片段。
 * @returns 是文本片段时返回 true。
 */
function isMcpTextContentBlock(output: unknown): output is {
    /** text: MCP 文本片段正文。 */
    text: string;
} {
    return Boolean(output)
        && typeof output === "object"
        && "type" in output
        && (output as {type?: unknown}).type === "text"
        && typeof (output as {text?: unknown}).text === "string";
}

/**
 * normalizeMcpAdapterDescription：补充官方 adapter 工具描述中缺失的宿主语义。
 *
 * @param adapterTool 官方 adapter 返回的 LangChain tool。
 * @returns 给模型选择工具时使用的描述。
 */
function normalizeMcpAdapterDescription(adapterTool: StructuredToolInterface): string {
    if (adapterTool.name === "mcp__idea__get_all_open_file_paths") {
        return [
            adapterTool.description,
            "在 IDEA MCP 多项目场景中，本工具也会返回当前 IDE 打开的 projects 路径；用户询问 IDEA 当前打开了哪些项目、项目路径或打开文件上下文时，优先考虑本工具。",
        ].join("\n");
    }
    return adapterTool.description;
}
