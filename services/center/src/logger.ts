import {appendFileSync, mkdirSync} from "node:fs";
import {dirname, join} from "node:path";

export class CenterLogger {
    /**
     * logFilePath: 日志文件绝对路径，来源于中心目录 logs 子目录。
     */
    private readonly logFilePath: string;

    /**
     * constructor：绑定日志文件路径。
     *
     * @param centerDirectory 中心目录绝对路径。
     */
    constructor(centerDirectory: string) {
        this.logFilePath = join(centerDirectory, "logs", "center.log");
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
        // line: 每行一个 JSON 对象，方便后续增量读取和 grep。
        const line = JSON.stringify({
            level,
            event,
            payload,
            occurredAt: new Date().toISOString(),
        });
        // mkdirSync: 日志可能在初始化早期调用，先确保父目录存在。
        mkdirSync(dirname(this.logFilePath), {
            recursive: true,
        });
        // appendFileSync: 阶段 2 日志体量小，同步追加能避免进程退出时丢日志。
        appendFileSync(this.logFilePath, `${line}\n`, "utf-8");
    }
}
