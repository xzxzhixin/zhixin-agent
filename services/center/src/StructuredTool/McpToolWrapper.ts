import type {
    StructuredToolInterface,
    ToolInputSchemaBase,
    ToolInputSchemaOutputType,
} from "@langchain/core/tools";

import {SessionRepository} from "../data-access/session-repository.js";
import {CenterStructuredToolBase} from "./CenterStructuredToolBase.js";
import type {
    DeepAgentsToolExecutionContext,
    DeepAgentsToolExecutionResult,
} from "./deepagents-tool-runtime.js";
import {
    type McpToolNormalizedResult,
    normalizeMcpToolResult,
} from "./McpToolResultNormalizer.js";

/** MCP_TOOL_INTERNAL_TOOL_ID：官方 MCP adapter 工具统一继承的中心服务权限 ID。 */
export const MCP_TOOL_INTERNAL_TOOL_ID = "builtin.mcp.call";

/** McpToolWrapper：中心服务对官方 MCP adapter tool 的审计包装。 */
export class McpToolWrapper extends CenterStructuredToolBase<ToolInputSchemaBase> {
    /** description: 复用并补充官方 adapter tool 描述。 */
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
            MCP_TOOL_INTERNAL_TOOL_ID,
            adapterTool.name,
        );
        this.adapterTool = adapterTool;
        this.description = normalizeMcpToolDescription(adapterTool);
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
            const normalizedResult = normalizeMcpToolResult(output);
            this.appendMcpCompletedEvent(
                normalizedResult,
                toolCallId,
            );
            return {
                outputText: normalizedResult.modelText,
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
            // projectPath：只使用当前项目会话登记路径补参，不读取用户提示词。
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
                toolId: MCP_TOOL_INTERNAL_TOOL_ID,
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
     * @param normalizedResult 规范化后的 MCP 工具结果。
     * @param toolCallId 当前工具调用 ID。
     * @returns 没有返回值。
     */
    private appendMcpCompletedEvent(
        normalizedResult: McpToolNormalizedResult,
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
            summary: normalizedResult.uiSummary,
            payload: {
                toolId: MCP_TOOL_INTERNAL_TOOL_ID,
                toolKind: "mcp",
                toolCallId,
                toolName: this.name,
                outputSummary: normalizedResult.modelText.slice(
                    0,
                    2000,
                ),
                auditArtifact: normalizedResult.auditArtifact,
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
                toolId: MCP_TOOL_INTERNAL_TOOL_ID,
                toolKind: "mcp",
                toolCallId,
                toolName: this.name,
                failureReason,
            },
        });
    }
}

/**
 * normalizeMcpToolDescription：补充官方 adapter 工具描述中缺失的宿主语义。
 *
 * @param adapterTool 官方 adapter 返回的 LangChain tool。
 * @returns 给模型选择工具时使用的描述。
 */
function normalizeMcpToolDescription(adapterTool: StructuredToolInterface): string {
    if (adapterTool.name === "mcp__idea__get_all_open_file_paths") {
        return [
            adapterTool.description,
            "在 IDEA MCP 多项目场景中，本工具也会返回当前 IDE 打开的 projects 路径；用户询问 IDEA 当前打开了哪些项目、项目路径或打开文件上下文时，优先考虑本工具。",
        ].join("\n");
    }
    return adapterTool.description;
}
