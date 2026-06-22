import {
    createWriteStream,
    mkdirSync,
    readdirSync,
    statSync,
} from "node:fs";
import {join} from "node:path";
import {Writable} from "node:stream";

import pino, {
    type Logger,
    type LoggerOptions,
    type StreamEntry,
} from "pino";

import {
    type CenterLogLevel,
    readCenterLogConfig,
} from "./system-config.js";
import {formatCenterLocalDateTime} from "./time.js";

/** CENTER_LOG_MESSAGE_KEY：中心服务日志事件字段名。 */
const CENTER_LOG_MESSAGE_KEY = "event";

/** CENTER_LOG_MAX_BYTES：单个中心服务日志文件最大字节数，来源于项目计划要求，固定 1MB。 */
const CENTER_LOG_MAX_BYTES = 1024 * 1024;

/** CENTER_LOG_DEPTH_LIMIT：日志脱敏递归深度上限，避免异常对象导致日志序列化过深。 */
const CENTER_LOG_DEPTH_LIMIT = 8;

/** CENTER_LOG_STREAM_LEVEL：pino 多流最低接收等级，实际过滤由 logger.level 动态控制。 */
const CENTER_LOG_STREAM_LEVEL: CenterLogLevel = "trace";

/** CONSOLE_PIPE_BROKEN_ERROR_CODE：Node 在 stdout 管道断开时抛出的错误码。 */
const CONSOLE_PIPE_BROKEN_ERROR_CODE = "EPIPE";

/**
 * CenterLogger：中心服务统一 pino 日志管线。
 *
 * 用途：同一条日志通过 pino 同步写入控制台和中心目录 logs 文件。
 * 关键逻辑：日志等级动态读取中心配置文件，流式输出只受等级控制，不再被管线硬过滤。
 */
export class CenterLogger {
    /** logger: pino 日志实例，负责 JSON 序列化、等级判断和多流写入。 */
    private readonly logger: Logger;

    /** centerDirectory: 中心目录绝对路径，用于动态读取日志等级配置。 */
    private readonly centerDirectory: string;

    /**
     * constructor：绑定日志目录并创建 pino 多流日志。
     *
     * @param centerDirectory 中心目录绝对路径。
     */
    constructor(centerDirectory: string) {
        this.centerDirectory = centerDirectory;
        this.logger = createPinoLogger(centerDirectory);
        this.syncDynamicLevel();
    }

    /**
     * debug：写入调试级日志。
     *
     * @param event 固定事件名，便于后续按文本排查。
     * @param payload 结构化日志载荷，写入前统一脱敏。
     * @returns 日志写入完成后没有返回值。
     */
    async debug(event: string, payload: Record<string, unknown>): Promise<void> {
        this.write(
            "debug",
            event,
            payload,
        );
    }

    /**
     * info：写入信息级日志。
     *
     * @param event 固定事件名，便于后续按文本排查。
     * @param payload 结构化日志载荷，写入前统一脱敏。
     * @returns 日志写入完成后没有返回值。
     */
    async info(event: string, payload: Record<string, unknown>): Promise<void> {
        this.write(
            "info",
            event,
            payload,
        );
    }

    /**
     * warn：写入警告级日志。
     *
     * @param event 固定事件名，便于后续按文本排查。
     * @param payload 结构化日志载荷，写入前统一脱敏。
     * @returns 日志写入完成后没有返回值。
     */
    async warn(event: string, payload: Record<string, unknown>): Promise<void> {
        this.write(
            "warn",
            event,
            payload,
        );
    }

    /**
     * error：写入错误级日志。
     *
     * @param event 固定事件名，便于追踪错误来源。
     * @param payload 结构化错误载荷，写入前统一脱敏。
     * @returns 日志写入完成后没有返回值。
     */
    async error(event: string, payload: Record<string, unknown>): Promise<void> {
        this.write(
            "error",
            event,
            payload,
        );
    }

    /**
     * write：通过 pino 追加一行 JSON 日志。
     *
     * @param level 日志级别。
     * @param event 固定事件名。
     * @param payload 结构化载荷。
     * @returns 没有返回值。
     */
    private write(
        level: CenterLogLevel,
        event: string,
        payload: Record<string, unknown>,
    ): void {
        this.syncDynamicLevel();
        this.logger[level](
            {
                payload: sanitizeLogValue(
                    payload,
                    0,
                    new WeakSet<object>(),
                ),
            },
            event,
        );
    }

