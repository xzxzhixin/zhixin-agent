/**
 * 对话思考卡片回归检查。
 *
 * 用途：防止思考卡片退回“思考中/思考过程”静态标题，或用固定占位文本冒充真实思考。
 * 关键逻辑：检查前端根据真实思考事件计算“正在思考 / 已思考（用时 X 秒）”、默认展开/折叠和正文来源。
 */
import {
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

/**
 * assertIncludes：检查源码包含指定片段。
 *
 * @param source 源码文本。
 * @param fragment 必须存在的源码片段。
 * @param message 缺失时抛出的中文错误。
 * @returns 检查通过时没有返回值。
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

/**
 * assertNotIncludes：检查源码不包含指定片段。
 *
 * @param source 源码文本。
 * @param fragment 不允许存在的源码片段。
 * @param message 命中时抛出的中文错误。
 * @returns 检查通过时没有返回值。
 */
function assertNotIncludes(
  source,
  fragment,
  message,
) {
  if (source.includes(fragment)) {
    throw new Error(message);
  }
}

// helpers: 对话渲染聚合逻辑，必须在这里计算卡片标题、耗时和默认展开状态。
const helpers = readFileSync(
  join(
    process.cwd(),
    "apps",
    "frontend",
    "src",
    "views",
    "Chat",
    "chat-view-helpers.ts",
  ),
  "utf-8",
);
// panel: 对话面板模板，必须直接展示聚合后的思考标题。
const panel = readFileSync(
  join(
    process.cwd(),
    "apps",
    "frontend",
    "src",
    "views",
    "Chat",
    "components",
    "ChatConversationPanel.vue",
  ),
  "utf-8",
);
// workflowDomain: 中心服务思考事件来源，不能写入固定上下文摘要正文。
const workflowDomain = readFileSync(
  join(
    process.cwd(),
    "services",
    "center",
    "src",
    "domain",
    "workflow-domain.ts",
  ),
  "utf-8",
);

assertIncludes(
  helpers,
  "formatThinkingDuration",
  "思考卡片缺少独立耗时格式化函数。",
);
assertIncludes(
  helpers,
  "\"正在思考\"",
  "运行中思考卡片标题必须显示“正在思考”。",
);
assertIncludes(
  helpers,
  "已思考（用时 ${durationText}）",
  "完成思考卡片标题必须显示“已思考（用时 X 秒）”。",
);
assertIncludes(
  helpers,
  "startedAt",
  "思考卡片需要记录首个思考事件时间用于计算耗时。",
);
assertIncludes(
  helpers,
  "endedAt",
  "思考卡片需要记录完成事件时间用于计算耗时。",
);
assertIncludes(
  helpers,
  "defaultOpen: isRunning",
  "思考卡片必须运行中默认展开、完成后默认折叠。",
);
assertIncludes(
  helpers,
  "readEventText(",
  "思考正文必须从中心服务事件 payload.thinkingText 读取。",
);
assertNotIncludes(
  helpers,
  ") || entry.event.summary",
  "没有真实 thinkingText 时不能把事件摘要当作思考正文显示。",
);
assertNotIncludes(
  helpers,
  "无思考内容：中心服务未返回可展示的思考片段。",
  "思考卡片不能用固定占位文本冒充思考正文。",
);
assertIncludes(
  panel,
  "<summary>{{ row.thinking.title }}</summary>",
  "对话面板应只展示聚合后的思考标题，不能再拼旧状态标签。",
);
assertNotIncludes(
  workflowDomain,
  "thinkingText: contextSummary.runningText",
  "中心服务 thinking.delta 不能写入固定上下文摘要正文。",
);
assertNotIncludes(
  workflowDomain,
  "thinkingText: contextSummary.completedText",
  "中心服务 thinking.completed 不能写入固定上下文摘要正文。",
);
assertNotIncludes(
  workflowDomain,
  "buildPublicThinkingContextSummary",
  "中心服务不能继续构造固定上下文统计作为思考正文。",
);
assertNotIncludes(
  workflowDomain,
  "读取当前会话、任务状态、可用供应商和扩展能力后组织回复",
  "中心服务不能写入固定模板思考正文。",
);

console.log("对话思考卡片回归检查通过。");
