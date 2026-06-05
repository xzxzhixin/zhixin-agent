import {spawnSync} from "node:child_process";

import type {
    UnifiedToolCallIntent,
    UnifiedToolCapability,
    UnifiedToolKind,
} from "@zhixin/shared";

import type {CenterEventStore} from "./events.js";

/**
 * UNIFIED_TOOL_CAPABILITY_REGISTRY：中心服务统一工具能力注册表。
 *
 * 来源：架构中的命令、插件、MCP 和 skill 统一能力链路。
 * 含义：所有智能体和子智能体先从该注册表发现工具，再进入权限、执行和审计。
 * 约束：当前插件/MCP/skill 尚未绑定具体执行器时只登记不可用原因，不伪造成功调用。
 */
export const UNIFIED_TOOL_CAPABILITY_REGISTRY: UnifiedToolCapability[] = [
    {
        toolId: "builtin.command.run",
        toolKind: "command",
        displayName: "命令工具",
        requiredPermission: "command.run",
        availability: "available",
        unavailableReason: null,
    },
    {
        toolId: "builtin.plugin.call",
        toolKind: "plugin",
        displayName: "插件工具",
        requiredPermission: "plugin.call",
        availability: "unavailable",
        unavailableReason: "PLUGIN_NOT_SELECTED",
    },
    {
        toolId: "builtin.mcp.call",
        toolKind: "mcp",
        displayName: "MCP 工具",
        requiredPermission: "mcp.call",
        availability: "unavailable",
        unavailableReason: "MCP_SERVER_NOT_RESOLVED",
    },
    {
        toolId: "builtin.skill.use",
        toolKind: "skill",
        displayName: "skill",
        requiredPermission: "skill.use",
        availability: "unavailable",
        unavailableReason: "SKILL_NOT_SELECTED",
    },
];

/**
 * listUnifiedToolCapabilities：读取统一工具能力注册表。
 *
 * @returns 工具能力副本。
 */
export function listUnifiedToolCapabilities(): UnifiedToolCapability[] {
    return UNIFIED_TOOL_CAPABILITY_REGISTRY.map((capability) => ({
        ...capability,
    }));
}

/**
 * resolveUnifiedToolCapability：按工具 ID 读取注册能力。
 *
 * @param toolId 工具 ID。
 * @returns 工具能力；不存在时返回 null。
 */
export function resolveUnifiedToolCapability(toolId: string): UnifiedToolCapability | null {
    return listUnifiedToolCapabilities().find((capability) => {
        return capability.toolId === toolId;
    }) ?? null;
}

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
    for (const capability of listUnifiedToolCapabilities()) {
        if (capability.availability === "available") {
            continue;
        }
        appendUnifiedToolUnavailableEvent(
            events,
            sessionId,
            taskId,
            turnId,
            capability,
        );
    }
}

/**
 * appendUnifiedToolUnavailableEvent：用统一事件模型写入不可用工具状态。
 *
 * @param events 事件日志仓储。
 * @param sessionId 会话 ID。
 * @param taskId 任务 ID。
 * @param turnId 轮次 ID。
 * @param capability 工具能力。
 * @returns 没有返回值。
 */
function appendUnifiedToolUnavailableEvent(
    events: CenterEventStore,
    sessionId: string,
    taskId: string,
    turnId: string,
    capability: UnifiedToolCapability,
): void {
    events.append({
        eventType: `tool.${capability.toolKind}.unavailable`,
        scopeType: "tool",
        scopeId: taskId,
        sessionId,
        turnId,
        taskId,
        status: "completed",
        title: `${capability.displayName}状态`,
        summary: `当前会话未解析到可执行${capability.displayName}，已记录为不可用状态。`,
        payload: {
            toolId: capability.toolId,
            toolKind: capability.toolKind,
            availability: capability.availability,
            requiredPermission: capability.requiredPermission,
            unavailableReason: capability.unavailableReason,
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
 * planUnifiedToolCallForUserText：按用户输入生成统一工具调用意图。
 *
 * @param userText 用户输入。
 * @returns 工具调用意图；没有明确工具请求时返回 null。
 */
export function planUnifiedToolCallForUserText(userText: string): UnifiedToolCallIntent | null {
    const normalized = userText.toLowerCase();
    if (normalized.includes("node") && (normalized.includes("版本") || normalized.includes("version") || normalized.includes("-v"))) {
        return {
            toolId: "builtin.command.run",
            toolKind: "command",
            inputSummary: "输出当前中心服务使用的 Node.js 运行环境版本。",
            arguments: {
                executablePath: process.execPath,
                args: [
                    "-v",
                ],
            },
        };
    }

    if (normalized.includes("python") && (normalized.includes("版本") || normalized.includes("version") || normalized.includes("-v"))) {
        return {
            toolId: "builtin.command.run",
            toolKind: "command",
            inputSummary: "输出本机 Python 运行环境版本。",
            arguments: {
                executablePath: "python",
                args: [
                    "--version",
                ],
            },
        };
    }

    return null;
}

/**
 * planCommandToolForUserText：兼容旧调用方的命令工具规划入口。
 *
 * @param userText 用户输入。
 * @returns 命令请求；没有命令意图时返回 null。
 */
export function planCommandToolForUserText(userText: string): CommandToolRequest | null {
    const intent = planUnifiedToolCallForUserText(userText);
    if (!intent || intent.toolKind !== "command") {
        return null;
    }
    return commandRequestFromUnifiedToolIntent(intent);
}

/**
 * commandRequestFromUnifiedToolIntent：把统一工具意图转换为命令执行请求。
 *
 * @param intent 统一工具调用意图。
 * @returns 命令工具请求。
 */
export function commandRequestFromUnifiedToolIntent(intent: UnifiedToolCallIntent): CommandToolRequest {
    return {
        executablePath: String(intent.arguments.executablePath),
        args: Array.isArray(intent.arguments.args)
            ? intent.arguments.args.map((arg) => String(arg))
            : [],
        inputSummary: intent.inputSummary,
    };
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
    const capability = resolveUnifiedToolCapability("builtin.command.run");
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
            toolId: capability?.toolId ?? "builtin.command.run",
            toolKind: "command",
            requiredPermission: capability?.requiredPermission ?? "command.run",
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
            toolId: capability?.toolId ?? "builtin.command.run",
            toolKind: "command",
            requiredPermission: capability?.requiredPermission ?? "command.run",
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
            toolId: capability?.toolId ?? "builtin.command.run",
            toolKind: "command",
            requiredPermission: capability?.requiredPermission ?? "command.run",
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
