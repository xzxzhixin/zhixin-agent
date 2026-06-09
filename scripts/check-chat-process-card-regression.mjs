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
const commandRuntime = readProjectFile("services/center/src/tools/command-tool.ts");

assertIncludes(
  helpers,
  "processKind",
  "过程卡片聚合结果必须包含 processKind，用于区分命令、MCP、插件、skill 和普通工具。",
);
assertIncludes(
  helpers,
  "defaultOpen: isRunning",
  "工具过程卡片必须运行中默认展开，完成或失败后默认折叠。",
);
assertIncludes(
  panel,
  "process-card--command",
  "命令过程卡片必须有命令专属样式类。",
);
assertIncludes(
  panel,
  "<details",
  "过程卡片必须使用 details 或等价折叠结构。",
);
assertIncludes(
  panel,
  ":open=\"row.process.defaultOpen\"",
  "过程卡片默认展开状态必须来自聚合后的 defaultOpen。",
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

if (failures.length > 0) {
  console.error("对话过程卡片体验回归检查失败：");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("对话过程卡片体验回归检查通过。");
