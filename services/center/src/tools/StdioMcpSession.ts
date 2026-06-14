import {spawn} from "node:child_process";
import type {ChildProcessWithoutNullStreams} from "node:child_process";

import type {StdioMcpServerConfig} from "./mcp-tool-specs.js";

/**
 * StdioMcpSession：stdio MCP 短生命周期会话。
 */
export class StdioMcpSession {
    /** child: 当前 stdio MCP Server 子进程。 */
    private readonly child: ChildProcessWithoutNullStreams;
    /** buffer: stdout 累积缓冲，用于解析换行 JSON 或 Content-Length 帧。 */
    private buffer = "";
    /** stderrChunks: 子进程 stderr 诊断摘要，失败时用于定位启动问题。 */
    private readonly stderrChunks: string[] = [];
    /** pending: JSON-RPC 请求等待表，按 id 关联响应。 */
    private readonly pending = new Map<string, {
        resolve: (value: unknown) => void;
        reject: (error: Error) => void;
        timeout: NodeJS.Timeout;
    }>();

    /**
     * constructor：创建 stdio MCP 会话。
     *
     * @param serverConfig stdio MCP Server 配置。
     */
    constructor(private readonly serverConfig: StdioMcpServerConfig) {
        const execution = resolveStdioExecution(serverConfig);
        this.child = spawn(
            execution.command,
            execution.args,
            {
                cwd: serverConfig.cwd ?? undefined,
                env: createStdioProcessEnv(serverConfig.env),
                windowsHide: true,
                stdio: "pipe",
            },
        );
        this.child.stdout.on("data", (chunk: Buffer) => {
            this.handleStdout(chunk.toString("utf-8"));
        });
        this.child.stderr.on("data", (chunk: Buffer) => {
            const text = chunk.toString("utf-8").trim();
            if (text) {
                this.stderrChunks.push(text);
            }
        });
        this.child.on("error", (error) => {
            this.rejectAll(error);
        });
        this.child.on("close", (code) => {
            const stderrSummary = this.stderrChunks.join("\n").slice(0, 500);
            this.rejectAll(new Error(`MCP_STDIO_CLOSED:${code ?? "UNKNOWN"}${stderrSummary ? `:${stderrSummary}` : ""}`));
        });
    }

    /**
     * initialize：完成 MCP initialize 和 initialized 通知。
     *
     * @returns 没有返回值。
     */
    async initialize(): Promise<void> {
        await this.request(
            "initialize",
            {
                protocolVersion: "2025-06-18",
                capabilities: {},
                clientInfo: {
                    name: "zhixin-agent-center",
                    version: "0.1.0",
                },
            },
        );
        this.notify(
            "notifications/initialized",
            {},
        );
    }

