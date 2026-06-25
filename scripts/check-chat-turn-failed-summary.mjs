import fs from "node:fs";

const helperPath = "apps/frontend/src/views/Chat/chat-view-helpers.ts";

/**
 * read：读取前端对话渲染辅助源码。
 *
 * @param {string} path 源码路径。
 * @returns {string} 源码文本。
 */
function read(path) {
  if (!fs.existsSync(path)) {
    throw new Error(`缺少文件：${path}`);
  }
  return fs.readFileSync(path, "utf8");
}

const helper = read(helperPath);
const summaryFunctionMatch = helper.match(/function resolveProcessSummary[\s\S]*?\n}/);

if (!helper.includes("message.turn.failed")) {
  throw new Error("对话过程卡片必须识别 message.turn.failed 事件。");
}

if (!summaryFunctionMatch) {
  throw new Error("缺少 resolveProcessSummary 过程卡片摘要函数。");
}

if (!summaryFunctionMatch[0].includes("event.summary")) {
  throw new Error("失败过程卡片必须读取事件顶层 summary，避免错误正文显示为空。");
}
