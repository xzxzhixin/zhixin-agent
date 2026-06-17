import {spawn} from "node:child_process";

import type {UnifiedToolCapability} from "@zhixin/shared";

import type {CenterEventStore} from "../events.js";
import {
    resolveUnifiedToolCapability,
} from "./tool-capability-registry.js";
import {
    type TurnGraphCheckpoint,
    withOptionalGraphCheckpoint,
} from "../domain/turn-graph-domain.js";
import {centerConsoleLogger} from "../logger.js";
import {throwIfTurnRuntimeAborted} from "../domain/turn-runtime-cancel-registry.js";
import {registerRunningCommandForTurn} from "../domain/turn-command-cancel-registry.js";

/**
 * CommandToolExecutionRequest：命令工具执行请求。
 *
 * 来源：Agent 工具规划结果。
 * 含义：中心服务按明确命令执行，并把过程写入事件日志。
 * 格式：可执行路径、参数和输入摘要。
 * 默认值：无。
 * 约束：只能由对话编排触发，浏览器端不直接调用。
 */
export interface CommandToolExecutionRequest {
    /** toolCallId: 模型工具调用 ID，用于 UI 把每次调用拆成独立命令框；非模型触发时为 null。 */
    toolCallId?: string | null;
    /** shellCommand: 需要 shell 语法时的完整命令行；优先于 executablePath 和 args。 */
    shellCommand?: string | null;
    /** executablePath: 可执行文件路径或命令名；使用 shellCommand 时可为空字符串。 */
    executablePath: string;
    /** args: 命令参数数组。 */
    args: string[];
    /** inputSummary: 命令用途摘要。 */
    inputSummary: string;
    /** runtimeSignal: 当前轮次取消信号，用于停止按钮中止正在运行的命令子进程。 */
    runtimeSignal?: AbortSignal;
}

/**
 * CommandToolExecutionResult：命令工具执行结果。
 *
 * 来源：中心服务命令运行器。
 * 含义：供过程卡片展示命令、状态、输出、失败原因和排查 ID。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：完整输出后续进入命令审计模块，当前只返回摘要。
 */
