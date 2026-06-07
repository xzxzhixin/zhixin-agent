/**
 * 桌面壳中心服务健康等待回归检查。
 *
 * 用途：防止 Electron 主窗口在中心服务端口监听前抢先 loadURL，导致 ERR_CONNECTION_REFUSED。
 * 关键逻辑：静态检查桌面壳主进程必须先等待 /api/health，再捕获 loadURL 失败。
 * 参数：无。
 * 返回值：检查通过退出 0；缺少任一启动竞态防护时退出 1。
 */
import {
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

// desktopMainPath: Electron 主进程源码路径，中心服务生命周期只能由桌面壳管理。
const desktopMainPath = join(
  process.cwd(),
  "apps",
  "desktop-shell",
  "src",
  "main.ts",
);

// desktopMainSource: 主进程源码文本，用于检查启动顺序。
const desktopMainSource = readFileSync(
  desktopMainPath,
  "utf-8",
);

/**
 * fail：输出中文错误并标记检查失败。
 *
 * @param message 失败说明。
 * @returns 没有返回值。
 */
function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

/**
 * assertIncludes：断言源码包含关键片段。
 *
 * @param fragment 必须存在的源码片段。
 * @param message 缺失时输出的中文错误。
 * @returns 没有返回值。
 */
function assertIncludes(
  fragment,
  message,
) {
  if (!desktopMainSource.includes(fragment)) {
    fail(message);
  }
}

/**
 * extractFunctionBody：按花括号层级提取函数体。
 *
 * @param source 源码文本。
 * @param signature 函数签名片段。
 * @returns 函数体文本。
 */
function extractFunctionBody(
  source,
  signature,
) {
  const signatureIndex = source.indexOf(signature);
  if (signatureIndex === -1) {
    fail(`缺少函数：${signature}`);
    return "";
  }

  // bodyStartIndex: 从函数签名后的第一个左花括号进入函数体。
  const bodyStartIndex = source.indexOf(
    "{",
    signatureIndex,
  );
  if (bodyStartIndex === -1) {
    fail(`函数缺少函数体：${signature}`);
    return "";
  }

  let depth = 0;
  for (let index = bodyStartIndex; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") {
      depth += 1;
    }
    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(
          bodyStartIndex + 1,
          index,
        );
      }
    }
  }

  fail(`函数花括号不完整：${signature}`);
  return "";
}

// createWindowBody: 只在窗口创建函数内部验证加载顺序，避免被其他源码片段误判通过。
const createWindowBody = extractFunctionBody(
  desktopMainSource,
  "async function createWindow(): Promise<void>",
);
// targetLoadMatches: 桌面主窗口目标 URL 只能有一条加载路径，避免新增未等待健康检查的旁路。
const targetLoadMatches = createWindowBody.match(/mainWindow\.loadURL\(targetUrl\)/gu) ?? [];

assertIncludes(
  "async function waitForCenterHealth",
  "桌面壳必须提供中心服务健康等待函数。",
);

assertIncludes(
  "/api/health",
  "桌面壳必须通过中心服务 /api/health 判断页面是否可加载。",
);

assertIncludes(
  "CENTER_HEALTH_WAIT_TIMEOUT_MS",
  "桌面壳必须为中心服务健康等待设置明确超时，不能无限等待。",
);

assertIncludes(
  "CENTER_HEALTH_RETRY_INTERVAL_MS",
  "桌面壳必须为中心服务健康等待设置轮询间隔，不能使用硬编码单次等待。",
);

if (targetLoadMatches.length !== 1) {
  fail("createWindow 中只能存在一条 mainWindow.loadURL(targetUrl) 目标页加载路径。");
}

const protectedLoadPattern = /try\s*\{[\s\S]*?await waitForCenterHealth\(\);[\s\S]*?await mainWindow\.loadURL\(targetUrl\);[\s\S]*?\}\s*catch\s*\(error\)\s*\{/u;
if (!protectedLoadPattern.test(createWindowBody)) {
  fail("mainWindow.loadURL(targetUrl) 必须和 waitForCenterHealth 位于 createWindow 的同一个 try/catch 保护块内。");
}

assertIncludes(
  "await mainWindow.loadURL(renderWindowLoadFailurePage(lastCenterError)).catch",
  "桌面壳加载诊断页也必须 catch，避免诊断页加载失败形成未处理 Promise rejection。",
);

assertIncludes(
  "window-load-failed",
  "桌面壳加载主窗口失败时必须写入诊断日志。",
);
