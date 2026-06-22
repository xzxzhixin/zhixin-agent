import {
  readFileSync,
} from "node:fs";

/**
 * 断言源码中包含指定片段，用于在生产代码实现前先形成红灯回归检查。
 *
 * @param {string} source 源码文本。
 * @param {string} expected 必须出现的源码片段。
 * @param {string} message 断言失败时展示的中文错误。
 * @returns {void}
 */
function assertIncludes(source, expected, message) {
  if (!source.includes(expected)) {
    throw new Error(message);
  }
}

// desktopMain：桌面壳入口源码，必须在启动中心服务时传递生命周期环境变量。
const desktopMain = readFileSync(
  "apps/desktop-shell/src/main.ts",
  "utf-8",
);

// centerIndex：中心服务 CLI 入口源码，必须安装桌面托管生命周期监护。
const centerIndex = readFileSync(
  "services/center/src/index.ts",
  "utf-8",
);

// coreRoute：中心服务核心路由，必须提供桌面壳管理者登记接口以覆盖复用遗留中心服务。
const coreRoute = readFileSync(
  "services/center/src/api/core.ts",
  "utf-8",
);

// lifecycleWatch：中心服务桌面托管生命周期监护实现，必须只在 desktop-managed 模式下启用。
const lifecycleWatch = readFileSync(
  "services/center/src/manager-lifecycle-watch.ts",
  "utf-8",
);

// logger：中心服务统一日志实现，必须在控制台管道断开时不阻断文件日志和关闭链路。
const logger = readFileSync(
  "services/center/src/logger.ts",
  "utf-8",
);

assertIncludes(
  desktopMain,
  "ZHIXIN_CENTER_LIFECYCLE_MODE",
  "桌面壳启动中心服务时必须声明生命周期模式。",
);

assertIncludes(
  desktopMain,
  "ZHIXIN_CENTER_MANAGER_PID",
  "桌面壳启动中心服务时必须传递管理者 PID。",
);

assertIncludes(
  desktopMain,
  "registerDesktopManagedLifecycle",
  "桌面壳健康检查通过后必须向中心服务登记当前管理者 PID。",
);

assertIncludes(
  desktopMain,
  "/api/center/lifecycle/desktop-manager",
  "桌面壳必须调用中心服务桌面管理者登记接口，覆盖复用遗留中心服务场景。",
);

assertIncludes(
  centerIndex,
  "installDesktopManagedLifecycleWatch",
  "中心服务 CLI 启动后必须安装桌面托管生命周期监护。",
);

assertIncludes(
  centerIndex,
  "safeWriteProcessStderr",
  "中心服务进程级诊断必须使用安全 stderr 写入，避免 EPIPE 递归异常导致高 CPU。",
);

assertIncludes(
  centerIndex,
  "isProcessPipeBrokenError",
  "中心服务进程级诊断必须识别 stderr/stdout 断管 EPIPE。",
);

const uncaughtExceptionSection = centerIndex.slice(
  centerIndex.indexOf("process.on(\"uncaughtException\""),
  centerIndex.indexOf("// unhandledRejection"),
);
const unhandledRejectionSection = centerIndex.slice(
  centerIndex.indexOf("process.on(\"unhandledRejection\""),
  centerIndex.indexOf("function writeFatalDiagnostics"),
);
if (uncaughtExceptionSection.includes("process.stderr.write") || unhandledRejectionSection.includes("process.stderr.write")) {
  throw new Error("中心服务 uncaughtException/unhandledRejection 处理器不能裸写 process.stderr，必须走 safeWriteProcessStderr。");
}

assertIncludes(
  lifecycleWatch,
  "ZHIXIN_CENTER_LIFECYCLE_MODE",
  "中心服务管理者监护必须读取生命周期模式环境变量。",
);

assertIncludes(
  lifecycleWatch,
  "desktop-managed",
  "中心服务管理者监护只允许 desktop-managed 模式启用。",
);

assertIncludes(
  lifecycleWatch,
  "ZHIXIN_CENTER_MANAGER_PID",
  "中心服务管理者监护必须读取管理者 PID。",
);

assertIncludes(
  lifecycleWatch,
  "isProcessAlive(config.managerPid)",
  "中心服务管理者监护必须基于管理者 PID 判活。",
);

assertIncludes(
  lifecycleWatch,
  "closeService",
  "中心服务管理者消失后必须调用统一关闭函数。",
);

assertIncludes(
  lifecycleWatch,
  "closeServiceAfterManagerExit",
  "中心服务管理者消失后的关闭流程必须抽为独立函数，避免日志写入失败阻断关闭。",
);

assertIncludes(
  lifecycleWatch,
  "await options.closeService()",
  "中心服务管理者消失后的独立关闭函数必须直接等待 closeService 执行。",
);

if (lifecycleWatch.includes("then(() => options.closeService())")) {
  throw new Error("中心服务关闭不能挂在 logger.info 的 then 链上，日志失败不得阻断 closeService。");
}

assertIncludes(
  lifecycleWatch,
  "await options.logger.info",
  "中心服务管理者消失日志必须在独立 try/catch 中尽力写入。",
);

assertIncludes(
  lifecycleWatch,
  "关闭服务不能依赖日志成功",
  "中心服务管理者消失日志失败分支必须说明 closeService 不依赖日志成功。",
);

assertIncludes(
  lifecycleWatch,
  "registerManager",
  "中心服务管理者监护必须支持运行期更新桌面壳管理者 PID。",
);

assertIncludes(
  lifecycleWatch,
  "registerDesktopManagedLifecycleManager",
  "中心服务必须提供复用遗留服务时的桌面管理者登记入口。",
);

assertIncludes(
  coreRoute,
  "/api/center/lifecycle/desktop-manager",
  "中心服务必须提供桌面壳管理者登记 API。",
);

assertIncludes(
  coreRoute,
  "isRequestFromLocalHost",
  "桌面壳管理者登记 API 必须限制为本机请求。",
);

assertIncludes(
  coreRoute,
  "registerDesktopManagedLifecycleManager",
  "桌面壳管理者登记 API 必须更新当前中心服务的管理者 PID。",
);

assertIncludes(
  logger,
  "EPIPE",
  "中心服务控制台日志必须识别 stdout 断管 EPIPE。",
);

assertIncludes(
  logger,
  "createSafeConsoleLogStream",
  "中心服务控制台日志必须通过安全控制台流写入，不能让断管影响文件日志和关闭链路。",
);

assertIncludes(
  logger,
  "stream: safeConsoleLogStream",
  "中心服务 pino multistream 必须把控制台输出指向断管安全包装流。",
);

if (logger.includes("stream: process.stdout")) {
  throw new Error("中心服务 pino multistream 不能直接使用 process.stdout，必须使用断管安全包装流。");
}
