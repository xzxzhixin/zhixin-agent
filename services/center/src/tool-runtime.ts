import {spawn} from "node:child_process";

import type {
    UnifiedToolCallIntent,
    UnifiedToolCapability,
} from "@zhixin/shared";
import type {ModelToolCall, ModelToolSpec} from "@zhixin/model-protocol";

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
        description: "在中心服务受控环境中执行明确的本机命令，并返回标准输出或错误摘要。",
        inputSchema: {
            type: "object",
            required: [
                "inputSummary",
            ],
            properties: {
                shellCommand: {
                    type: "string",
                    description: "需要 shell 语法时使用的完整命令行；Windows 由 PowerShell 执行，macOS/Linux 由 sh 执行。",
                },
                executablePath: {
                    type: "string",
                    description: "不需要 shell 语法时要执行的可执行文件路径或命令名。",
                },
                args: {
                    type: "array",
                    description: "不需要 shell 语法时的命令参数数组。",
                    items: {
                        type: "string",
                    },
                },
                inputSummary: {
                    type: "string",
                    description: "模型请求执行命令的目的摘要。",
                },
            },
        },
        riskLevel: "high",
        scope: "session",
        approvalRequired: true,
        displayText: "执行命令",
    },
    {
        toolId: "builtin.plugin.call",
        toolKind: "plugin",
        displayName: "插件工具",
        requiredPermission: "plugin.call",
        availability: "unavailable",
        unavailableReason: "PLUGIN_NOT_SELECTED",
        description: "调用当前会话可用的中心服务插件能力。",
        inputSchema: {
            type: "object",
            required: [
                "pluginId",
                "operation",
                "arguments",
            ],
            properties: {
                pluginId: {
                    type: "string",
                    description: "要调用的插件 ID。",
                },
                operation: {
                    type: "string",
                    description: "插件能力操作名。",
                },
                arguments: {
                    type: "object",
                    description: "插件操作参数。",
                },
            },
        },
        riskLevel: "medium",
        scope: "session",
        approvalRequired: true,
        displayText: "调用插件",
    },
    {
        toolId: "builtin.mcp.call",
        toolKind: "mcp",
        displayName: "MCP 工具",
        requiredPermission: "mcp.call",
        availability: "unavailable",
        unavailableReason: "MCP_SERVER_NOT_RESOLVED",
        description: "调用当前会话可用的 MCP Server 工具。",
        inputSchema: {
            type: "object",
            required: [
                "serverId",
                "toolName",
                "arguments",
            ],
            properties: {
                serverId: {
                    type: "string",
                    description: "MCP Server ID。",
                },
                toolName: {
                    type: "string",
                    description: "MCP 工具名称。",
                },
                arguments: {
                    type: "object",
                    description: "MCP 工具参数。",
                },
            },
        },
        riskLevel: "medium",
        scope: "session",
        approvalRequired: true,
        displayText: "调用 MCP",
    },
    {
        toolId: "builtin.skill.use",
        toolKind: "skill",
        displayName: "skill",
        requiredPermission: "skill.use",
        availability: "unavailable",
        unavailableReason: "SKILL_NOT_SELECTED",
        description: "解析并注入当前会话可用的 skill 工作流。",
        inputSchema: {
            type: "object",
            required: [
                "skillId",
                "request",
            ],
            properties: {
                skillId: {
                    type: "string",
                    description: "要使用的 skill ID。",
                },
                request: {
                    type: "string",
                    description: "请求 skill 处理的任务摘要。",
                },
            },
        },
        riskLevel: "low",
        scope: "session",
        approvalRequired: false,
        displayText: "使用 skill",
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
 * toModelSafeToolName：把中心服务内部工具 ID 转成模型协议安全名称。
 *
 * @param toolId 中心服务内部工具 ID。
 * @returns 只包含字母、数字、下划线或连字符的模型工具名。
 */
export function toModelSafeToolName(toolId: string): string {
    // safeName: OpenAI 兼容工具名不允许点号，统一替换成下划线并保留可读来源。
    return toolId.replace(/[^a-zA-Z0-9_-]/gu, "_");
}

/**
 * listAvailableModelToolSpecs：把中心服务工具能力转换为内部模型工具定义。
 *
 * @returns 模型请求可携带的工具定义列表。
 */
export function listAvailableModelToolSpecs(): ModelToolSpec[] {
    return listUnifiedToolCapabilities()
        .filter((capability) => {
            return capability.availability === "available";
        })
        .map((capability) => ({
            name: toModelSafeToolName(capability.toolId),
            sourceToolId: capability.toolId,
            description: capability.description,
            parametersJsonSchema: capability.inputSchema,
        }));
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
    /** toolCallId: 模型工具调用 ID，用于 UI 把每次调用拆成独立命令框；非模型触发时为 null。 */
    toolCallId?: string | null;
    /** shellCommand: 需要 shell 语法时的完整命令行；优先于 executablePath 和 args。 */
    shellCommand?: string | null;
    /** executablePath: 可执行文件路径或命令名。 */
    executablePath: string;
    /** args: 命令参数数组。 */
    args: string[];
    /** inputSummary: 命令用途摘要。 */
    inputSummary: string;
}

/**
 * planUnifiedToolCallForUserText：兼容旧调用方的临时入口。
 *
 * @param userText 用户输入。
 * @returns 固定返回 null，避免继续通过用户文本硬编码触发工具。
 */
export function planUnifiedToolCallForUserText(userText: string): UnifiedToolCallIntent | null {
    void userText;
    return null;
}

/**
 * buildUnifiedToolCallIntentFromModelCall：把模型工具调用转换为中心服务工具意图。
 *
 * @param toolCall 模型返回的结构化工具调用。
 * @returns 可执行工具意图；工具不存在或不可用时返回 null。
 */
export function buildUnifiedToolCallIntentFromModelCall(toolCall: ModelToolCall): UnifiedToolCallIntent | null {
    const capability = resolveUnifiedToolCapability(readInternalToolIdFromModelName(toolCall.name));
    if (!capability || capability.availability !== "available") {
        return null;
    }

    return {
        toolId: capability.toolId,
        toolKind: capability.toolKind,
        inputSummary: readToolInputSummary(toolCall.argumentsJson, capability.displayText),
        arguments: toolCall.argumentsJson,
    };
}

/**
 * readInternalToolIdFromModelName：把模型返回的工具名映射回内部工具 ID。
 *
 * @param modelToolName 模型回复中的工具名。
 * @returns 中心服务内部工具 ID；无法映射时返回原值供拒绝事件记录。
 */
function readInternalToolIdFromModelName(modelToolName: string): string {
    const capability = listUnifiedToolCapabilities().find((item) => {
        return toModelSafeToolName(item.toolId) === modelToolName || item.toolId === modelToolName;
    });
    return capability?.toolId ?? modelToolName;
}

/**
 * readToolInputSummary：从模型参数中读取工具用途摘要。
 *
 * @param argumentsJson 模型传入的工具参数。
 * @param fallbackSummary 工具默认展示文案。
 * @returns 工具用途摘要。
 */
function readToolInputSummary(argumentsJson: Record<string, unknown>, fallbackSummary: string): string {
    const inputSummary = argumentsJson.inputSummary;
    return typeof inputSummary === "string" && inputSummary.trim().length > 0
        ? inputSummary
        : fallbackSummary;
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
    const shellCommand = typeof intent.arguments.shellCommand === "string"
        ? intent.arguments.shellCommand
        : null;
    const executablePath = typeof intent.arguments.executablePath === "string"
        ? intent.arguments.executablePath
        : "";
    return {
        shellCommand,
        executablePath,
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
export async function runCommandTool(
    events: CenterEventStore,
    sessionId: string,
    taskId: string,
    turnId: string,
    request: CommandToolRequest,
): Promise<CommandToolResult> {
    const capability = resolveUnifiedToolCapability("builtin.command.run");
    const execution = resolveCommandExecution(request);
    const command = execution.displayCommand;
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
            toolCallId: request.toolCallId ?? null,
            requiredPermission: capability?.requiredPermission ?? "command.run",
            command,
            inputSummary: request.inputSummary,
        },
    });

    return new Promise<CommandToolResult>((resolve) => {
        const chunks: string[] = [];
        const child = spawn(
            execution.executablePath,
            execution.args,
            {
                windowsHide: true,
            },
        );
        let settled = false;

        /**
         * appendOutputChunk：把命令输出块追加到同一个命令过程卡片。
         *
         * @param chunk 输出块原文。
         * @returns 没有返回值。
         */
        const appendOutputChunk = (chunk: string): void => {
            const normalizedChunk = chunk.trimEnd();
            if (!normalizedChunk) {
                return;
            }
            chunks.push(normalizedChunk);
            events.append({
                eventType: "tool.command.output",
                scopeType: "tool",
                scopeId: taskId,
                sessionId,
                turnId,
                taskId,
                status: "running",
                title: "命令工具输出",
                summary: normalizedChunk,
                payload: {
                    toolId: capability?.toolId ?? "builtin.command.run",
                    toolKind: "command",
                    toolCallId: request.toolCallId ?? null,
                    requiredPermission: capability?.requiredPermission ?? "command.run",
                    command,
                    outputChunk: normalizedChunk,
                },
            });
        };

        child.stdout?.on("data", (chunk: Buffer) => {
            appendOutputChunk(chunk.toString("utf-8"));
        });
        child.stderr?.on("data", (chunk: Buffer) => {
            appendOutputChunk(chunk.toString("utf-8"));
        });
        child.on("error", (error) => {
            if (settled) {
                return;
            }
            settled = true;
            appendOutputChunk(error.message);
            resolveCommandToolResult(
                events,
                capability,
                command,
                request.toolCallId ?? null,
                sessionId,
                taskId,
                turnId,
                chunks,
                null,
                resolve,
            );
        });
        child.on("close", (exitCode) => {
            if (settled) {
                return;
            }
            settled = true;
            resolveCommandToolResult(
                events,
                capability,
                command,
                request.toolCallId ?? null,
                sessionId,
                taskId,
                turnId,
                chunks,
                exitCode,
                resolve,
            );
        });
    });
}

