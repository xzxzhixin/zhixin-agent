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
 * runNodeVersionCommandTool：通过中心服务执行 Node.js 版本命令。
 *
 * @param events 事件日志仓储。
 * @param sessionId 会话 ID。
 * @param taskId 任务 ID。
 * @param turnId 轮次 ID。
 * @returns 命令输出摘要。
 */
export function runNodeVersionCommandTool(
    events: CenterEventStore,
    sessionId: string,
    taskId: string,
    turnId: string,
): {
    toolKind: "command";
    command: string;
    status: "completed" | "failed";
    outputSummary: string;
} {
    const command = `${process.execPath} -v`;
    events.append({
        eventType: "tool.command.started",
        scopeType: "tool",
        scopeId: taskId,
        sessionId,
        turnId,
        taskId,
        status: "running",
        title: "命令工具开始",
        summary: "中心服务准备执行 Node.js 版本检查命令。",
        payload: {
            toolKind: "command",
            command,
            inputSummary: "输出当前中心服务 Node.js 版本。",
        },
    });

    const result = spawnSync(
        process.execPath,
        [
            "-v",
        ],
        {
            encoding: "utf-8",
            windowsHide: true,
        },
    );
    const outputSummary = (result.stdout || result.stderr || "").trim();
    const status = result.status === 0 ? "completed" : "failed";
    events.append({
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
        },
    });

    return {
        toolKind: "command",
        command,
        status,
        outputSummary,
    };
}