    /**
     * syncDynamicLevel：把配置文件中的最新等级同步到 pino 实例。
     *
     * @returns 没有返回值。
     */
    private syncDynamicLevel(): void {
        const effectiveLevel = readCenterLogConfig(this.centerDirectory).effectiveLevel;
        if (this.logger.level !== effectiveLevel) {
            this.logger.level = effectiveLevel;
        }
    }
}

/**
 * RotatingCenterLogStream：按 1MB 切换中心服务文件日志。
 */
class RotatingCenterLogStream extends Writable {
    /** logsDirectory: 日志目录绝对路径，来源于中心目录 logs 子目录。 */
    private readonly logsDirectory: string;

    /** currentFilePath: 当前写入的日志文件绝对路径。 */
    private currentFilePath: string;

    /** currentSizeBytes: 当前日志文件已写入字节数，用于轮转判断。 */
    private currentSizeBytes = 0;

    /** fileNameSequence: 同一秒内连续轮转时的文件名序号，避免覆盖或追加到已满文件。 */
    private fileNameSequence = 0;

    /** lastFileTimestamp: 最近一次日志文件名时间戳，用于判断是否处于同一秒。 */
    private lastFileTimestamp = "";

    /** fileStream: 当前 UTF-8 文件写入流。 */
    private fileStream: NodeJS.WritableStream;

    /**
     * constructor：初始化日志目录和首个日志文件。
     *
     * @param logsDirectory 日志目录绝对路径。
     */
    constructor(logsDirectory: string) {
        super();
        this.logsDirectory = logsDirectory;
        mkdirSync(this.logsDirectory, {
            recursive: true,
        });
        this.currentFilePath = this.resolveInitialLogFilePath();
        this.currentSizeBytes = this.readExistingFileSize(this.currentFilePath);
        this.fileStream = this.openFileStream(this.currentFilePath);
    }

    /**
     * _write：写入 pino JSON 行，超过 1MB 前切换到新文件。
     *
     * @param chunk pino 输出的 UTF-8 字节。
     * @param _encoding Node 写入编码。
     * @param callback 写入完成回调。
     * @returns 没有返回值。
     */
    override _write(
        chunk: Buffer | string,
        _encoding: BufferEncoding,
        callback: (error?: Error | null) => void,
    ): void {
        const chunkBuffer = Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(
                chunk,
                "utf-8",
            );
        if (this.currentSizeBytes > 0 && this.currentSizeBytes + chunkBuffer.byteLength > CENTER_LOG_MAX_BYTES) {
            this.rotate();
        }
        this.currentSizeBytes += chunkBuffer.byteLength;
        this.fileStream.write(
            chunkBuffer,
            callback,
        );
    }

    /**
     * rotate：关闭当前文件流并创建新的时间命名日志文件。
     *
     * @returns 没有返回值。
     */
    private rotate(): void {
        this.fileStream.end();
        this.currentFilePath = this.createLogFilePath();
        this.currentSizeBytes = 0;
        this.fileStream = this.openFileStream(this.currentFilePath);
    }

    /**
     * createLogFilePath：生成中心服务日志文件路径。
     *
     * @returns 新日志文件绝对路径。
     */
    private createLogFilePath(): string {
        const timestamp = formatCenterLogFileTimestamp();
        if (timestamp === this.lastFileTimestamp) {
            this.fileNameSequence += 1;
        } else {
            this.lastFileTimestamp = timestamp;
            this.fileNameSequence = 0;
        }
        const sequenceSuffix = this.fileNameSequence === 0
            ? ""
            : `-${this.fileNameSequence}`;
        return join(
            this.logsDirectory,
            `${timestamp}${sequenceSuffix}.log`,
        );
    }

    /**
     * resolveInitialLogFilePath：启动时优先复用当天最后一个未满 1MB 的日志文件。
     *
     * 关键逻辑：同一天内只要最后一个日志文件未达到 1MB，就继续追加；跨天后即使旧文件未满也必须切到新文件。
     *
     * @returns 当前进程启动后首个写入的日志文件绝对路径。
     */
    private resolveInitialLogFilePath(): string {
        const currentDayPrefix = formatCenterLogFileDayPrefix();
        const sameDayLogFiles = readdirSync(this.logsDirectory)
            .filter((fileName) => {
                return fileName.startsWith(currentDayPrefix) && fileName.endsWith(".log");
            })
            .sort();
        const lastSameDayLogFile = sameDayLogFiles.at(-1);
        if (!lastSameDayLogFile) {
            return this.createLogFilePath();
        }
        const lastSameDayLogFilePath = join(
            this.logsDirectory,
            lastSameDayLogFile,
        );
        const lastSameDayLogFileSize = this.readExistingFileSize(lastSameDayLogFilePath);
        if (lastSameDayLogFileSize >= CENTER_LOG_MAX_BYTES) {
            return this.createLogFilePath();
        }
        this.syncFileSequenceFromExistingFileName(lastSameDayLogFile);
        return lastSameDayLogFilePath;
    }