/**
 * resolveCommandExecution：把命令请求转换为当前系统可执行形式。
 *
 * @param request 命令工具请求。
 * @returns 实际可执行路径、参数和展示命令。
 */
function resolveCommandExecution(request: CommandToolRequest): {
    executablePath: string;
    args: string[];
    displayCommand: string;
} {
    const bashCompatCommand = resolveBashCompatShellCommand(request);
    if (request.shellCommand && request.shellCommand.trim().length > 0) {
        const shellCommand = request.shellCommand.trim();
        if (process.platform === "win32") {
            return {
                executablePath: "powershell.exe",
                args: [
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    shellCommand,
                ],
                displayCommand: shellCommand,
            };
        }

        return {
            executablePath: "sh",
            args: [
                "-lc",
                shellCommand,
            ],
            displayCommand: shellCommand,
        };
    }
    if (bashCompatCommand) {
        return {
            executablePath: "powershell.exe",
            args: [
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                bashCompatCommand,
            ],
            displayCommand: bashCompatCommand,
        };
    }
    const normalizedArgs = normalizeCommandArgs(
        request.executablePath,
        request.args,
    );
    const windowsWhichCommand = resolveWindowsWhichCommand(
        request.executablePath,
        normalizedArgs,
    );
    if (windowsWhichCommand) {
        return windowsWhichCommand;
    }

    return {
        executablePath: request.executablePath,
        args: normalizedArgs,
        displayCommand: [
            request.executablePath,
            ...normalizedArgs,
        ].join(" "),
    };
}

