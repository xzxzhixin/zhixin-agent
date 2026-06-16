import {z} from "zod/v3";

import {CenterStructuredToolBase} from "./CenterStructuredToolBase.js";
import {
    type CommandToolExecutionRequest,
    executeCommandTool,
} from "./command-tool-executor.js";
import type {
    DeepAgentsToolExecutionContext,
    DeepAgentsToolExecutionResult,
} from "./deepagents-tool-runtime.js";
import {toModelSafeToolName} from "./tool-capability-registry.js";

/**
 * COMMAND_TOOL_SCHEMA：命令工具参数 schema。
 */
export const COMMAND_TOOL_SCHEMA = z.object({
    shellCommand: z.string().optional(),
    executablePath: z.string().optional(),
    args: z.array(z.string()).optional(),
    inputSummary: z.string(),
});

/**
 * CommandStructuredTool：命令结构化工具。
 */
export class CommandStructuredTool extends CenterStructuredToolBase<typeof COMMAND_TOOL_SCHEMA> {
    /** description: 工具说明。 */
    override description = "仅在用户明确要求执行 shell、运行脚本、查看 Node/pnpm/npm/git 等本机环境版本或发起系统命令时使用；IDE 打开项目、打开文件、运行配置和代码搜索等宿主状态应优先使用对应 MCP 工具。";
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
        const request: CommandToolExecutionRequest = {
            toolCallId,
            shellCommand: arg.shellCommand,
            executablePath: arg.executablePath ?? "",
            args: arg.args ?? [],
            inputSummary: arg.inputSummary,
        };
        const result = await executeCommandTool(
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
