import {createWriteStream, mkdirSync} from "node:fs";
import {dirname, join} from "node:path";
import pino, {type Logger} from "pino";

import {formatCenterLocalDateTime} from "./time.js";

/** CENTER_LOG_MESSAGE_KEY：中心服务日志消息字段名。 */
const CENTER_LOG_MESSAGE_KEY = "event";

/**
 * centerConsoleLogger：中心服务开发控制台结构化日志。
 *
 * 来源：pino 第三方日志包。
 * 含义：替代散落 console.info/error 的开发控制台日志，确保中文以 UTF-8 结构化输出。
 * 默认值：输出到当前进程 stdout。
 * 约束：payload 不写敏感明文，时间使用中心服务本机时间格式。
 */
export const centerConsoleLogger: Logger = pino({
    base: null,
    messageKey: CENTER_LOG_MESSAGE_KEY,
    timestamp: () => {
        return `,"occurredAt":"${formatCenterLocalDateTime()}"`;
    },
});

export class CenterLogger {
    /**
     * logFilePath: 日志文件绝对路径，来源于中心目录 logs 子目录。
     */
    private readonly logFilePath: string;

    /**
     * logger: pino 文件日志实例。
     */
    private readonly logger: Logger;

    /**
     * constructor：绑定日志文件路径。
     *
     * @param centerDirectory 中心目录绝对路径。
     */
    constructor(centerDirectory: string) {
        this.logFilePath = join(centerDirectory, "logs", "center.log");
        mkdirSync(dirname(this.logFilePath), {
            recursive: true,
        });
        this.logger = pino(
            {
                base: null,
                messageKey: CENTER_LOG_MESSAGE_KEY,
                timestamp: () => {
                    return `,"occurredAt":"${formatCenterLocalDateTime()}"`;
                },
            },
            createWriteStream(this.logFilePath, {
                flags: "a",
                encoding: "utf-8",
            }),
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
        await this.write("info", event, payload);
    }

    /**
     * error：写入错误级日志。
     *
     * @param event 固定事件名，便于追踪错误来源。
     * @param payload 结构化错误载荷，不能包含敏感明文。
     * @returns 日志写入完成后没有返回值。
     */
    async error(event: string, payload: Record<string, unknown>): Promise<void> {
        await this.write("error", event, payload);
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
        // pinoLogger: 统一使用第三方日志包写 JSON 行，避免手写 JSON 和本机时间格式分叉。
        this.logger[level](
            {
                payload,
            },
            event,
        );
    }
}
