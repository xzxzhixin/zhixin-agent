/**
 * 本轮浏览器对话体验静态回归检查。
 *
 * 用途：覆盖 P01-P09 的时间线、输入框焦点、思考聚合、流式首包、tokenizer 展示和上下文 tooltip 约束。
 * 关键逻辑：只读取源码和脚本文本，不运行 TypeScript 编译器，不触碰桌面端或插件端。
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import {
  join,
} from "node:path";

// root: 当前项目根目录。
const root = process.cwd();
// failures: 收集全部失败项，便于一次输出。
const failures = [];

/**
 * readText：读取项目内 UTF-8 文本。
 *
 * @param {string} relativePath 项目相对路径。
 * @returns {string} 文件内容；缺失时返回空字符串。
 */
function readText(relativePath) {
  const absolutePath = join(
    root,
    relativePath,
  );
  if (!existsSync(absolutePath)) {
    failures.push(`${relativePath}: 文件不存在。`);
    return "";
  }
  return readFileSync(
    absolutePath,
    "utf-8",
  );
}

/**
 * listFiles：递归列出目录中的文件。
 *
 * @param {string} relativeDirectory 项目相对目录。
 * @returns {string[]} 项目相对文件路径数组。
 */
function listFiles(relativeDirectory) {
  const absoluteDirectory = join(
    root,
    relativeDirectory,
  );
  if (!existsSync(absoluteDirectory)) {
    return [];
  }
  return readdirSync(absoluteDirectory).flatMap((name) => {
    const relativePath = join(
      relativeDirectory,
      name,
    );
    const absolutePath = join(
      root,
      relativePath,
    );
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      if (name === "node_modules" || name === "dist") {
        return [];
      }
      return listFiles(relativePath);
    }
    return [
      relativePath,
    ];
  });
}

/**
 * assertIncludes：断言文本包含指定信号。
 *
 * @param {string} text 待检查文本。
 * @param {string} signal 必须出现的信号。
 * @param {string} message 失败说明。
 */
function assertIncludes(
    text,
    signal,
    message,
) {
  if (!text.includes(signal)) {
    failures.push(message);
  }
}

/**
 * assertNotIncludes：断言文本不包含指定信号。
 *
 * @param {string} text 待检查文本。
 * @param {string} signal 禁止出现的信号。
 * @param {string} message 失败说明。
 */
function assertNotIncludes(
    text,
    signal,
    message,
) {
  if (text.includes(signal)) {
    failures.push(message);
  }
}

// chatPage: 对话页路由入口源码。
const chatPage = readText("apps/frontend/src/views/Chat/RouterIndex.vue");
// chatConversationPanel: 抽出的完整对话组件源码，承载消息区、时间线和输入区。
const chatConversationPanel = readText("apps/frontend/src/views/Chat/components/ChatConversationPanel.vue");
// chatConversationSurface: 对话页面实际渲染面，允许检查跟随组件拆分后的源码信号。
const chatConversationSurface = [
  chatPage,
  chatConversationPanel,
].join("\n");
// chatHelpers: 对话页辅助函数源码。
const chatHelpers = readText("apps/frontend/src/views/Chat/chat-view-helpers.ts");
// conversationActions: 对话发送和实时同步 action 源码。
const conversationActions = readText("apps/frontend/src/stores/app-conversation-actions.ts");
// managementActions: 输入区上下文统计 action 源码。
const managementActions = readText("apps/frontend/src/stores/app-management-actions.ts");
// chatStyle: 对话页专属样式源码。
const chatStyle = readText("apps/frontend/src/views/Chat/style.css");
// noTypeCompilerScript: 禁止 TS 编译器质量门槛检查脚本。
const noTypeCompilerScript = readText("scripts/check-no-type-compiler.mjs");

