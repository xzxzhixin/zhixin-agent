/**
 * 中心服务启动锁回归检查。
 *
 * 用途：验证 `.zhixin-center.lock` 能清理陈旧 pid，同时阻止仍存活 pid 重复启动。
 * 关键逻辑：直接实例化 CenterStartupLock，使用临时中心目录，不启动 HTTP 服务。
 * 参数：无。
 * 返回值：检查通过时退出码为 0；任一锁边界失败时抛错并返回非零状态。
 */
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  tmpdir,
} from "node:os";
import {
  join,
} from "node:path";

import {
  CenterStartupLock,
} from "../services/center/src/index";

/**
 * assert：断言条件成立。
 *
 * @param condition 布尔条件。
 * @param message 失败说明。
 * @returns 条件成立时没有返回值。
 */
function assert(
  condition: boolean,
  message: string,
): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * readLockPid：读取当前锁文件中的 pid。
 *
 * @param centerDirectory 临时中心目录。
 * @returns 锁文件中的 pid。
 */
async function readLockPid(centerDirectory: string): Promise<number> {
  const content = await readFile(
    join(
      centerDirectory,
      ".zhixin-center.lock",
    ),
    "utf-8",
  );
  const parsed = JSON.parse(content) as {
    pid?: unknown;
  };

  assert(
    typeof parsed.pid === "number",
    "锁文件必须写入数字 pid。",
  );

  return parsed.pid;
}

/**
 * expectAcquireError：断言获取锁会失败。
 *
 * @param lock 启动锁实例。
 * @param expectedMessage 期望错误消息片段。
 * @returns 没有返回值。
 */
async function expectAcquireError(
  lock: CenterStartupLock,
  expectedMessage: string,
): Promise<void> {
  try {
    await lock.acquire();
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : String(error);
    assert(
      message.includes(expectedMessage),
      `启动锁错误消息不符合预期：${message}`,
    );
    return;
  }

  throw new Error("持有锁进程仍存活时不应允许重复获取启动锁。");
}

/**
 * main：执行启动锁边界检查。
 *
 * @returns 检查完成后没有返回值。
 */
async function main(): Promise<void> {
  const centerDirectory = await mkdtemp(
    join(
      tmpdir(),
      "zhixin-center-lock-",
    ),
  );

  try {
    const staleLock = new CenterStartupLock(centerDirectory);
    await writeFile(
      join(
        centerDirectory,
        ".zhixin-center.lock",
      ),
      JSON.stringify(
        {
          pid: 99999999,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf-8",
    );
    await staleLock.acquire();
    assert(
      await readLockPid(centerDirectory) === process.pid,
      "陈旧 pid 锁应被清理并改写为当前进程 pid。",
    );
    await staleLock.release();

    const invalidLock = new CenterStartupLock(centerDirectory);
    await writeFile(
      join(
        centerDirectory,
        ".zhixin-center.lock",
      ),
      JSON.stringify(
        {
          pid: "bad-pid",
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf-8",
    );
    await invalidLock.acquire();
    assert(
      await readLockPid(centerDirectory) === process.pid,
      "无效 pid 锁应被清理并改写为当前进程 pid。",
    );

    const liveLock = new CenterStartupLock(centerDirectory);
    await expectAcquireError(
      liveLock,
      "中心目录已有启动锁",
    );

    await invalidLock.release();
    console.log("中心服务启动锁陈旧 pid、无效 pid 和存活 pid 检查通过。");
  } finally {
    await rm(
      centerDirectory,
      {
        recursive: true,
        force: true,
      },
    );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
