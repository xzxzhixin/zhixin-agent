/**
 * 对话过程卡片体验回归检查。
 *
 * 用途：覆盖工具卡片标题单行省略、正文高度、完成后折叠、命令类型区分和命令输出解码。
 * 关键逻辑：只读取源码信号，不运行 TypeScript 编译器，也不启动中心服务。
 */
import {
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

// root: 当前项目根目录。
const root = process.cwd();
// failures: 一次性收集所有失败，便于红灯阶段看清缺口。
const failures = [];

/**
 * readProjectFile：读取项目内 UTF-8 文本文件。
 *
 * @param {string} relativePath 项目相对路径。
 * @returns {string} 文件文本。
 */
function readProjectFile(relativePath) {
  return readFileSync(
    join(
      root,
      relativePath,
    ),
    "utf-8",
  );
}

/**
 * assertIncludes：断言源码包含指定信号。
 *
 * @param {string} source 源码文本。
 * @param {string} signal 必须存在的信号。
 * @param {string} message 失败说明。
 * @returns {void}
 */
function assertIncludes(
  source,
  signal,
  message,
) {
  if (!source.includes(signal)) {
    failures.push(message);
  }
}

/**
 * assertNotIncludes：断言源码不包含指定信号。
 *
 * @param {string} source 源码文本。
 * @param {string} signal 禁止存在的信号。
 * @param {string} message 失败说明。
 * @returns {void}
 */
function assertNotIncludes(
  source,
  signal,
  message,
) {
  if (source.includes(signal)) {
    failures.push(message);
  }
}

// panel: 对话面板模板与 scoped 样式，承载过程卡片渲染结构。
const panel = readProjectFile("apps/frontend/src/views/Chat/components/ChatConversationPanel.vue");
// helpers: 对话事件聚合逻辑，负责过程卡片类型和默认折叠状态。
const helpers = readProjectFile("apps/frontend/src/views/Chat/chat-view-helpers.ts");
// commandRuntime: 中心服务命令运行器，负责 stdout 和 stderr 解码。
const commandRuntime = readProjectFile("services/center/src/StructuredTool/command-tool-executor.ts");
// eventStore: 中心服务事件控制台输出，必须避免输出工具中间态刷屏。
const eventStore = readProjectFile("services/center/src/events.ts");
// logger: 中心服务控制台日志实现，必须保持中文原文。
const logger = readProjectFile("services/center/src/logger.ts");
// centerStructuredToolBase: Deep Agents 结构化工具基类，负责统一模型工具调用 ID。
const centerStructuredToolBase = readProjectFile("services/center/src/StructuredTool/CenterStructuredToolBase.ts");
// deepAgentsAgent: Deep Agents 原生入口，负责真实工具计划事件。
const deepAgentsAgent = readProjectFile("services/center/src/deepagents-agent.ts");

assertIncludes(
  helpers,
  "processKind",
  "过程卡片聚合结果必须包含 processKind，用于区分命令、MCP、插件、skill 和普通工具。",
);
assertIncludes(
  helpers,
  "defaultOpen: isRunning",
  "过程行必须保留运行态判定，避免终态后继续显示执行中。",
);
assertIncludes(
  helpers,
  "resolveToolCallProcessGroupId",
  "同一 toolCallId 的模型请求、工具计划、命令/MCP 执行和结果回填必须聚合到同一过程卡片。",
);
assertIncludes(
  helpers,
  "graphCheckpoint?.checkpointId",
  "graph checkpoint 分组能力必须保留，供内部事件审计和历史兼容使用。",
);
assertNotIncludes(
  helpers,
  "\"graph.node.started\",\n        \"graph.node.completed\",\n        \"graph.node.failed\"",
  "graph.node.* 是内部执行图审计事件，不能进入用户可见过程卡片。",
);
assertIncludes(
  helpers,
  "event.eventType === \"model.tool.result.appended\"",
  "工具结果回填事件必须能按 toolCallId 回到对应工具过程卡片内部。",
);
assertIncludes(
  helpers,
  "event.eventType === \"tool.plan.created\"",
  "工具计划事件必须能按 toolCallId 回到对应工具过程卡片内部。",
);
assertIncludes(
  centerStructuredToolBase,
  "resolveRuntimeToolCallId",
  "StructuredTool 基类必须优先继承 Deep Agents/LangChain 传入的工具调用 ID。",
);
assertIncludes(
  centerStructuredToolBase,
  "parentConfig",
  "StructuredTool 基类必须读取 LangChain 父级运行配置中的原始工具调用 ID。",
);
assertIncludes(
  centerStructuredToolBase,
  "randomUUID()",
  "StructuredTool 基类只允许在没有运行时工具调用 ID 时生成兼容 ID。",
);
assertIncludes(
  panel,
  "process-card__body",
  "过程卡片内部必须渲染聚合后的执行内容。",
);
assertIncludes(
  panel,
  "row.process.terminalText",
  "过程卡片内部必须按聚合文本展示完整工具调用过程。",
);
assertIncludes(
  panel,
  "process-card--command",
  "命令过程卡片必须有命令专属样式类。",
);
assertIncludes(
  panel,
  "process-card__title",
  "过程卡片标题必须有专属标题类用于单行省略。",
);
assertIncludes(
  panel,
  "white-space: nowrap;",
  "过程卡片标题必须单行展示。",
);
assertIncludes(
  panel,
  "text-overflow: ellipsis;",
  "过程卡片标题溢出必须用省略号展示。",
);
assertIncludes(
  panel,
  "max-height: 200px;",
  "过程卡片正文内容区最大高度必须为 200px。",
);
assertIncludes(
  panel,
  "overflow: auto;",
  "过程卡片正文超出 200px 时必须在正文内部滚动。",
);
assertIncludes(
  commandRuntime,
  "decodeCommandOutputChunk",
  "命令运行器必须通过统一函数解码 stdout/stderr，避免直接按错误编码显示乱码。",
);
assertIncludes(
  commandRuntime,
  "TextDecoder",
  "命令输出解码必须使用 TextDecoder 或等价平台编码处理能力。",
);
assertNotIncludes(
  commandRuntime,
  "chunk.toString(\"utf-8\")",
  "命令输出不能继续直接 Buffer.toString(\"utf-8\") 解码 Windows 非 UTF-8 输出。",
);
assertIncludes(
  eventStore,
  "shouldWriteCenterEventToConsole",
  "中心服务事件控制台输出必须集中判断一头一尾和失败，不能直接输出所有事件。",
);
assertIncludes(
  eventStore,
  "tool.command.output",
  "中心服务控制台日志必须明确压制命令输出中间态。",
);
assertIncludes(
  eventStore,
  "event.eventType === \"tool.command.started\"",
  "中心服务控制台日志必须保留命令启动这一头日志。",
);
assertIncludes(
  logger,
  "Utf8ConsoleStream",
  "中心服务控制台日志必须按 UTF-8 原文输出中文，不能再使用 ASCII 转义流。",
);
assertNotIncludes(
  logger,
  "escapeNonAscii",
  "中心服务控制台日志不能把中文转义为 \\uXXXX；日志文件和控制台都应显示中文原文。",
);
assertNotIncludes(
  logger,
  "AsciiConsoleStream",
  "中心服务控制台日志不能继续使用 ASCII 转义流。",
);
assertNotIncludes(
  deepAgentsAgent,
  "appendThinkingEvents(",
  "Deep Agents 原生入口不能写固定 thinking 事件冒充模型真实思考。",
);
assertIncludes(
  deepAgentsAgent,
  "recordToolCallLifecycle",
  "工具计划事件必须来自 Deep Agents 工具调用流，避免旧执行图临时状态导致计划丢失。",
);
assertIncludes(
  deepAgentsAgent,
  "scopeId: toolCall.callId",
  "工具计划事件必须用 Deep Agents 工具调用 ID 分组，避免多个工具计划混入同一过程卡片。",
);

if (failures.length > 0) {
  console.error("对话过程卡片体验回归检查失败：");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("对话过程卡片体验回归检查通过。");