    /**
     * syncFileSequenceFromExistingFileName：从已存在日志文件名恢复当前时间戳和序号。
     *
     * @param fileName 已存在的日志文件名。
     * @returns 没有返回值。
     */
    private syncFileSequenceFromExistingFileName(fileName: string): void {
        const matched = /^(.+?)(?:-(\d+))?\.log$/u.exec(fileName);
        if (!matched || !matched[1]) {
            return;
        }
        this.lastFileTimestamp = matched[1];
        this.fileNameSequence = matched[2]
            ? Number.parseInt(
                matched[2],
                10,
            )
            : 0;
    }

    /**
     * readExistingFileSize：读取已有同名文件大小。
     *
     * @param filePath 日志文件绝对路径。
     * @returns 文件字节数，文件不存在时返回 0。
     */
    private readExistingFileSize(filePath: string): number {
        try {
            return statSync(filePath).size;
        } catch {
            // catch: 同一秒内不存在旧文件是正常路径，返回 0 继续创建。
            return 0;
        }
    }

    /**
     * openFileStream：打开 UTF-8 追加写入流。
     *
     * @param filePath 日志文件绝对路径。
     * @returns Node 文件写入流。
     */
    private openFileStream(filePath: string): NodeJS.WritableStream {
        return createWriteStream(filePath, {
            flags: "a",
            encoding: "utf-8",
        });
    }
}

// safeConsoleLogStream：pino 控制台输出安全流，断管后只丢弃控制台输出，不影响文件日志。
const safeConsoleLogStream = createSafeConsoleLogStream();

/** 
 * createPinoLogger：创建中心服务统一 pino logger。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @returns pino logger 实例。
 */
function createPinoLogger(centerDirectory: string): Logger {
    const streams: StreamEntry[] = [
        {
            level: CENTER_LOG_STREAM_LEVEL,
            stream: safeConsoleLogStream,
        },
        {
            level: CENTER_LOG_STREAM_LEVEL,
            stream: new RotatingCenterLogStream(join(
                centerDirectory,
                "logs",
            )),
        },
    ];
    return pino(
        createPinoOptions(),
        pino.multistream(
            streams,
            {
                dedupe: false,
            },
        ),
    );
}

/**
 * createSafeConsoleLogStream：创建控制台日志安全写入流。
 *
 * 用途：包装 process.stdout，避免 IDEA 强停、父进程管道断开或控制台关闭时的 EPIPE 阻断 pino 多流写入。
 * 关键逻辑：第一次遇到 EPIPE 后禁用控制台输出，后续日志直接丢弃；文件日志流继续由 pino multistream 写入。
 *
 * @returns 可交给 pino multistream 的 Writable 控制台流。
 */
function createSafeConsoleLogStream(): Writable {
    // isPipeBroken: 控制台管道是否已经断开，断开后不再尝试写 stdout。
    let isPipeBroken = false;
    return new Writable({
        write(
            chunk: Buffer | string,
            _encoding: BufferEncoding,
            callback: (error?: Error | null) => void,
        ): void {
            if (isPipeBroken) {
                callback();
                return;
            }

            // isCallbackSettled: stdout 可能通过同步异常、写入回调或 error 事件报告错误，只允许回调一次。
            let isCallbackSettled = false;
            let handleError: (error: Error) => void = () => {};
            const finishWrite = (error?: Error | null): void => {
                if (isCallbackSettled) {
                    return;
                }
                isCallbackSettled = true;
                process.stdout.off(
                    "error",
                    handleError,
                );
                callback(error);
            };
            handleError = (error: Error): void => {
                if (isConsolePipeBrokenError(error)) {
                    isPipeBroken = true;
                    finishWrite();
                    return;
                }
                finishWrite(error);
            };

            try {
                process.stdout.once(
                    "error",
                    handleError,
                );
                process.stdout.write(
                    chunk,
                    (error) => {
                        if (error && isConsolePipeBrokenError(error)) {
                            isPipeBroken = true;
                            finishWrite();
                            return;
                        }
                        finishWrite(error);
                    },
                );
            } catch (error) {
                if (isConsolePipeBrokenError(error)) {
                    isPipeBroken = true;
                    finishWrite();
                    return;
                }
                finishWrite(error instanceof Error ? error : new Error(String(error)));
            }
        },
    });
}

