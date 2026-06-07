/**
 * 对话图编排和检查点回归检查。
 *
 * 用途：防止复杂任务编排只停留在 UI 文案，要求中心服务事件携带可恢复 graph/checkpoint 元数据。
 * 关键逻辑：静态检查 graph 元数据 helper、任务步骤事件、模型/工具关键事件和历史事件恢复路径。
 */
import {
  existsSync,
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
 * assertIncludes：检查源码包含指定片段。
 *
 * @param {string} source 源码文本。
 * @param {string} fragment 必须存在的源码片段。
 * @param {string} message 缺失时抛出的中文错误。
 * @returns {void}
 */
function assertIncludes(
  source,
  fragment,
  message,
) {
  if (!source.includes(fragment)) {
    throw new Error(message);
  }
}

const graphDomainPath = join(
  process.cwd(),
  "services",
  "center",
  "src",
  "turn-graph-domain.ts",
);

if (!existsSync(graphDomainPath)) {
  throw new Error("中心服务缺少 turn-graph-domain.ts，无法沉淀每个对话框的图编排检查点。");
}

const graphDomain = readProjectFile("services/center/src/turn-graph-domain.ts");
const sessionDomain = readProjectFile("services/center/src/session-domain.ts");
const workflowDomain = readProjectFile("services/center/src/workflow-domain.ts");
const toolRuntime = readProjectFile("services/center/src/tool-runtime.ts");
const modelGatewayRuntime = readProjectFile("services/center/src/model-gateway-runtime.ts");
const sharedTypes = readProjectFile("packages/shared/src/index.ts");
const chatHelpers = readProjectFile("apps/frontend/src/views/Chat/chat-view-helpers.ts");

for (const signal of [
  "export interface TurnGraphCheckpoint",
  "graphRunId",
  "threadId",
  "nodeId",
  "nodeKind",
  "superstep",
  "checkpointId",
  "parentCheckpointId",
  "attempt",
  "idempotencyKey",
  "resumable",
  "nextNodeIds",
  "stateSummary",
  "createTurnGraphContext",
  "createTurnGraphCheckpoint",
  "withTurnGraphCheckpoint",
]) {
  assertIncludes(
    graphDomain,
    signal,
    `图编排检查点 helper 缺少字段或函数：${signal}`,
  );
}

for (const signal of [
  "TurnGraphCheckpoint",
  "payload.graph",
  "用于恢复对话内复杂任务编排",
]) {
  assertIncludes(
    sharedTypes,
    signal,
    `共享事件协议缺少 graph checkpoint 说明：${signal}`,
  );
}

for (const signal of [
  "createTurnGraphContext",
  "withTurnGraphCheckpoint",
  "nodeId: \"thinking.context\"",
  "nodeId: \"model.stream\"",
  "nodeId: \"tool.plan\"",
  "nodeId: \"extension.visibility\"",
  "nodeId: \"message.persist\"",
  "nodeId: \"tool.command\"",
  "task.step.started",
  "task.step.updated",
]) {
  assertIncludes(
    sessionDomain,
    signal,
    `会话执行链路缺少 graph/checkpoint 接入：${signal}`,
  );
}

for (const signal of [
  "payload: withTurnGraphCheckpoint",
  "model.tool.requested",
]) {
  assertIncludes(
    sessionDomain,
    signal,
    `模型工具闭环关键事件缺少 graph/checkpoint：${signal}`,
  );
}

for (const signal of [
  "model.tool.result.appended",
  "graphCheckpoint",
  "withOptionalGraphCheckpoint",
]) {
  assertIncludes(
    modelGatewayRuntime,
    signal,
    `模型工具结果回填缺少 graph/checkpoint：${signal}`,
  );
}

for (const signal of [
  "graphCheckpoint",
  "withOptionalGraphCheckpoint",
  "thinking.completed",
  "model.stream.completed",
]) {
  assertIncludes(
    workflowDomain,
    signal,
    `工作流事件缺少 graph/checkpoint 透传：${signal}`,
  );
}

for (const signal of [
  "graphCheckpoint",
  "withOptionalGraphCheckpoint",
  "tool.command.started",
  "tool.command.completed",
]) {
  assertIncludes(
    toolRuntime,
    signal,
    `命令工具事件缺少 graph/checkpoint 透传：${signal}`,
  );
}

for (const signal of [
  "readEventGraphCheckpoint",
  "graphCheckpoint",
]) {
  assertIncludes(
    chatHelpers,
    signal,
    `前端历史过程恢复缺少 graph/checkpoint 读取：${signal}`,
  );
}

console.log("对话图编排和检查点回归检查通过。");
