import { appendFile, copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { FileRepositoryMode } from "@zhixin/shared";

// JsonRecord：中心服务 JSON 仓储允许读写的结构化数据。
export type JsonRecord = Record<string, unknown> | unknown[];

// FileRepository：统一封装 JSON、Markdown 追加、只读扫描和迁移写入能力。
export class FileRepository {
  // readJson：读取 JSON 配置文件，缺失或解析失败时返回调用方指定默认值。
  async readJson<T>(filePath: string, fallback: T): Promise<T> {
    // readFile：所有固化文本都按 UTF-8 读取，避免中文内容乱码。
    try {
      const content = await readFile(filePath, "utf-8");
      // JSON.parse：中心服务内部统一解析，再把结构化结果返回给 API。
      return JSON.parse(content) as T;
    } catch {
      // fallback：配置缺失不阻断服务启动，初始化逻辑会补齐文件。
      return fallback;
    }
  }

  // writeJson：以配置写模式保存 JSON 文件。
  async writeJson(filePath: string, value: JsonRecord): Promise<void> {
    // writeText：配置文件允许覆盖写，适用于 providers.json、runtimes.json 等文件。
    await this.writeText(filePath, `${JSON.stringify(value, null, 2)}\n`, "config-write");
  }

  // appendMarkdown：以追加写模式写入 Markdown 内容。
  async appendMarkdown(filePath: string, content: string): Promise<void> {
    // mkdir：追加前保证父目录存在，永久记忆按年月日分层时会自动创建目录。
    await mkdir(dirname(filePath), { recursive: true });
    // appendFile：记忆和日志只能追加，避免覆盖历史内容。
    await appendFile(filePath, content, "utf-8");
  }

  // readText：只读扫描模式读取文件。
  async readText(filePath: string): Promise<string> {
    // readFile：只读扫描不修改文件，用于能力扫描和迁移预检。
    return readFile(filePath, "utf-8");
  }

  // listDirectory：只读扫描目录内容。
  async listDirectory(directoryPath: string): Promise<string[]> {
    // readdir：目录不存在时返回空列表，便于扫描项目级能力目录。
    try {
      return await readdir(directoryPath);
    } catch {
      return [];
    }
  }

  // copyFile：迁移或附件保存时复制文件，保留源文件用于用户原始位置管理。
  async copyFile(sourcePath: string, targetPath: string): Promise<void> {
    // mkdir：复制前确保目标父目录存在。
    await mkdir(dirname(targetPath), { recursive: true });
    // copyFile：用于中心目录迁移和附件受控访问，不删除原始文件。
    await copyFile(sourcePath, targetPath);
  }

  // removeFile：删除中心服务自己创建的锁文件或临时文件。
  async removeFile(filePath: string): Promise<void> {
    // rm：missing 文件不作为错误，避免进程退出时锁文件已被清理导致异常。
    await rm(filePath, {
      force: true,
    });
  }

  // migrateFile：迁移模式移动文件。
  async migrateFile(sourcePath: string, targetPath: string): Promise<void> {
    // mkdir：迁移前创建目标父目录。
    await mkdir(dirname(targetPath), { recursive: true });
    // rename：同一磁盘迁移优先使用原子移动，避免中间态文件损坏。
    await rename(sourcePath, targetPath);
  }

  // writeText：按仓储模式写入文本。
  async writeText(filePath: string, content: string, mode: FileRepositoryMode): Promise<void> {
    // append-only：追加模式必须走 appendMarkdown，避免误覆盖记忆或日志。
    if (mode === "append-only") {
      await this.appendMarkdown(filePath, content);
      return;
    }
    // readonly-scan：只读模式禁止写入，防止扫描能力时修改项目文件。
    if (mode === "readonly-scan") {
      throw new Error("只读扫描模式不允许写入文件");
    }
    // mkdir：配置写和迁移写都需要确保父目录存在。
    await mkdir(dirname(filePath), { recursive: true });
    // writeFile：配置文件允许整体覆盖，保持 JSON 内容结构清晰。
    await writeFile(filePath, content, "utf-8");
  }
}
