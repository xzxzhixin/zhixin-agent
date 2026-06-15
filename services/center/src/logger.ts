import {
    createWriteStream,
    readdirSync,
    mkdirSync,
    statSync,
} from "node:fs";
import {join} from "node:path";
import {Writable} from "node:stream";
import pino, {type Logger} from "pino";

import {formatCenterLocalDateTime} from "./time.js";

/** CENTER_LOG_MESSAGE_KEY：中心服务日志消息字段名。 */
const CENTER_LOG_MESSAGE_KEY = "event";

/** CENTER_LOG_MAX_BYTES：单个中心服务日志文件最大字节数，来源于项目计划要求，固定 1MB。 */
const CENTER_LOG_MAX_BYTES = 1024 * 1024;

/**
 * CenterLogPayload：中心服务控制台日志结构。
 *
 * 来源：中心服务日志调用点。
 * 含义：约束控制台过滤中间态时读取的结构字段。
 * 格式：pino 日志对象中的 payload 字段。
 * 默认值：无。
 * 约束：字段只用于日志展示，不作为业务事实源。
 */
interface CenterLogPayload {
    /** status: 事件或过程状态；running 属于中间态，控制台不输出。 */
    status?: unknown;

    /** eventType: 中心服务事件类型，用于识别中间态过程事件。 */
    eventType?: unknown;
}

/**
 * CenterLogLine：中心服务日志调用对象。
 *
 * 来源：centerConsoleLogger 调用点。
 * 含义：统一读取 payload，避免调用点散落控制台编码和过滤逻辑。
 * 格式：pino 对象日志。
 * 默认值：无。
 * 约束：payload 不应包含敏感明文。
 */
interface CenterLogLine {
    /** payload: 结构化日志载荷。 */
    payload?: CenterLogPayload;
}

/**
 * CenterFileLogPayload：中心服务文件日志结构。
 *
 * 来源：CenterLogger 调用点。
 * 含义：识别是否属于不应固化到文件的流式中间态。
 * 格式：结构化日志 payload 对象。
 * 默认值：无。
 * 约束：只做日志过滤判断，不作为业务事实源。
 */
interface CenterFileLogPayload {
    /** eventType: 固定日志事件名或中心事件类型。 */
    eventType?: unknown;

    /** status: 当前日志对应状态；running 常见于流式过程。 */
    status?: unknown;
}

/**
 * CenterConsoleLogger：中心服务开发控制台日志门面。
 *
 * 来源：pino 第三方日志包。
 * 含义：过滤运行中中间态，并保持 UTF-8 原文输出，确保中文在开发控制台正确显示。
 * 格式：info/error 方法兼容现有调用点。
 * 默认值：输出到 stdout。
 * 约束：文件日志仍保留 UTF-8 原文，控制台只做开发排查摘要。
 */
interface CenterConsoleLogger {
    /**
     * info：输出信息级控制台日志。
     *
     * @param line 结构化日志对象。
     * @param event 固定日志事件名。
     * @returns 没有返回值。
     */
    info: (line: CenterLogLine, event: string) => void;

    /**
     * error：输出错误级控制台日志。
     *
     * @param line 结构化日志对象。
     * @param event 固定日志事件名。
     * @returns 没有返回值。
     */
    error: (line: CenterLogLine, event: string) => void;
}

/**
 * CenterLogger：中心服务文件日志。
 */
export class CenterLogger {
    /** logStream: 按大小轮转的日志写入流，来源于中心目录 logs 子目录。 */
    private readonly logStream: RotatingCenterLogStream;

    /** logger: pino 文件日志实例。 */
    private readonly logger: Logger;

    /**
     * constructor：绑定日志目录并创建按 1MB 轮转的文件日志。
     *
     * @param centerDirectory 中心目录绝对路径。
     */
    constructor(centerDirectory: string) {
        this.logStream = new RotatingCenterLogStream(join(
            centerDirectory,
            "logs",
        ));
        this.logger = pino(
            {
                base: null,
                messageKey: CENTER_LOG_MESSAGE_KEY,
                timestamp: () => {
                    return `,"occurredAt":"${formatCenterLocalDateTime()}"`;
                },
            },
            this.logStream,
        );
    }

