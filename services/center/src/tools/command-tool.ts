import {spawn} from "node:child_process";

import type {
    UnifiedToolCallIntent,
    UnifiedToolCapability,
} from "@zhixin/shared";

import type {CenterEventStore} from "../events.js";
import {
    planUnifiedToolCallForUserText,
} from "./tool-openai-adapter.js";
import {
    resolveUnifiedToolCapability,
} from "./tool-capability-registry.js";
import {
    type TurnGraphCheckpoint,
    withOptionalGraphCheckpoint,
} from "../domain/turn-graph-domain.js";

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
    graphCheckpoint?: TurnGraphCheckpoint,
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
        payload: withOptionalGraphCheckpoint({
            toolId: capability?.toolId ?? "builtin.command.run",
            toolKind: "command",
            toolCallId: request.toolCallId ?? null,
            requiredPermission: capability?.requiredPermission ?? "command.run",
            command,
            inputSummary: request.inputSummary,
        }, graphCheckpoint),
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
                payload: withOptionalGraphCheckpoint({
                    toolId: capability?.toolId ?? "builtin.command.run",
                    toolKind: "command",
                    toolCallId: request.toolCallId ?? null,
                    requiredPermission: capability?.requiredPermission ?? "command.run",
                    command,
                    outputChunk: normalizedChunk,
                }, graphCheckpoint),
            });
        };

        child.stdout?.on("data", (chunk: Buffer) => {
            appendOutputChunk(decodeCommandOutputChunk(chunk));
        });
        child.stderr?.on("data", (chunk: Buffer) => {
            appendOutputChunk(decodeCommandOutputChunk(chunk));
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
                graphCheckpoint,
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
                graphCheckpoint,
            );
        });
    });
}

/**
 * decodeCommandOutputChunk：把命令输出字节解码为 UI 可读文本。
 *
 * @param chunk stdout 或 stderr 原始字节。
 * @returns 已按平台兼容处理的文本。
 */
function decodeCommandOutputChunk(chunk: Buffer): string {
    // utf8Text: 非 Windows 和多数现代工具默认输出 UTF-8，先保留最常见路径。
    const utf8Text = new TextDecoder("utf-8").decode(chunk);
    if (process.platform !== "win32" || !utf8Text.includes("\uFFFD")) {
        return utf8Text;
    }

    // gb18030Text: Windows 中文环境下 PowerShell、cmd 或 Python traceback 可能按系统代码页输出。
    const gb18030Text = decodeWithEncoding(
        chunk,
        "gb18030",
    );
    if (gb18030Text && countReplacementCharacters(gb18030Text) < countReplacementCharacters(utf8Text)) {
        return gb18030Text;
    }

    // windows1252Text: 英文 Windows 工具的 ANSI 输出兜底，仍以替换字符数量作为选择依据。
    const windows1252Text = decodeWithEncoding(
        chunk,
        "windows-1252",
    );
    if (windows1252Text && countReplacementCharacters(windows1252Text) < countReplacementCharacters(utf8Text)) {
        return windows1252Text;
    }

    return utf8Text;
}

/**
 * decodeWithEncoding：按指定编码尝试解码命令输出。
 *
 * @param chunk 原始字节。
 * @param encoding TextDecoder 支持的编码名。
 * @returns 解码文本；当前 Node 环境不支持该编码时返回 null。
 */
function decodeWithEncoding(
    chunk: Buffer,
    encoding: string,
): string | null {
    try {
        return new TextDecoder(encoding).decode(chunk);
    } catch {
        // catch: 不同 Node ICU 构建支持的 legacy encoding 可能不同，失败时让调用方继续使用其他编码。
        return null;
    }
}

/**
 * countReplacementCharacters：统计解码替换字符数量。
 *
 * @param text 已解码文本。
 * @returns Unicode 替换字符数量。
 */
function countReplacementCharacters(text: string): number {
    return Array.from(text).filter((character) => {
        return character === "\uFFFD";
    }).length;
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
    graphCheckpoint?: TurnGraphCheckpoint,
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
        payload: withOptionalGraphCheckpoint({
            toolId: capability?.toolId ?? "builtin.command.run",
            toolKind: "command",
            toolCallId,
            requiredPermission: capability?.requiredPermission ?? "command.run",
            command,
            outputSummary,
            exitCode,
            failureReason: status === "completed" ? null : outputSummary || "COMMAND_EXIT_NON_ZERO",
        }, graphCheckpoint),
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