    /**
     * request：发送 JSON-RPC 请求并等待 result。
     *
     * @param method MCP 方法名。
     * @param params MCP 参数对象。
     * @returns JSON-RPC result。
     */
    request(method: string, params: Record<string, unknown>): Promise<unknown> {
        const id = randomMcpRequestId(method);
        this.writeJsonRpc({
            jsonrpc: "2.0",
            id,
            method,
            params,
        });
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`MCP_STDIO_TIMEOUT:${method}`));
            }, 30_000);
            this.pending.set(
                id,
                {
                    resolve,
                    reject,
                    timeout,
                },
            );
        });
    }

    /**
     * notify：发送 JSON-RPC notification。
     *
     * @param method MCP 通知方法名。
     * @param params MCP 通知参数。
     * @returns 没有返回值。
     */
    notify(method: string, params: Record<string, unknown>): void {
        this.writeJsonRpc({
            jsonrpc: "2.0",
            method,
            params,
        });
    }

    /**
     * close：关闭当前 stdio MCP 子进程。
     *
     * @returns 没有返回值。
     */
    close(): void {
        for (const entry of this.pending.values()) {
            clearTimeout(entry.timeout);
        }
        this.pending.clear();
        if (!this.child.killed) {
            this.child.kill();
        }
    }

    /**
     * writeJsonRpc：按 stdio transport 写入 JSON-RPC 消息。
     *
     * @param body JSON-RPC 消息体。
     * @returns 没有返回值。
     */
    private writeJsonRpc(body: Record<string, unknown>): void {
        this.child.stdin.write(`${JSON.stringify(body)}\n`);
    }

    /**
     * handleStdout：解析 stdout 中的换行 JSON 或 Content-Length 帧。
     *
     * @param chunk stdout 文本块。
     * @returns 没有返回值。
     */
    private handleStdout(chunk: string): void {
        this.buffer += chunk;
        this.drainContentLengthFrames();
        this.drainJsonLines();
    }

    /**
     * drainContentLengthFrames：兼容 Content-Length framed stdio 消息。
     *
     * @returns 没有返回值。
     */
    private drainContentLengthFrames(): void {
        while (this.buffer.startsWith("Content-Length:")) {
            const headerEnd = this.buffer.indexOf("\r\n\r\n");
            if (headerEnd < 0) {
                return;
            }
            const header = this.buffer.slice(0, headerEnd);
            const lengthMatch = /Content-Length:\s*(\d+)/iu.exec(header);
            if (!lengthMatch) {
                return;
            }
            const length = Number(lengthMatch[1]);
            const bodyStart = headerEnd + 4;
            const bodyEnd = bodyStart + length;
            if (this.buffer.length < bodyEnd) {
                return;
            }
            this.handleJsonRpcText(this.buffer.slice(bodyStart, bodyEnd));
            this.buffer = this.buffer.slice(bodyEnd);
        }
    }

    /**
     * drainJsonLines：解析每行一个 JSON-RPC 消息的 stdio 输出。
     *
     * @returns 没有返回值。
     */
    private drainJsonLines(): void {
        let newlineIndex = this.buffer.indexOf("\n");
        while (newlineIndex >= 0) {
            const line = this.buffer.slice(0, newlineIndex).trim();
            this.buffer = this.buffer.slice(newlineIndex + 1);
            if (line.length > 0) {
                this.handleJsonRpcText(line);
            }
            newlineIndex = this.buffer.indexOf("\n");
        }
    }

    /**
     * handleJsonRpcText：处理一条 JSON-RPC 响应或通知。
     *
     * @param text JSON-RPC 文本。
     * @returns 没有返回值。
     */
    private handleJsonRpcText(text: string): void {
        const parsed = tryParseRecord(text);
        if (!parsed || typeof parsed.id !== "string") {
            return;
        }
        const pending = this.pending.get(parsed.id);
        if (!pending) {
            return;
        }
        this.pending.delete(parsed.id);
        clearTimeout(pending.timeout);
        if (isRecord(parsed.error)) {
            pending.reject(new Error(`MCP_JSON_RPC_ERROR:${String(parsed.error.message ?? parsed.error.code ?? "UNKNOWN")}`));
            return;
        }
        pending.resolve(parsed.result ?? null);
    }

    /**
     * rejectAll：子进程异常时拒绝所有等待中的请求。
     *
     * @param error 失败原因。
     * @returns 没有返回值。
     */
    private rejectAll(error: Error): void {
        for (const [
            id,
            entry,
        ] of this.pending.entries()) {
            clearTimeout(entry.timeout);
            entry.reject(error);
            this.pending.delete(id);
        }
    }
}

/**
 * createStdioProcessEnv：创建 stdio MCP 子进程环境变量。
 *
 * @param extraEnv MCP 配置追加环境变量。
 * @returns 只包含字符串值的环境变量对象。
 */
function createStdioProcessEnv(extraEnv: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [
        key,
        value,
    ] of Object.entries(process.env)) {
        if (typeof value === "string") {
            result[key] = value;
        }
    }
    return {
        ...result,
        ...extraEnv,
    };
}

/**
 * resolveStdioExecution：修正 Windows 下 npm 系命令需要通过 cmd 启动的问题。
 *
 * @param serverConfig stdio MCP Server 配置。
 * @returns 可传给 spawn 的命令和参数。
 */
function resolveStdioExecution(serverConfig: StdioMcpServerConfig): {
    command: string;
    args: string[];
} {
    if (process.platform === "win32" && [
        "npx",
        "npm",
        "pnpm",
        "yarn",
    ].includes(serverConfig.command)) {
        return {
            command: "cmd.exe",
            args: [
                "/d",
                "/s",
                "/c",
                serverConfig.command,
                ...serverConfig.args,
            ],
        };
    }
    return {
        command: serverConfig.command,
        args: serverConfig.args,
    };
}

/**
 * randomMcpRequestId：为 MCP JSON-RPC 请求生成可读 ID。
 *
 * @param method MCP 方法名。
 * @returns 请求 ID。
 */
function randomMcpRequestId(method: string): string {
    return `${method}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

/**
 * tryParseRecord：尝试把 JSON 字符串解析成对象。
 *
 * @param text JSON 字符串。
 * @returns 对象；解析失败或不是对象时返回 null。
 */
function tryParseRecord(text: string): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(text) as unknown;
        return isRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * isRecord：判断未知值是否为普通对象。
 *
 * @param value 待判断值。
 * @returns 是普通对象时返回 true。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
