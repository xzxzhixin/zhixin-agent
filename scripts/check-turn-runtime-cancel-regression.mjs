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

/**
 * assertNotIncludes：断言源码不能包含指定片段。
 *
 * @param text 待检查文本。
 * @param snippet 禁止存在的片段。
 * @param message 失败说明。
 * @returns 没有返回值。
 */
function assertNotIncludes(text, snippet, message) {
  if (text.includes(snippet)) {
    throw new Error(message);
  }
}

const cancelRegistry = readText("services/center/src/domain/turn-runtime-cancel-registry.ts");
const deepAgentsAgent = readText("services/center/src/deepagents-agent.ts");
const syncRoute = readText("services/center/src/api/sync-route.ts");
const toolRuntime = readText("services/center/src/StructuredTool/deepagents-tool-runtime.ts");
const structuredToolBase = readText("services/center/src/StructuredTool/CenterStructuredToolBase.ts");
const commandTool = readText("services/center/src/StructuredTool/command-tool-executor.ts");
const commandCancelRegistry = readText("services/center/src/domain/turn-command-cancel-registry.ts");

assertIncludes(cancelRegistry, "AbortController", "运行时取消注册表必须使用 AbortController 管理真实中止信号");
assertIncludes(cancelRegistry, "registerRunningTurnRuntime", "运行时取消注册表缺少轮次注册入口");
assertIncludes(cancelRegistry, "abortRunningTurnRuntime", "运行时取消注册表缺少轮次中止入口");
assertIncludes(cancelRegistry, "createExternalAbortReason", "运行时取消注册表必须把中心服务取消异常转换成第三方安全取消原因");
assertNotIncludes(cancelRegistry, "abort(new TurnRuntimeAbortError(reason))", "运行时取消不能把中心服务自定义 Error 直接传给 Deep Agents/LangGraph");
assertNotIncludes(cancelRegistry, "error.name === \"AbortError\"", "普通 AbortError 不能直接等同于用户取消，避免吞掉真实失败收尾");
assertNotIncludes(deepAgentsAgent, "signal: runtimeController.signal", "Deep Agents streamEvents 不能直接接收中心服务 AbortSignal，避免第三方 abort 监听器同步异常导致中心服务退出");
assertIncludes(deepAgentsAgent, "registerRunningTurnRuntime", "Deep Agents 入口必须注册当前轮次运行时");
assertIncludes(deepAgentsAgent, "unregisterRunningTurnRuntime", "Deep Agents 入口必须在 finally 清理运行时注册");
assertIncludes(deepAgentsAgent, "isTurnRuntimeAbortError", "Deep Agents 入口必须识别用户取消异常");
assertIncludes(deepAgentsAgent, "await consumeDeepAgentCancellation", "Deep Agents 取消后必须消费残留异步投影，避免未处理拒绝导致中心服务退出");
assertIncludes(deepAgentsAgent, "resolveToolCallValueWhenActive", "Deep Agents 工具计划生命周期必须取消感知，不能把用户停止误记为工具失败");
assertIncludes(deepAgentsAgent, "attachToolCallCancellationGuards", "Deep Agents 工具计划必须预先挂载取消消费，避免内部字段 Promise 形成未处理拒绝");
assertIncludes(deepAgentsAgent, "consumeToolCallValueWhenCancelled", "Deep Agents 工具计划字段 Promise 必须在取消期被消费");
assertIncludes(deepAgentsAgent, "currentTurn.status === \"cancelled\"", "Deep Agents 失败收尾前必须回查取消终态，不能把用户取消追加为失败事件");
assertIncludes(syncRoute, "abortRunningTurnRuntime", "实时取消 API 必须触发运行时中止");
assertIncludes(syncRoute, "cancelRunningCommandsForTurn", "实时取消 API 必须直接取消当前轮次命令，不能依赖 AbortSignal 事件监听");
assertIncludes(toolRuntime, "runtimeSignal?: AbortSignal", "工具上下文必须携带运行时 AbortSignal");
assertIncludes(structuredToolBase, "throwIfTurnRuntimeAborted", "结构化工具基类必须在执行前后检查取消状态");
assertIncludes(commandTool, "runtimeSignal?: AbortSignal", "命令工具请求必须携带当前轮次取消信号");
assertNotIncludes(commandTool, "addEventListener(\n            \"abort\"", "命令工具不能通过 AbortSignal 事件监听取消子进程，避免监听器异常逃逸导致中心服务退出");
assertIncludes(commandTool, "registerRunningCommandForTurn", "命令工具必须把子进程取消入口注册到中心服务自有注册表");
assertIncludes(commandTool, "child.kill()", "命令工具必须在用户停止时终止正在运行的子进程");
assertIncludes(commandTool, "tool.command.cancelled", "命令工具取消必须写入取消事件，不能误记成普通工具失败");
assertIncludes(commandCancelRegistry, "cancelRunningCommandsForTurn", "命令取消注册表必须提供按轮次取消入口");
assertIncludes(commandCancelRegistry, "try {", "命令取消注册表必须隔离单个命令取消异常");

console.log("当前轮次运行时取消链路静态检查通过。");
