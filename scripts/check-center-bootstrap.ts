/**
 * 阶段 2 中心服务基础设施检查。
 *
 * 用途：验证新版中心服务可以在临时中心目录中完成启动前初始化。
 * 关键逻辑：使用 Fastify inject 不监听真实端口，避免检查脚本占用用户端口。
 * 参数：无。
 * 返回值：检查通过时正常退出；任一断言失败时抛错并返回非零退出码。
 */
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  APP_NAME,
  CENTER_DATA_DIR_NAME,
  DEFAULT_CENTER_PORT,
  type ApiResponse,
} from "@zhixin/shared";

import {
  CENTER_DIRECTORY_LAYOUT,
  CORE_SQLITE_TABLES,
  createCenterService,
  readCenterServiceConfig,
} from "../services/center/src/index";
import type {
  CenterService,
} from "../services/center/src/index";

/**
 * assert：用统一错误格式表达检查失败原因。
 *
 * @param condition 需要满足的布尔条件。
 * @param message 条件不满足时抛出的中文错误。
 * @returns 条件满足时没有返回值。
 */
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * assertPathExists：验证指定路径已经由中心服务创建。
 *
 * @param filePath 需要检查的文件或目录绝对路径。
 * @param message 路径不存在时抛出的中文错误。
 * @returns 路径存在时没有返回值。
 */
async function assertPathExists(filePath: string, message: string): Promise<void> {
  await stat(filePath).catch(() => {
    throw new Error(message);
  });
}

/**
 * main：执行阶段 2 基础设施检查。
 *
 * @returns 检查完成时没有返回值。
 */
async function main(): Promise<void> {
  // tempRoot: 本次检查的临时根目录，避免污染项目真实 center-data。
  const tempRoot = await mkdtemp(join(tmpdir(), "zhixin-center-bootstrap-"));

  // centerDirectory: 临时中心目录名称仍使用架构约定的 center-data，验证默认目录名没有漂移。
  const centerDirectory = join(tempRoot, CENTER_DATA_DIR_NAME);
  // service: 放在 try 外部，确保任意断言失败时 finally 仍能先关闭 SQLite 连接再清理目录。
  let service: CenterService | null = null;

  try {
  // config: 检查环境显式传入端口和中心目录，避免读取用户本机配置。
  const config = readCenterServiceConfig({
    env: {
      ZHIXIN_CENTER_PORT: String(DEFAULT_CENTER_PORT),
      ZHIXIN_CENTER_DIR: centerDirectory,
    },
    cwd: tempRoot,
  });

  assert(config.port === DEFAULT_CENTER_PORT, "中心服务默认端口解析错误");
  assert(config.centerDirectory === centerDirectory, "中心服务中心目录解析错误");

  // service: 使用模块化工厂创建中心服务，便于桌面壳后续复用。
  service = await createCenterService(config);

  await service.initialize();

  // directories: 阶段 2 要求的中心目录子目录必须全部存在。
  for (const directory of CENTER_DIRECTORY_LAYOUT) {
    await assertPathExists(
      join(centerDirectory, directory.relativePath),
      `中心目录缺少子目录：${directory.relativePath}`,
    );
  }

  await assertPathExists(
    join(centerDirectory, "db", "zhixin.sqlite"),
    "中心服务未创建 SQLite 数据库文件",
  );

  for (const tableName of CORE_SQLITE_TABLES) {
    assert(
      service.database.hasTable(tableName),
      `SQLite 缺少核心表：${tableName}`,
    );
  }

  const migrationRows = service.database.listAppliedMigrations();
  assert(migrationRows.length >= 1, "SQLite 迁移记录表未保存迁移记录");

  const firstSequence = service.events.nextSequenceForTurn("turn-check");
  const secondSequence = service.events.nextSequenceForTurn("turn-check");
  assert(firstSequence === 1, "事件序号首次递增不是 1");
  assert(secondSequence === 2, "事件序号第二次递增不是 2");

  await service.startupLock.acquire();

  let duplicatedLockRejected = false;
  try {
    await service.startupLock.acquire();
  } catch {
    duplicatedLockRejected = true;
  }

  assert(duplicatedLockRejected, "中心服务启动锁没有阻止同目录重复启动");
  await service.startupLock.release();

  const healthResponse = await service.app.inject({
    method: "GET",
    url: "/api/health",
  });
  assert(healthResponse.statusCode === 200, "健康检查 HTTP 状态不是 200");

  const health = healthResponse.json<ApiResponse<{
    appName: string;
    port: number;
    centerDirectory: string;
  }>>();
  assert(health.success, "健康检查没有使用成功响应包");
  assert(health.data?.appName === APP_NAME, "健康检查返回应用名错误");
  assert(health.data?.port === DEFAULT_CENTER_PORT, "健康检查返回端口错误");
  assert(health.data?.centerDirectory === centerDirectory, "健康检查返回中心目录错误");

  const stateResponse = await service.app.inject({
    method: "GET",
    url: "/api/bootstrap/state",
  });
  const state = stateResponse.json<ApiResponse<{
    ready: boolean;
    coreTables: string[];
  }>>();
  assert(state.success, "启动状态接口没有使用成功响应包");
  assert(state.data?.ready === true, "启动状态接口未返回 ready=true");
  assert(
    state.data?.coreTables.length === CORE_SQLITE_TABLES.length,
    "启动状态接口返回核心表数量错误",
  );

  const methodResponse = await service.app.inject({
    method: "PUT",
    url: "/api/health",
  });
  const methodError = methodResponse.json<ApiResponse<null>>();
  assert(methodResponse.statusCode === 405, "非 GET/POST 方法没有被拒绝");
  assert(methodError.error?.code === "METHOD_NOT_ALLOWED", "非 GET/POST 方法错误码不正确");

  const missingResponse = await service.app.inject({
    method: "POST",
    url: "/api/not-found",
    payload: {},
  });
  const missing = missingResponse.json<ApiResponse<null>>();
  assert(missingResponse.statusCode === 200, "业务未知接口不应通过 HTTP 404 表达");
  assert(missing.error?.code === "API_NOT_FOUND", "未知接口错误码不正确");

  const logContent = await readFile(
    join(centerDirectory, "logs", "center.log"),
    "utf-8",
  );
  assert(logContent.includes("center.bootstrap.initialized"), "中心服务日志未写入初始化事件");

  } finally {
    await service?.close();
    // cleanup: 检查结束后删除临时中心目录，避免留下测试数据。
    await removeTemporaryDirectoryWithRetry(tempRoot);
  }
}

/**
 * removeTemporaryDirectoryWithRetry：带重试删除临时中心目录。
 *
 * @param directory 临时目录绝对路径。
 * @returns 删除完成后没有返回值。
 */
async function removeTemporaryDirectoryWithRetry(directory: string): Promise<void> {
  const maxAttempts = 8;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await rm(directory, {
        force: true,
        recursive: true,
      });
      return;
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? String((error as {code?: unknown}).code)
        : "";
      if (code !== "EBUSY" || attempt === maxAttempts) {
        throw error;
      }
      // Windows 上 better-sqlite3 close 后 SQLite 文件句柄可能短暂滞留，检查脚本等待后重试清理临时目录。
      await new Promise((resolve) => {
        setTimeout(
          resolve,
          attempt * 150,
        );
      });
    }
  }
}

void main().catch((error) => {
  // catch: 检查失败时输出原始错误，便于定位阶段 2 缺失能力。
  console.error(error);
  // exitCode: 交给 pnpm 返回非零状态，作为质量门槛。
  process.exitCode = 1;
});