    /**
     * info：写入信息级日志。
     *
     * @param event 固定事件名，便于后续按文本排查。
     * @param payload 结构化日志载荷，不能包含敏感明文。
     * @returns 日志写入完成后没有返回值。
     */
    async info(event: string, payload: Record<string, unknown>): Promise<void> {
        await this.write(
            "info",
            event,
            payload,
        );
    }

    /**
     * error：写入错误级日志。
     *
     * @param event 固定事件名，便于追踪错误来源。
     * @param payload 结构化错误载荷，不能包含敏感明文。
     * @returns 日志写入完成后没有返回值。
     */
    async error(event: string, payload: Record<string, unknown>): Promise<void> {
        await this.write(
            "error",
            event,
            payload,
        );
    }

    /**
     * write：追加一行 JSON 日志。
     *
     * @param level 日志级别。
     * @param event 固定事件名。
     * @param payload 结构化载荷。
     * @returns 写入完成后没有返回值。
     */
    private async write(
        level: "info" | "error",
        event: string,
        payload: Record<string, unknown>,
    ): Promise<void> {
        if (shouldSkipFileLog(event, payload)) {
            return;
        }
        // pinoLogger: 统一使用第三方日志包写 JSON 行，避免手写 JSON 和本机时间格式分叉。
        this.logger[level](
            {
                payload,
            },
            event,
        );
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
     * @param _encoding Node 写入编码，pino 已传入字符串或 Buffer。
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

/**
 * Utf8ConsoleStream：把 pino 控制台日志按 UTF-8 原文写入 stdout。
 */
class Utf8ConsoleStream extends Writable {
    /**
     * _write：保持 pino 输出原文写入 stdout。
     *
     * @param chunk pino 输出内容。
     * @param _encoding Node 写入编码。
     * @param callback 写入完成回调。
     * @returns 没有返回值。
     */
    override _write(
        chunk: Buffer | string,
        _encoding: BufferEncoding,
        callback: (error?: Error | null) => void,
    ): void {
        process.stdout.write(
            chunk,
            callback,
        );
    }
}

/**
 * centerConsoleLogger：中心服务开发控制台结构化日志。
 *
 * 来源：pino 第三方日志包。
 * 含义：替代散落 console.info/error 的开发控制台日志，控制台按 UTF-8 原文显示中文。
 * 默认值：输出到当前进程 stdout。
 * 约束：payload 不写敏感明文，running 中间态不输出，时间使用中心服务本机时间格式。
 */
export const centerConsoleLogger: CenterConsoleLogger = createCenterConsoleLogger();

/**
 * createCenterConsoleLogger：创建控制台日志门面。
 *
 * @returns 控制台日志门面。
 */
function createCenterConsoleLogger(): CenterConsoleLogger {
    const logger = pino(
        {
            base: null,
            messageKey: CENTER_LOG_MESSAGE_KEY,
            timestamp: () => {
                return `,"occurredAt":"${formatCenterLocalDateTime()}"`;
            },
        },
        new Utf8ConsoleStream(),
    );

    return {
        info: (line, event) => {
            if (shouldSkipConsoleLog(line)) {
                return;
            }
            logger.info(
                line,
                event,
            );
        },
        error: (line, event) => {
            logger.error(
                line,
                event,
            );
        },
    };
}

/**
 * shouldSkipConsoleLog：判断控制台是否跳过中间态日志。
 *
 * @param line 结构化日志对象。
 * @returns true 表示跳过输出。
 */
function shouldSkipConsoleLog(line: CenterLogLine): boolean {
    const payload = line.payload;
    if (!payload) {
        return false;
    }
    if (payload.status === "running") {
        return true;
    }
    return typeof payload.eventType === "string" && payload.eventType.endsWith(".started");
}

/**
 * shouldSkipFileLog：判断文件日志是否跳过流式中间态。
 *
 * @param event 固定日志事件名。
 * @param payload 当前日志载荷。
 * @returns true 表示不写入固化文件日志。
 */
function shouldSkipFileLog(event: string, payload: Record<string, unknown>): boolean {
    const filePayload = payload as CenterFileLogPayload;
    const eventType = typeof filePayload.eventType === "string"
        ? filePayload.eventType
        : event;
    if (eventType === "model.stream.delta" || eventType === "thinking.delta" || eventType === "tool.command.output") {
        return true;
    }
    return filePayload.status === "running" && (
        eventType.startsWith("model.stream.")
        || eventType.startsWith("thinking.")
        || eventType.endsWith(".delta")
        || eventType.endsWith(".output")
    );
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
