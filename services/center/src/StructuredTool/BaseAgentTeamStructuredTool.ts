import type {
    ToolInputSchemaBase,
    ToolInputSchemaOutputType,
} from "@langchain/core/tools";

import type {AgentTeamToolScope} from "./agent-team-tool-shared.js";
import {CenterStructuredToolBase} from "./CenterStructuredToolBase.js";
import type {
    DeepAgentsToolExecutionContext,
    DeepAgentsToolExecutionResult,
} from "./deepagents-tool-runtime.js";

/**
 * BaseAgentTeamStructuredTool：team 结构化工具公共基类。
 *
 * 设计原因：四个 team 工具都依赖同一份会话级 team 作用域，并统一把执行结果回填为
 * `JSON.stringify(result) + completed`，公共层抽到基类后，子类只保留业务差异。
 */
export abstract class BaseAgentTeamStructuredTool<
    SchemaT extends ToolInputSchemaBase,
> extends CenterStructuredToolBase<SchemaT> {
    /**
     * executeTool：统一执行 team 工具并回填标准结果。
     *
     * @param arg 工具参数。
     * @returns 工具结果。
     */
    protected override async executeTool(
        arg: ToolInputSchemaOutputType<SchemaT>,
    ): Promise<DeepAgentsToolExecutionResult> {
        try {
            const result = this.executeAgentTeamTool(
                this.createAgentTeamToolScope(),
                arg,
            );
            return {
                outputText: JSON.stringify(result),
                status: "completed",
            };
        } catch (error) {
            const failureReason = error instanceof Error
                ? error.message
                : "AGENT_TEAM_TOOL_FAILED";
            return {
                outputText: failureReason,
                status: "failed",
            };
        }
    }

    /**
     * createAgentTeamToolScope：从当前工具上下文生成 team 工具公共作用域。
     *
     * @returns team 工具公共作用域。
     */
    protected createAgentTeamToolScope(): AgentTeamToolScope {
        return {
            database: this.context.input.database,
            events: this.context.input.events,
            sessionId: this.context.input.sent.sessionId,
            turnId: this.context.input.sent.turnId,
            taskId: this.context.input.sent.taskId,
            creatorAgentId: "main",
            toolCallId: null,
        };
    }

    /**
     * executeAgentTeamTool：执行具体 team 业务逻辑。
     *
     * @param scope team 工具公共作用域。
     * @param arg 工具参数。
     * @returns 业务结果对象。
     */
    protected abstract executeAgentTeamTool(
        scope: AgentTeamToolScope,
        arg: ToolInputSchemaOutputType<SchemaT>,
    ): Record<string, unknown>;
}