assertIncludes(
  chatConversationSurface,
  "messageTimelineNodes",
  "Chat 页面必须生成用户消息时间线节点。",
);
assertIncludes(
  chatConversationSurface,
  "data-message-anchor",
  "用户消息必须建立稳定 DOM 锚点用于时间线定位。",
);
assertIncludes(
  chatConversationSurface,
  "scrollToMessageAnchor",
  "时间线点击必须滚动定位到对应用户消息。",
);
assertIncludes(
  chatConversationSurface,
  "timeline-target",
  "时间线点击目标用户消息必须有明确定位反馈类。",
);
assertIncludes(
  chatConversationSurface,
  "classList.add(\"timeline-target\")",
  "时间线定位必须给目标消息添加可见高亮状态。",
);
assertIncludes(
  chatConversationSurface,
  "classList.remove(\"timeline-target\")",
  "时间线定位反馈必须自动消退，避免长期误导用户。",
);
assertIncludes(
  chatConversationSurface,
  "conversation-timeline",
  "Chat 页面必须渲染对话时间线容器。",
);
assertIncludes(
  chatConversationSurface,
  "context-usage-tooltip",
  "上下文占用摘要必须提供 tooltip。",
);
assertIncludes(
  chatConversationSurface,
  "composerFocused",
  "输入框聚焦态必须作用于输入框整体容器。",
);
assertIncludes(
  chatHelpers,
  "createThinkingProcessRows",
  "思考事件必须通过 helper 拆成独立思考卡片。",
);
assertIncludes(
  chatHelpers,
  "resolveThinkingGroupKey",
  "思考事件必须按 thinkingId 或阶段生成独立卡片聚合键。",
);
assertIncludes(
  chatHelpers,
  "createStreamingAssistantRows",
  "模型 SSE 流必须通过 helper 拼接为运行中助手回复气泡。",
);
assertIncludes(
  chatHelpers,
  "streaming-assistant",
  "运行中助手回复必须使用稳定临时行 ID，避免流式更新整条消息重新挂载。",
);
assertNotIncludes(
  chatHelpers,
  "kind: \"stream\"",
  "模型 SSE 流不能渲染为 stream 过程卡片，必须进入助手回复气泡。",
);
assertNotIncludes(
  chatHelpers,
  "\"tool.plugin.unavailable\"",
  "插件不可用占位事件不能渲染为对话区过程卡片。",
);
assertNotIncludes(
  chatHelpers,
  "\"tool.mcp.unavailable\"",
  "MCP 不可用占位事件不能渲染为对话区过程卡片。",
);
assertNotIncludes(
  chatHelpers,
  "\"tool.skill.unavailable\"",
  "skill 不可用占位事件不能渲染为对话区过程卡片。",
);
assertIncludes(
  chatHelpers,
  "resolveProcessEventStatus",
  "过程事件状态必须通过 eventType 推导函数统一计算，不能读取不存在的顶层 status。",
);
assertIncludes(
  chatHelpers,
  "EventRecord 共享协议没有顶层 status",
  "状态推导函数必须用中文注释说明不能读取顶层 event.status 的协议原因。",
);
assertIncludes(
  chatHelpers,
  "ThinkingProcessRow",
  "思考聚合行必须有明确类型。",
);
assertIncludes(
  chatConversationSurface,
  "row.process.statusLabel",
  "普通流式过程卡片必须消费 helper 推导后的状态文案。",
);
assertIncludes(
  chatHelpers,
  "createMessageTimelineNodes",
  "时间线节点必须由 helper 从用户消息生成，避免页面内猜测字段。",
);
assertIncludes(
  conversationActions,
  "applySentMessageOptimisticState",
  "发送消息后必须立即写入用户消息、轮次、任务和初始过程事件。",
);
assertIncludes(
  managementActions,
  "tokenizer.count",
  "上下文 tooltip 数据必须来自中心服务 tokenizer WebSocket 统计接口。",
);
assertIncludes(
  chatStyle,
  ".composer-shell.is-focused",
  "输入框聚焦样式必须作用于 composer 外层容器。",
);
assertIncludes(
  chatStyle,
  ".conversation-timeline",
  "时间线必须有专属布局样式，避免遮挡主滚动区和输入区。",
);
assertIncludes(
  chatStyle,
  ".message-row.user.timeline-target",
  "目标用户消息必须有可见高亮样式。",
);
assertNotIncludes(
  chatPage,
  "内置 tokenizer",
  "页面不得展示 tokenizer 实现名称。",
);
assertNotIncludes(
  chatPage,
  "内置字节分段 tokenizer",
  "页面不得展示 tokenizer 实现细节。",
);
assertNotIncludes(
  chatHelpers,
  "event.status",
  "Chat helper 不得使用不存在的 EventRecord 顶层 status 判断过程状态。",
);
assertNotIncludes(
  chatPage,
  "row.event.status",
  "Chat 页面不得使用不存在的 EventRecord 顶层 status 判断过程状态。",
);
assertIncludes(
  conversationActions,
  "replaceRealtimeEvent",
  "WebSocket 事件必须通过替换数组引用写入，避免原地 push/sort 后依赖窗口重绘才显示。",
);
assertNotIncludes(
  conversationActions,
  "this.events.push(event)",
  "WebSocket 实时事件不能继续原地 push，否则可能导致流式回复和过程卡片刷新滞后。",
);
assertNotIncludes(
  conversationActions,
  "this.events.sort(",
  "WebSocket 实时事件不能继续原地 sort，必须写入新的已排序数组引用。",
);
assertIncludes(
  managementActions,
  "窗口失焦后 token 用量保持",
  "token 用量状态必须用中文注释说明窗口失焦和切换后仍要保持。",
);
assertIncludes(
  managementActions,
  "composerContextUsage",
  "token 用量必须保存在对话状态容器中，不能绑定到 hover 弹层 DOM 生命周期。",
);

for (const file of listFiles("scripts")) {
  const scriptText = readText(file);
  if (scriptText.includes("tsc --noEmit") || scriptText.includes("vue-tsc")) {
    if (
      !file.endsWith("check-no-type-compiler.mjs")
      && !file.endsWith("check-current-plan-regressions.mjs")
      && !file.endsWith("check-langgraph-mem0-center-config.mjs")
      && !file.endsWith("check-chat-experience-regressions.mjs")
    ) {
      failures.push(`${file}: 静态回归脚本不得新增 TypeScript 编译器质量门槛。`);
    }
  }
}

if (!noTypeCompilerScript.includes("tsc --noEmit") || !noTypeCompilerScript.includes("vue-tsc")) {
  failures.push("scripts/check-no-type-compiler.mjs: 必须继续覆盖禁止 TypeScript 编译器质量门槛。");
}

if (failures.length > 0) {
  console.error("本轮浏览器对话体验静态回归检查失败：");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("本轮浏览器对话体验静态回归检查通过。");
