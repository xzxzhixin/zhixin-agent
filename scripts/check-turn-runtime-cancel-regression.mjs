/**
 * 当前轮次运行时取消链路静态检查。
 *
 * 用途：防止停止按钮只更新数据库终态，却没有中止 Deep Agents 后台运行。
 * 关键逻辑：扫描取消注册表、Deep Agents 入口、实时取消 API 和工具基类的关键片段。
 * 参数：无。
 * 返回值：检查通过时正常退出；任一断言失败时抛错并返回非零退出码。
 */
import {readFileSync} from "node:fs";

/**
 * readText：读取 UTF-8 文本文件。
 *
 * @param path 文件路径。
 * @returns 文件文本。
 */
function readText(path) {
  return readFileSync(path, "utf-8");
}

/**
 * assertIncludes：断言源码包含指定片段。
 *
 * @param text 待检查文本。
 * @param snippet 必须存在的片段。
 * @param message 失败说明。
 * @returns 没有返回值。
 */
function assertIncludes(text, snippet, message) {
  if (!text.includes(snippet)) {
    throw new Error(message);
  }
}

const cancelRegistry = readText("services/center/src/domain/turn-runtime-cancel-registry.ts");
const deepAgentsAgent = readText("services/center/src/deepagents-agent.ts");
const syncRoute = readText("services/center/src/api/sync-route.ts");
const toolRuntime = readText("services/center/src/tools/deepagents-tool-runtime.ts");
const structuredToolBase = readText("services/center/src/tools/CenterStructuredToolBase.ts");

assertIncludes(cancelRegistry, "AbortController", "运行时取消注册表必须使用 AbortController 管理真实中止信号");
assertIncludes(cancelRegistry, "registerRunningTurnRuntime", "运行时取消注册表缺少轮次注册入口");
assertIncludes(cancelRegistry, "abortRunningTurnRuntime", "运行时取消注册表缺少轮次中止入口");
assertIncludes(deepAgentsAgent, "signal: runtimeController.signal", "Deep Agents streamEvents 必须接收当前轮次 AbortSignal");
assertIncludes(deepAgentsAgent, "registerRunningTurnRuntime", "Deep Agents 入口必须注册当前轮次运行时");
assertIncludes(deepAgentsAgent, "unregisterRunningTurnRuntime", "Deep Agents 入口必须在 finally 清理运行时注册");
assertIncludes(deepAgentsAgent, "isTurnRuntimeAbortError", "Deep Agents 入口必须识别用户取消异常");
assertIncludes(syncRoute, "abortRunningTurnRuntime", "实时取消 API 必须触发运行时中止");
assertIncludes(toolRuntime, "runtimeSignal?: AbortSignal", "工具上下文必须携带运行时 AbortSignal");
assertIncludes(structuredToolBase, "throwIfTurnRuntimeAborted", "结构化工具基类必须在执行前后检查取消状态");