/**
 * normalizeCommandArgs：修正模型把可执行名重复放进 args 的常见参数。
 *
 * @param executablePath 可执行命令。
 * @param args 原始参数数组。
 * @returns 修正后的参数数组。
 */
function normalizeCommandArgs(
    executablePath: string,
    args: string[],
): string[] {
    if (args[0] === executablePath) {
        return args.slice(1);
    }
    return args;
}

/**
 * resolveWindowsWhichCommand：把 Windows 上不存在的 which 转为 PowerShell Get-Command。
 *
 * @param executablePath 原始可执行命令。
 * @param args 已规范化参数。
 * @returns Windows 可执行形式；不需要兼容时返回 null。
 */
function resolveWindowsWhichCommand(
    executablePath: string,
    args: string[],
): {
    executablePath: string;
    args: string[];
    displayCommand: string;
} | null {
    if (process.platform !== "win32" || executablePath !== "which" || args.length === 0) {
        return null;
    }
    const commandName = args[0];
    const shellCommand = `Get-Command ${commandName} | Select-Object -ExpandProperty Source`;
    return {
        executablePath: "powershell.exe",
        args: [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            shellCommand,
        ],
        displayCommand: shellCommand,
    };
}

/**
 * resolveBashCompatShellCommand：兼容模型在 Windows 上误选 bash -lc 的常见命令。
 *
 * @param request 命令工具请求。
 * @returns 可交给 PowerShell 执行的命令；不需要兼容时返回 null。
 */
function resolveBashCompatShellCommand(request: CommandToolRequest): string | null {
    if (process.platform !== "win32" || request.executablePath !== "bash" || request.args[0] !== "-lc") {
        return null;
    }
    const shellCommand = request.args.slice(1).join(" ").trim();
    if (!shellCommand) {
        return null;
    }
    return shellCommand
        .replace(/command -v /gu, "Get-Command ")
        .replace(/&&/gu, "; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE };");
}

/**
 * resolveCommandToolResult：根据命令退出状态追加完成或失败事件。
 *
 * @param events 事件日志仓储。
 * @param capability 命令工具能力定义。
 * @param command 展示用命令。
 * @param toolCallId 模型工具调用 ID；非模型触发时为 null。
 * @param sessionId 会话 ID。
 * @param taskId 任务 ID。
 * @param turnId 轮次 ID。
 * @param chunks 已收集的输出块。
 * @param exitCode 进程退出码；启动失败时为 null。
 * @param resolve Promise 完成回调。
 * @returns 没有返回值。
 */
function resolveCommandToolResult(
    events: CenterEventStore,
    capability: UnifiedToolCapability | null,
    command: string,
    toolCallId: string | null,
    sessionId: string,
    taskId: string,
    turnId: string,
    chunks: string[],
    exitCode: number | null,
    resolve: (result: CommandToolResult) => void,
): void {
    const outputSummary = chunks.join("\n").trim();
    const status = exitCode === 0 ? "completed" : "failed";
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
            toolCallId,
            requiredPermission: capability?.requiredPermission ?? "command.run",
            command,
            outputSummary,
            exitCode,
            failureReason: status === "completed" ? null : outputSummary || "COMMAND_EXIT_NON_ZERO",
        },
    });

    resolve({
        toolKind: "command",
        command,
        status,
        outputSummary,
        failureReason: status === "completed" ? null : outputSummary || "COMMAND_EXIT_NON_ZERO",
        traceId: event.traceId,
    });
}