export interface CommandToolExecutionResult {
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
 * executeCommandTool：通过中心服务执行通用命令。
 *
 * @param events 事件日志仓储。
 * @param sessionId 会话 ID。
 * @param taskId 任务 ID。
 * @param turnId 轮次 ID。
 * @param request 命令请求。
 * @returns 命令输出摘要。
 */
export async function executeCommandTool(
    events: CenterEventStore,
    sessionId: string,
    taskId: string,
    turnId: string,
    request: CommandToolExecutionRequest,
    graphCheckpoint?: TurnGraphCheckpoint,
): Promise<CommandToolExecutionResult> {
    const capability = resolveUnifiedToolCapability("builtin.command.run");
    const execution = tryResolveCommandExecution(request);
    if (!execution) {
        centerConsoleLogger.error(
            {
                payload: {
                    sessionId,
                    turnId,
                    taskId,
                    toolCallId: request.toolCallId ?? null,
                    inputSummary: truncateConsoleText(request.inputSummary),
                },
            },
            "center.command_tool.input_invalid",
        );
        return resolveCommandToolInputFailure(
            events,
            capability,
            request,
            sessionId,
            taskId,
            turnId,
            graphCheckpoint,
        );
    }
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
    return new Promise<CommandToolExecutionResult>((resolve) => {
        throwIfTurnRuntimeAborted(request.runtimeSignal);
        const chunks: string[] = [];
        const child = spawn(
            execution.executablePath,
            execution.args,
            {
                env: createCommandEnvironment(),
                windowsHide: true,
            },
        );
        let settled = false;
        let unregisterRunningCommand: (() => void) | null = null;

        /**
         * cleanupRunningCommandRegistration：清理当前命令在轮次取消注册表中的入口。
         *
         * @returns 没有返回值。
         */
        const cleanupRunningCommandRegistration = (): void => {
            if (!unregisterRunningCommand) {
                return;
            }
            unregisterRunningCommand();
            unregisterRunningCommand = null;
        };

        /**
         * finishCancelledCommand：停止按钮触发后终止子进程并固化取消态。
         *
         * @param reason 取消原因。
         * @returns 没有返回值。
         */
        const finishCancelledCommand = (reason: string): void => {
            if (settled) {
                return;
            }
            settled = true;
            cleanupRunningCommandRegistration();
            child.kill();
            resolveCommandToolCancelledResult(
                events,
                capability,
                command,
                request.toolCallId ?? null,
                sessionId,
                taskId,
                turnId,
                chunks,
                reason,
                resolve,
                graphCheckpoint,
            );
        };

        unregisterRunningCommand = registerRunningCommandForTurn(
            turnId,
            finishCancelledCommand,
        );

        if (request.runtimeSignal?.aborted) {
            finishCancelledCommand(resolveRuntimeSignalCancelReason(request.runtimeSignal));
            return;
        }

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
            cleanupRunningCommandRegistration();
            centerConsoleLogger.error(
                {
                    payload: {
                        sessionId,
                        turnId,
                        taskId,
                        toolCallId: request.toolCallId ?? null,
                        errorMessage: truncateConsoleText(error.message),
                    },
                },
                "center.command_tool.spawn_error",
            );
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
            cleanupRunningCommandRegistration();
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
 * resolveCommandToolCancelledResult：根据用户停止写入命令取消事件。
 *
 * @param events 事件日志仓储。
 * @param capability 命令工具能力定义。
 * @param command 展示用命令。
 * @param toolCallId 模型工具调用 ID；非模型触发时为 null。
 * @param sessionId 会话 ID。
 * @param taskId 任务 ID。
 * @param turnId 轮次 ID。
 * @param chunks 已收集的输出块。
 * @param reason 取消原因。
 * @param resolve Promise 完成回调。
 * @param graphCheckpoint Deep Agents 图检查点。
 * @returns 没有返回值。
 */
function resolveCommandToolCancelledResult(
    events: CenterEventStore,
    capability: UnifiedToolCapability | null,
    command: string,
    toolCallId: string | null,
    sessionId: string,
    taskId: string,
    turnId: string,
    chunks: string[],
    reason: string,
    resolve: (result: CommandToolExecutionResult) => void,
    graphCheckpoint?: TurnGraphCheckpoint,
): void {
    const outputSummary = chunks.join("\n").trim();
    const failureReason = `COMMAND_CANCELLED: ${reason}`;
    const event = events.append({
        eventType: "tool.command.cancelled",
        scopeType: "tool",
        scopeId: taskId,
        sessionId,
        turnId,
        taskId,
        status: "cancelled",
        title: "命令工具已取消",
        summary: failureReason,
        payload: withOptionalGraphCheckpoint({
            toolId: capability?.toolId ?? "builtin.command.run",
            toolKind: "command",
            toolCallId,
            requiredPermission: capability?.requiredPermission ?? "command.run",
            command,
            outputSummary,
            exitCode: null,
            failureReason,
        }, graphCheckpoint),
    });

    resolve({
        toolKind: "command",
        command,
        status: "failed",
        outputSummary,
        failureReason,
        traceId: event.traceId,
    });
}

/**
 * resolveRuntimeSignalCancelReason：从运行时取消信号中解析可审计取消原因。
 *
 * @param signal 当前轮次运行时取消信号。
 * @returns 取消原因。
 */
function resolveRuntimeSignalCancelReason(signal: AbortSignal): string {
    const reason = signal.reason;
    if (reason instanceof Error && reason.message.trim().length > 0) {
        return reason.message;
    }
    if (reason && typeof reason === "object") {
        const reasonLike = reason as {
            /** message: AbortSignal.reason 可能携带的取消说明。 */
            message?: unknown;
        };
        if (typeof reasonLike.message === "string" && reasonLike.message.trim().length > 0) {
            return reasonLike.message;
        }
    }
    if (typeof reason === "string" && reason.trim().length > 0) {
        return reason;
    }
    return "用户点击停止当前执行。";
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
 * createCommandEnvironment：为命令工具子进程准备环境变量。
 *
 * 关键逻辑：Windows 中文乱码常来自子进程按本地代码页输出；优先要求 Python 和通用 CLI 使用 UTF-8，
 * 原环境变量仍保留，避免破坏用户 PATH、代理和运行环境配置。
 *
 * @returns 可传给 spawn 的环境变量。
 */
function createCommandEnvironment(): NodeJS.ProcessEnv {
    return {
        ...process.env,
        // PYTHONIOENCODING: Python stdout/stderr 统一输出 UTF-8，避免中文 traceback 或 print 内容乱码。
        PYTHONIOENCODING: "utf-8",
        // PYTHONUTF8: Python 3 UTF-8 模式；不影响非 Python 命令。
        PYTHONUTF8: "1",
        // DOTNET_SYSTEM_CONSOLE_ALLOW_ANSI_COLOR_REDIRECTION: 保留控制台重定向颜色兼容，不改变业务输出。
        DOTNET_SYSTEM_CONSOLE_ALLOW_ANSI_COLOR_REDIRECTION: "1",
    };
}

/**
 * truncateConsoleText：截断命令工具控制台日志，避免长脚本或长输出刷屏。
 *
 * @param text 原始命令、摘要或输出。
 * @returns 适合开发控制台的一行摘要。
 */
function truncateConsoleText(text: string): string {
    const normalizedText = text.replace(/\s+/gu, " ").trim();
    return normalizedText.length > 240
        ? `${normalizedText.slice(0, 240)}...`
        : normalizedText;
}

/**
 * tryResolveCommandExecution：把命令请求转换为可执行形式，空命令返回 null。
 *
 * @param request 命令工具请求。
 * @returns 实际可执行信息；缺少 shellCommand 和 executablePath 时返回 null。
 */
function tryResolveCommandExecution(request: CommandToolExecutionRequest): {
    executablePath: string;
    args: string[];
    displayCommand: string;
} | null {
    const execution = resolveCommandExecution(request);
    return execution.executablePath.trim().length > 0
        ? execution
        : null;
}

/**
 * resolveCommandExecution：把命令请求转换为当前系统可执行形式。
 *
 * @param request 命令工具请求。
 * @returns 实际可执行路径、参数和展示命令。
 */
function resolveCommandExecution(request: CommandToolExecutionRequest): {
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
function resolveBashCompatShellCommand(request: CommandToolExecutionRequest): string | null {
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
 * resolveCommandToolInputFailure：命令参数缺失时生成可展示工具失败事件。
 *
 * @param events 事件日志仓储。
 * @param capability 命令工具能力定义。
 * @param request 命令请求。
 * @param sessionId 会话 ID。
 * @param taskId 任务 ID。
 * @param turnId 轮次 ID。
 * @param graphCheckpoint 当前图检查点。
 * @returns 命令工具失败结果。
 */
function resolveCommandToolInputFailure(
    events: CenterEventStore,
    capability: UnifiedToolCapability | null,
    request: CommandToolExecutionRequest,
    sessionId: string,
    taskId: string,
    turnId: string,
    graphCheckpoint?: TurnGraphCheckpoint,
): CommandToolExecutionResult {
    // failureReason: 模型没有给出可执行命令时属于工具参数错误，不能继续传空字符串给 spawn。
    const failureReason = "COMMAND_INPUT_EMPTY: 命令工具缺少 shellCommand 或 executablePath。";
    const event = events.append({
        eventType: "tool.call.failed",
        scopeType: "tool",
        scopeId: taskId,
        sessionId,
        turnId,
        taskId,
        status: "failed",
        title: "命令工具失败",
        summary: failureReason,
        payload: withOptionalGraphCheckpoint({
            toolId: capability?.toolId ?? "builtin.command.run",
            toolKind: "command",
            toolCallId: request.toolCallId ?? null,
            requiredPermission: capability?.requiredPermission ?? "command.run",
            command: "",
            inputSummary: request.inputSummary,
            failureReason,
        }, graphCheckpoint),
    });

    return {
        toolKind: "command",
        command: "",
        status: "failed",
        outputSummary: "",
        failureReason,
        traceId: event.traceId,
    };
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
    resolve: (result: CommandToolExecutionResult) => void,
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
