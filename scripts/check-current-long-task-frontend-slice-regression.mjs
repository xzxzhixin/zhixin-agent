/**
 * 智能体长任务前端入口与单行展示切片回归检查。
 *
 * 用途：验证任务入口只展示可见拆解步骤，任务详情按单行步骤渲染，
 * 运行中引导走 session.guidance.submit 对应动作，不退回普通 sendDraft 新轮次。
 * 关键逻辑：只扫描前端源码，不运行 TypeScript 编译器，符合项目质量门槛约束。
 */
import {
  existsSync,
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

// root: 仓库根目录，来源于脚本执行目录。
const root = process.cwd();
// failures: 收集所有失败，便于一次性输出本轮前端切片缺口。
const failures = [];

/**
 * readText：读取 UTF-8 文本文件。
 *
 * @param {string} relativePath 仓库相对路径。
 * @returns {string} 文件文本；缺失时返回空字符串并记录失败。
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
 * assertIncludes：断言源码包含指定片段。
 *
 * @param {string} source 源码文本。
 * @param {string} fragment 必须存在的片段。
 * @param {string} message 失败说明。
 */
function assertIncludes(
  source,
  fragment,
  message,
) {
  if (!source.includes(fragment)) {
    failures.push(message);
  }
}

/**
 * assertNotIncludes：断言源码不包含指定片段。
 *
 * @param {string} source 源码文本。
 * @param {string} fragment 禁止存在的片段。
 * @param {string} message 失败说明。
 */
function assertNotIncludes(
  source,
  fragment,
  message,
) {
  if (source.includes(fragment)) {
    failures.push(message);
  }
}

const chatConversation = readText("apps/frontend/src/views/Chat/useChatConversation.ts");
const chatPanel = readText("apps/frontend/src/views/Chat/components/ChatConversationPanel.vue");
const taskDetailDialog = readText("apps/frontend/src/views/Chat/dialogs/TaskDetailDialog.vue");

assertIncludes(
  chatConversation,
  "filterVisibleDecompositionSteps",
  "createTaskPanelRows 必须先筛选可见拆解步骤。",
);
assertIncludes(
  chatConversation,
  "visibleSteps.length <= 1",
  "可见步骤小于等于 1 时必须隐藏任务入口行。",
);
assertNotIncludes(
  chatConversation,
  'id: "composer-task-idle"',
  "不能再注入默认任务空态行，否则会弹出默认任务行。",
);
assertNotIncludes(
  chatConversation,
  "failureReason: failedStep?.summary",
  "任务行不能展示失败原因，失败原因应留给过程或事件详情。",
);
assertIncludes(
  chatConversation,
  "positionText: `${stepIndex + 1}/${visibleSteps.length}`",
  "步骤行必须生成序号/总数字段。",
);
assertIncludes(
  chatConversation,
  "submitGuidance",
  "运行中引导必须通过专用引导方法进入 session.guidance.submit。",
);
assertIncludes(
  chatPanel,
  "activeTaskPanelRows.value.flatMap",
  "任务入口数字必须基于可见拆解步骤计算。",
);
assertIncludes(
  chatPanel,
  'taskProgressText ? ` ${taskProgressText}` : ""',
  "没有可见拆解步骤时入口不能显示 0/0、0/1 或 1/1。",
);
assertNotIncludes(
  chatPanel,
  "const total = tasks.length",
  "任务入口不能再按任务容器数量计算总数。",
);
assertIncludes(
  taskDetailDialog,
  "composer-task-step-row",
  "任务详情必须渲染步骤单行。",
);
assertIncludes(
  taskDetailDialog,
  "step.positionText",
  "任务详情右侧必须显示序号/总数。",
);
assertNotIncludes(
  taskDetailDialog,
  "task.status",
  "任务详情右侧不能重复展示任务状态。",
);
assertNotIncludes(
  taskDetailDialog,
  "step.summary",
  "任务详情不能展示第二行摘要、失败原因、替换原因或工具输出。",
);

if (failures.length > 0) {
  console.error("智能体长任务前端切片回归检查失败：");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("智能体长任务前端切片回归检查通过。");
