/**
 * 命令工具流式输出回归检查。
 *
 * 用途：确保命令工具不再使用同步阻塞执行，输出必须在 stdout/stderr data 事件中追加。
 * 关键逻辑：检查 spawn、stdout/stderr data 监听、Promise 结束等待和异步对话执行链路。
 * 参数：无。
 * 返回值：检查通过时退出码为 0；发现缺口时退出码为 1。
 */
import {
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

/**
 * readProjectFile：读取仓库相对路径文件。
 *
 * @param {string} pathInProject 仓库相对路径。
 * @returns {string} 文件内容。
 */
function readProjectFile(pathInProject) {
  return readFileSync(
    join(
      process.cwd(),
      pathInProject,
    ),
    "utf-8",
  );
}

/**
 * assertIncludes：检查源码必须包含指定信号。
 *
 * @param {string} source 源码内容。
 * @param {string} signal 必须存在的片段。
 * @param {string} message 失败说明。
 * @returns {void}
 */
function assertIncludes(
  source,
  signal,
  message,
) {
  if (!source.includes(signal)) {
    console.error(message);
    process.exitCode = 1;
  }
}

/**
 * assertNotIncludes：检查源码不能包含旧阻塞实现。
 *
 * @param {string} source 源码内容。
 * @param {string} signal 不允许存在的片段。
 * @param {string} message 失败说明。
 * @returns {void}
 */
function assertNotIncludes(
  source,
  signal,
  message,
) {
  if (source.includes(signal)) {
    console.error(message);
    process.exitCode = 1;
  }
}

const toolRuntime = readProjectFile("services/center/src/tool-runtime.ts");
const sessionDomain = readProjectFile("services/center/src/session-domain.ts");
const sessionTurnEffects = readProjectFile("services/center/src/session-turn-effects.ts");
const messageRoute = readProjectFile("services/center/src/session-message-route.ts");

assertNotIncludes(
  toolRuntime,
  "spawnSync",
  "命令工具不能继续使用 spawnSync 阻塞到一次性输出。",
);

for (const signal of [
  "spawn(",
  ".stdout?.on(\"data\"",
  ".stderr?.on(\"data\"",
  "tool.command.output",
  "new Promise<CommandToolResult>",
  "shellCommand",
  "resolveBashCompatShellCommand",
  "normalizeCommandArgs",
  "resolveWindowsWhichCommand",
  "powershell.exe",
]) {
  assertIncludes(
    toolRuntime,
    signal,
    `命令工具缺少流式输出实现信号：${signal}`,
  );
}

for (const signal of [
  "export async function completeCreatedTurn",
]) {
  assertIncludes(
    sessionDomain,
    signal,
    `对话执行链路缺少异步命令工具信号：${signal}`,
  );
}

for (const signal of [
  "executeModelRequestedTools",
  "await runCommandTool",
]) {
  assertIncludes(
    sessionTurnEffects,
    signal,
    `对话执行链路缺少异步命令工具信号：${signal}`,
  );
}

assertIncludes(
  messageRoute,
  "await completeCreatedTurn",
  "发送路由必须等待异步对话执行链路完成。",
);
