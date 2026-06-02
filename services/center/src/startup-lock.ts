import {mkdirSync} from "node:fs";
import {open, readFile, rm, stat} from "node:fs/promises";
import {dirname, join} from "node:path";

export class CenterStartupLock {
    /**
     * lockFilePath: 锁文件绝对路径。
     */
    private readonly lockFilePath: string;

    /**
     * constructor：绑定中心目录锁文件。
     *
     * @param centerDirectory 中心目录绝对路径。
     */
    constructor(centerDirectory: string) {
        this.lockFilePath = join(centerDirectory, ".zhixin-center.lock");
    }

    /**
     * acquire：创建独占启动锁。
     *
     * @returns 获取成功后没有返回值。
     */
    async acquire(): Promise<void> {
        // mkdirSync: 锁文件位于中心目录根部，创建前确保目录存在。
        mkdirSync(dirname(this.lockFilePath), {
            recursive: true,
        });

        try {
            // handle: wx 保证文件已存在时失败，避免并发覆盖锁。
            await this.writeLockFile();
        } catch {
            if (await this.isStaleLock()) {
                // 陈旧锁边界：只有 JSON 损坏、pid 无效或 pid 已确认退出时才清理；pid 仍存活时必须继续阻止启动，避免两个中心服务同时写同一中心目录。
                await rm(this.lockFilePath, {
                    force: true,
                });
                try {
                    await this.writeLockFile();
                } catch {
                    throw new Error(`中心目录启动锁刚被其他进程获取：${this.lockFilePath}`);
                }
                return;
            }

            throw new Error(`中心目录已有启动锁：${this.lockFilePath}`);
        }
    }

    /**
     * release：释放当前启动锁。
     *
     * @returns 释放完成后没有返回值。
     */
    async release(): Promise<void> {
        await rm(this.lockFilePath, {
            force: true,
        });
    }

    /**
     * isStaleLock：判断启动锁是否可以清理。
     *
     * @returns 锁文件不存在、格式损坏或记录进程已退出时返回 true。
     */
    private async isStaleLock(): Promise<boolean> {
        // lockStat: 锁文件不存在时可以直接重建，存在时继续读取 pid 判活。
        const lockStat = await stat(this.lockFilePath).catch(() => null);
        if (lockStat === null) {
            return true;
        }

        const lockContent = await readFile(this.lockFilePath, "utf-8").catch(() => "");
        const lockInfo = parseStartupLockFile(lockContent);
        if (!lockInfo) {
            return true;
        }

        // pid 判活是清理陈旧锁的唯一运行时依据；仅靠 createdAt 过期会误伤仍在迁移或慢启动的真实中心服务。
        return !isProcessAlive(lockInfo.pid);
    }

    /**
     * writeLockFile：写入当前进程启动锁。
     *
     * @returns 写入完成后没有返回值。
     */
    private async writeLockFile(): Promise<void> {
        const handle = await open(this.lockFilePath, "wx");
        try {
            await handle.writeFile(JSON.stringify({
                pid: process.pid,
                createdAt: new Date().toISOString(),
            }, null, 2));
        } finally {
            await handle.close();
        }
    }
}

/**
 * StartupLockFile：启动锁文件结构。
 *
 * 来源：中心目录 `.zhixin-center.lock`。
 * 含义：保存持锁进程 ID 和创建时间，供异常退出后判定是否陈旧。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：pid 必须为正整数，createdAt 必须可被 Date 解析。
 */
interface StartupLockFile {
    /**
     * pid: 持有锁的进程 ID。
     */
    pid: number;

    /**
     * createdAt: 锁创建时间，ISO 8601 字符串。
     */
    createdAt: string;
}

/**
 * parseStartupLockFile：解析启动锁文件。
 *
 * @param content 锁文件文本。
 * @returns 格式有效时返回锁信息，否则返回 null。
 */
function parseStartupLockFile(content: string): StartupLockFile | null {
    try {
        const parsed = JSON.parse(content) as Partial<StartupLockFile>;
        if (
            typeof parsed.pid !== "number"
            || !Number.isInteger(parsed.pid)
            || parsed.pid <= 0
            || typeof parsed.createdAt !== "string"
            || Number.isNaN(Date.parse(parsed.createdAt))
        ) {
            return null;
        }

        return {
            pid: parsed.pid,
            createdAt: parsed.createdAt,
        };
    } catch {
        return null;
    }
}

/**
 * isProcessAlive：跨平台判断进程是否仍存活。
 *
 * @param pid 进程 ID。
 * @returns 进程存在时返回 true。
 */
function isProcessAlive(pid: number): boolean {
    if (pid === process.pid) {
        return true;
    }

    try {
        // process.kill(pid, 0) 不发送信号，只做存在性和权限检查；Windows 和类 Unix 均支持。
        process.kill(pid, 0);
        return true;
    } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error
            ? String((error as {code?: unknown}).code)
            : "";
        return code === "EPERM";
    }
}
