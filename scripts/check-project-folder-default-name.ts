/**
 * 项目文件夹默认名称回归检查。
 *
 * 用途：覆盖中心服务项目登记和插件运行时 URL 参数在缺少项目名时从项目路径派生文件夹名。
 * 关键逻辑：通过 Fastify 注入调用 /api/project/register，并静态检查运行时读取 projectPath 的派生逻辑。
 * 参数：无。
 * 返回值：全部断言通过时正常退出；任一断言失败时抛错并返回非零退出码。
 */
import {
  readFile,
  rm,
  mkdtemp,
} from "node:fs/promises";
import {
  tmpdir,
} from "node:os";
import {
  join,
} from "node:path";

import {
  CENTER_DATA_DIR_NAME,
  type ApiResponse,
  type ProjectRecord,
} from "@zhixin/shared";
import {
  type CenterService,
  createCenterService,
  readCenterServiceConfig,
} from "../services/center/src/index";

/**
 * assert：检查脚本断言工具。
 *
 * @param condition 需要成立的条件。
 * @param message 失败时抛出的中文说明。
 * @returns 没有返回值。
 */
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * main：执行项目默认名称检查。
 *
 * @returns 检查完成后没有返回值。
 */
async function main(): Promise<void> {
  // tempRoot: 隔离中心目录，避免检查污染真实 center-data。
  const tempRoot = await mkdtemp(join(tmpdir(), "zhixin-project-name-"));
  // centerDirectory: 本次检查专用中心目录。
  const centerDirectory = join(
    tempRoot,
    CENTER_DATA_DIR_NAME,
  );
  // service: 中心服务实例，finally 中统一关闭。
  let service: CenterService | null = null;

  try {
    service = await createCenterService(readCenterServiceConfig({
      cwd: tempRoot,
      env: {
        ZHIXIN_CENTER_DIR: centerDirectory,
      },
    }));
    await service.initialize();

    // projectPathForName: 使用临时目录构造项目路径，避免版本化检查脚本固化开发者本机绝对路径。
    const projectPathForName = join(
      tempRoot,
      "对话测试",
    );

    // registerFromPath: displayName 缺失时必须从 latestPath 最后一级目录派生。
    const registerFromPath = (await service.app.inject({
      method: "POST",
      url: "/api/project/register",
      payload: {
        projectId: "project-from-path",
        latestPath: projectPathForName,
      },
    })).json<ApiResponse<ProjectRecord>>();
    assert(registerFromPath.success, "displayName 缺失但 latestPath 明确时项目登记应成功");
    assert(registerFromPath.data?.displayName === "对话测试", "项目登记没有从 latestPath 最后一级目录派生 displayName");

    // registerWithoutName: displayName 和 latestPath 都无法得出名称时仍应返回登记错误。
    const registerWithoutName = (await service.app.inject({
      method: "POST",
      url: "/api/project/register",
      payload: {
        projectId: "project-without-name",
        latestPath: "",
      },
    })).json<ApiResponse<ProjectRecord>>();
    assert(!registerWithoutName.success, "displayName 和 latestPath 都无法得出名称时项目登记必须失败");
    assert(registerWithoutName.error?.code === "PROJECT_REGISTER_INVALID", "项目登记失败必须保留明确错误码");

    // runtime: 插件运行时必须在缺少 projectName 时读取 projectPath 并派生 displayName，兼容旧插件 URL。
    const runtime = await readFile(
      join(
        process.cwd(),
        "apps",
        "frontend",
        "src",
        "runtime.ts",
      ),
      "utf-8",
    );
    assert(runtime.includes("deriveProjectDisplayNameFromPath"), "前端运行时必须提供从 projectPath 派生项目名称的函数");
    assert(runtime.includes("const displayName = rawDisplayName"), "前端运行时必须允许 projectName 缺失时再派生 displayName");
  } finally {
    await service?.close().catch(() => {});
    await rm(tempRoot, {
      force: true,
      recursive: true,
    });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
