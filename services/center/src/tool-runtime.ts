import {spawnSync} from "node:child_process";

import type {CenterEventStore} from "./events.js";

/**
 * appendToolVisibilityEvents：写入自动工具使用可见过程。
 *
 * @param events 事件日志仓储。
 * @param sessionId 会话 ID。
 * @param taskId 任务 ID。
 * @param turnId 轮次 ID。
 * @returns 没有返回值。
 */
export function appendToolVisibilityEvents(
    events: CenterEventStore,
    sessionId: string,
    taskId: string,
    turnId: string,
): void {
    events.append({
        eventType: "tool.plugin.unavailable",
        scopeType: "tool",
        scopeId: taskId,
        sessionId,
        turnId,
        taskId,
        status: "completed",
        title: "插件工具状态",
        summary: "当前会话未选择具体插件工具，已记录为不可用状态。",
        payload: {
            toolKind: "plugin",
            unavailableReason: "PLUGIN_NOT_SELECTED",
        },
    });
    events.append({
        eventType: "tool.mcp.unavailable",
        scopeType: "tool",
        scopeId: taskId,
        sessionId,
        turnId,
        taskId,
        status: "completed",
        title: "MCP 工具状态",
        summary: "当前会话未解析到可执行 MCP Server，已记录为不可用状态。",
        payload: {
            toolKind: "mcp",
            unavailableReason: "MCP_SERVER_NOT_RESOLVED",
        },
    });
    events.append({
        eventType: "tool.skill.unavailable",
        scopeType: "tool",
        scopeId: taskId,
        sessionId,
        turnId,
        taskId,
        status: "completed",
        title: "skill 状态",
        summary: "当前会话未选择具体 skill，已记录为不可用状态。",
        payload: {
            toolKind: "skill",
            unavailableReason: "SKILL_NOT_SELECTED",
        },
    });
}

/**
 * CommandToolRequest：通用命令工具请求。
 *
 * 来源：Agent 工具规划结果。
 * 含义：中心服务按明确命令执行，并把过程写入事件日志。
 * 格式：可执行路径、参数和输入摘要。
 * 默认值：无。
 * 约束：只能由对话编排触发，浏览器端不直接调用。
 */
export interface CommandToolRequest {
    /** executablePath: 可执行文件路径或命令名。 */
    executablePath: string;
    /** args: 命令参数数组。 */
    args: string[];
    /** inputSummary: 命令用途摘要。 */
    inputSummary: string;
}

/**
 * CommandToolResult：通用命令工具结果。
 *
 * 来源：中心服务命令运行器。
 * 含义：供过程卡片展示命令、状态、输出、失败原因和排查 ID。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：完整输出后续进入命令审计模块，当前只返回摘要。
 */
export interface CommandToolResult {
    /** toolKind: 固定命令工具类型。 */
    toolKind: "command";
    /** command: 展示用命令摘要。 */
    command: string;
    /** status: 命令状态。 */
    status: "completed" | "failed";
    /** outputSummary: 命令输出摘要。 */
    outputSummary: string;
    /** failureReason: 失败原因，成功时为 null。 */
    failureReason: string | null;
    /** traceId: 完成或失败事件排查 ID。 */
    traceId: string;
}

/**
 * runCommandTool：通过中心服务执行通用命令。
 *
 * @param events 事件日志仓储。
 * @param sessionId 会话 ID。
 * @param taskId 任务 ID。
 * @param turnId 轮次 ID。
 * @param request 命令请求。
 * @returns 命令输出摘要。
 */
export function runCommandTool(
    events: CenterEventStore,
    sessionId: string,
    taskId: string,
    turnId: string,
    request: CommandToolRequest,
): CommandToolResult {
    const command = [
        request.executablePath,
        ...request.args,
    ].join(" ");
    events.append({
        eventType: "tool.command.started",
        scopeType: "tool",
        scopeId: taskId,
        sessionId,
        turnId,
        taskId,
        status: "running",
        title: "命令工具开始",
        summary: request.inputSummary,
        payload: {
            toolKind: "command",
            command,
            inputSummary: request.inputSummary,
        },
    });

    const result = spawnSync(
        request.executablePath,
        request.args,
        {
            encoding: "utf-8",
            windowsHide: true,
        },
    );
    const outputSummary = (result.stdout || result.stderr || "").trim();
    events.append({
        eventType: "tool.command.output",
        scopeType: "tool",
        scopeId: taskId,
        sessionId,
        turnId,
        taskId,
        status: "running",
        title: "命令工具输出",
        summary: outputSummary || "命令没有输出。",
        payload: {
            toolKind: "command",
            command,
            outputChunk: outputSummary || "命令没有输出。",
        },
    });
    const status = result.status === 0 ? "completed" : "failed";
    const event = events.append({
        eventType: status === "completed" ? "tool.command.completed" : "tool.call.failed",
        scopeType: "tool",
        scopeId: taskId,
        sessionId,
        turnId,
        taskId,
        status,
        title: status === "completed" ? "命令工具完成" : "命令工具失败",
        summary: outputSummary || "命令没有输出。",
        payload: {
            toolKind: "command",
            command,
            outputSummary,
            exitCode: result.status,
            failureReason: status === "completed" ? null : outputSummary || "COMMAND_EXIT_NON_ZERO",
        },
    });

    return {
        toolKind: "command",
        command,
        status,
        outputSummary,
        failureReason: status === "completed" ? null : outputSummary || "COMMAND_EXIT_NON_ZERO",
        traceId: event.traceId,
    };
}
