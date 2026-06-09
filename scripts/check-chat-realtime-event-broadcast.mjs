/**
 * 对话实时事件广播回归检查。
 *
 * 用途：防止发送接口在异步执行完成后才整轮重播事件，导致 UI 卡住后一次性显示。
 * 关键逻辑：检查发送链路必须使用实时事件仓储包装，并且异步完成广播只能补发未推送事件。
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
 * assertIncludes：断言源码包含指定实现信号。
 *
 * @param {string} source 源码内容。
 * @param {string} signal 必须存在的源码片段。
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
 * assertNotIncludes：断言源码不再包含指定旧实现信号。
 *
 * @param {string} source 源码内容。
 * @param {string} signal 不允许存在的源码片段。
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

const apiRoutes = readProjectFile("services/center/src/api/api-routes.ts");
const messageRoute = readProjectFile("services/center/src/api/session-message-route.ts");
const eventsSource = readProjectFile("services/center/src/events.ts");

for (const signal of [
  "createBroadcastingEventStore",
  "broadcastEvents(",
  "pushedSequence",
  "afterSequence: pushedSequence",
]) {
  assertIncludes(
    apiRoutes + messageRoute,
    signal,
    `对话发送链路缺少实时广播信号：${signal}`,
  );
}

for (const signal of [
  "withAppendListener",
  "onAppended",
  "this.onAppended?.(event)",
]) {
  assertIncludes(
    eventsSource,
    signal,
    `事件仓储缺少实时追加包装实现：${signal}`,
  );
}

assertNotIncludes(
  apiRoutes,
  "completeCreatedTurn(database, events, sent, body.contentMarkdown ?? \"\");\n                const completedEventRows = listEvents(database, {\n                    sessionId: session.sessionId,\n                    turnId: sent.turnId,\n                    afterSequence: 0,",
  "发送接口异步完成后不能再从 afterSequence: 0 整轮重播事件。",
);
