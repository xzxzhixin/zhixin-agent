import { join } from "node:path";
import { FileRepository } from "./repository.js";

// LogLevel：中心服务日志级别。
export type LogLevel = "info" | "warn" | "error";

// CenterLogger：把中心服务运行日志追加写入中心目录“日志”子目录。
export class CenterLogger {
  // logDirectory：日志目录绝对路径。
  private readonly logDirectory: string;
  // repository：日志写入复用追加写仓储能力。
  private readonly repository: FileRepository;

  // constructor：注入日志目录和仓储能力。
  constructor(logDirectory: string, repository: FileRepository) {
    // logDirectory：来自中心目录映射，目录名固定为“日志”。
    this.logDirectory = logDirectory;
    // repository：集中处理 UTF-8 与追加写。
    this.repository = repository;
  }

  // info：记录普通运行事件。
  async info(message: string, detail: Record<string, unknown> = {}): Promise<void> {
    // write：info 用于启动、客户端连接、普通任务事件。
    await this.write("info", message, detail);
  }

  // warn：记录可恢复异常事件。
  async warn(message: string, detail: Record<string, unknown> = {}): Promise<void> {
    // write：warn 用于配置缺失、刷新失败等不阻断服务的情况。
    await this.write("warn", message, detail);
  }

  // error：记录错误事件。
  async error(message: string, detail: Record<string, unknown> = {}): Promise<void> {
    // write：error 用于接口异常、任务失败和扩展能力异常。
    await this.write("error", message, detail);
  }

  // write：追加一条 Markdown 日志。
  private async write(level: LogLevel, message: string, detail: Record<string, unknown>): Promise<void> {
    // now：日志文件按天切分，日志内容也写入完整时间。
    const now = new Date();
    // dateKey：日志文件名使用日期，方便按天排查。
    const dateKey = now.toISOString().slice(0, 10);
    // filePath：中心目录“日志/YYYY-MM-DD.md”。
    const filePath = join(this.logDirectory, `${dateKey}.md`);
    // content：Markdown 便于用户直接打开阅读。
    const content = [
      `## ${now.toISOString()} ${level}`,
      "",
      message,
      "",
      "```json",
      JSON.stringify(detail, null, 2),
      "```",
      "",
    ].join("\n");
    // appendMarkdown：日志只追加，不覆盖历史。
    await this.repository.appendMarkdown(filePath, content);
  }
}