/**
 * isConsolePipeBrokenError：判断控制台写入异常是否为 stdout 断管。
 *
 * @param error 捕获到的未知异常。
 * @returns 命中 EPIPE 时返回 true。
 */
function isConsolePipeBrokenError(error: unknown): boolean {
    return error instanceof Error
        && "code" in error
        && (error as NodeJS.ErrnoException).code === CONSOLE_PIPE_BROKEN_ERROR_CODE;
}

/**
 * createPinoOptions：创建 pino 输出配置。
 *
 * @returns pino 配置对象。
 */
function createPinoOptions(): LoggerOptions {
    return {
        base: null,
        level: "info",
        messageKey: CENTER_LOG_MESSAGE_KEY,
        timestamp: () => {
            return `,"occurredAt":"${formatCenterLocalDateTime()}"`;
        },
        formatters: {
            level: (label) => {
                return {
                    level: label,
                };
            },
        },
    };
}

/**
 * sanitizeLogValue：递归脱敏日志载荷。
 *
 * @param value 日志原始值。
 * @param depth 当前递归深度。
 * @param seen 已访问对象集合，用于截断循环引用。
 * @returns 可安全序列化的日志值。
 */
function sanitizeLogValue(
    value: unknown,
    depth: number,
    seen: WeakSet<object>,
): unknown {
    if (depth > CENTER_LOG_DEPTH_LIMIT) {
        return "[日志字段过深已省略]";
    }

    if (value === null || typeof value !== "object") {
        if (typeof value === "bigint") {
            return value.toString();
        }
        if (typeof value === "function") {
            return "[函数已省略]";
        }
        if (typeof value === "symbol") {
            return "[Symbol已省略]";
        }
        return value;
    }

    if (seen.has(value)) {
        return "[循环引用已省略]";
    }
    seen.add(value);

    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            stack: value.stack,
        };
    }

    if (Array.isArray(value)) {
        return value.map((item) => {
            return sanitizeLogValue(
                item,
                depth + 1,
                seen,
            );
        });
    }

    const sanitized: Record<string, unknown> = {};
    for (const [
        key,
        fieldValue,
    ] of Object.entries(value as Record<string, unknown>)) {
        if (isSensitiveLogField(key)) {
            sanitized[key] = "[已脱敏]";
            continue;
        }
        sanitized[key] = sanitizeLogValue(
            fieldValue,
            depth + 1,
            seen,
        );
    }
    return sanitized;
}

/**
 * isSensitiveLogField：判断字段名是否属于敏感信息。
 *
 * @param key 日志字段名。
 * @returns 命中敏感字段片段时返回 true。
 */
function isSensitiveLogField(key: string): boolean {
    const normalizedKey = key.toLowerCase();
    return normalizedKey.includes("apikey")
        || normalizedKey.includes("api_key")
        || normalizedKey.includes("authorization")
        || normalizedKey.includes("cookie")
        || normalizedKey.includes("password")
        || normalizedKey.includes("token")
        || normalizedKey.includes("secret");
}

/**
 * formatCenterLogFileTimestamp：格式化日志文件名时间。
 *
 * @returns center_YYYY_MM_DD_HH_mm_ss 格式文件名前缀。
 */
function formatCenterLogFileTimestamp(): string {
    // replace：文件名按需求统一使用下划线分隔日期、时间和前缀，避免空格与冒号造成跨平台命名差异。
    return `center_${formatCenterLocalDateTime().replace(/[- :]/gu, "_")}`;
}

/**
 * formatCenterLogFileDayPrefix：格式化当天日志文件名前缀。
 *
 * @returns center_YYYY_MM_DD 前缀，用于跨天切换日志文件。
 */
function formatCenterLogFileDayPrefix(): string {
    return formatCenterLogFileTimestamp().slice(
        0,
        "center_YYYY_MM_DD".length,
    );
}
