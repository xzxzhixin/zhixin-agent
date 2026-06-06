import fs from "node:fs";
import path from "node:path";

/**
 * readText：读取项目内 UTF-8 文本。
 *
 * @param {string} relativePath 项目相对路径。
 * @returns {string} 文件内容。
 */
function readText(relativePath) {
  return fs.readFileSync(
    path.join(
      process.cwd(),
      relativePath,
    ),
    "utf8",
  );
}

/**
 * assertIncludes：检查文本包含稳定实现信号。
 *
 * @param {string} source 被检查文本。
 * @param {string} needle 必须存在的片段。
 * @param {string} message 失败说明。
 * @returns {void} 没有返回值。
 */
function assertIncludes(
    source,
    needle,
    message,
) {
  if (!source.includes(needle)) {
    console.error(message);
    console.error(`缺少片段：${needle}`);
    process.exit(1);
  }
}

/**
 * assertNotIncludes：检查文本不包含旧行为信号。
 *
 * @param {string} source 被检查文本。
 * @param {string} needle 禁止存在的片段。
 * @param {string} message 失败说明。
 * @returns {void} 没有返回值。
 */
function assertNotIncludes(
    source,
    needle,
    message,
) {
  if (source.includes(needle)) {
    console.error(message);
    console.error(`禁止片段：${needle}`);
    process.exit(1);
  }
}

/**
 * extractCssRule：提取指定 CSS 选择器对应的规则块。
 *
 * @param {string} source CSS 文件内容。
 * @param {string} selector CSS 选择器。
 * @returns {string} 选择器对应规则块。
 */
function extractCssRule(
    source,
    selector,
) {
  const selectorStart = source.indexOf(`${selector} {`);
  const startIndex = selectorStart >= 0
    ? selectorStart
    : source.indexOf(selector);
  if (startIndex < 0) {
    console.error(`缺少 CSS 选择器：${selector}`);
    process.exit(1);
  }
  const openIndex = source.indexOf("{", startIndex);
  const closeIndex = source.indexOf("}", openIndex);
  if (openIndex < 0 || closeIndex < 0) {
    console.error(`CSS 选择器规则不完整：${selector}`);
    process.exit(1);
  }
  return source.slice(
    startIndex,
    closeIndex + 1,
  );
}

// chatPage: 对话页入口，承载 token 外显、三入口和两个下拉控件。
const chatPage = readText("apps/frontend/src/views/Chat/RouterIndex.vue");
// chatHelpers: 对话页辅助函数，承载 token tooltip 文案。
const chatHelpers = readText("apps/frontend/src/views/Chat/chat-view-helpers.ts");
// chatStyle: 对话页专属样式，承载输入区与浮层视觉边界。
const chatStyle = readText("apps/frontend/src/views/Chat/style.css");
// composerShellRule: 输入框外壳样式块，校验浮层相对边界计算。
const composerShellRule = extractCssRule(
  chatStyle,
  ".chat-page-host .composer-shell",
);
// composerEntryStripRule: 三入口条样式块，避免误伤其他组件的 gap。
const composerEntryStripRule = extractCssRule(
  chatStyle,
  ".chat-page-host .composer-entry-strip",
);
// composerEntryTabRule: 三入口按钮样式块，校验入口视觉高度。
const composerEntryTabRule = extractCssRule(
  chatStyle,
  ".chat-page-host .composer-entry-tab",
);
// composerMiniPopoverRule: 三入口浮层样式块，校验其与输入框边缘对齐。
const composerMiniPopoverRule = extractCssRule(
  chatStyle,
  ".chat-page-host .composer-mini-popover",
);
// globalStyle: 前端全局样式，承载 Element Plus 下拉选项多行展示约束。
const globalStyle = readText("apps/frontend/src/styles.css");
// planDoc: 计划事实源，必须记录本轮已完成的 UI 回归任务。
const planDoc = readText("计划.md");

assertIncludes(
  chatPage,
  "composerContextPercentText",
  "token 外显必须拆出只用于外部展示的百分比文本。",
);
assertIncludes(
  chatPage,
  "composer-context-ring",
  "token 外显必须包含进度圈节点。",
);
assertIncludes(
  chatPage,
  "composer-context-percent",
  "token 外显必须包含百分比节点。",
);
assertNotIncludes(
  chatPage,
  "上下文 {{ composerContextUsageText }}",
  "token 外显不能继续显示“上下文 + 已用 / 上限”长文本。",
);
assertIncludes(
  chatHelpers,
  "`用量：${usedText} / ${limitText}`",
  "token tooltip 必须使用 K 单位显示用量 / 上限。",
);
assertIncludes(
  chatHelpers,
  "\"0K\"",
  "token tooltip 中 0 用量也必须使用 K 单位。",
);
assertIncludes(
  chatHelpers,
  "`百分比：${input.percentText}`",
  "token tooltip 必须只显示百分比。",
);
assertNotIncludes(
  chatHelpers,
  "已用 token：",
  "token tooltip 不再显示原始 token 字段名。",
);
assertNotIncludes(
  chatHelpers,
  "窗口上限：",
  "token tooltip 不再单独显示窗口上限字段。",
);
assertNotIncludes(
  chatHelpers,
  "占用比例：",
  "token tooltip 不再显示占用比例旧字段名。",
);
assertIncludes(
  composerShellRule,
  "box-sizing: border-box;",
  "输入框外壳必须使用 border-box，避免浮层按内容盒导致左右多出边框偏移。",
);
assertIncludes(
  composerShellRule,
  "padding: 0;",
  "输入框外壳不能保留全局内边距，三入口、浮层和输入框外边缘必须共用同一边界。",
);
assertIncludes(
  composerEntryTabRule,
  "height: 52px;",
  "三入口按钮视觉高度必须达到激活框大小。",
);
assertIncludes(
  composerEntryStripRule,
  "border-radius: 12px 12px 0 0;",
  "三入口顶部圆角必须和输入框顶部圆角对齐。",
);
assertIncludes(
  composerMiniPopoverRule,
  "right: 0;",
  "三入口浮层必须和输入框右边缘对齐。",
);
assertIncludes(
  composerMiniPopoverRule,
  "left: 0;",
  "三入口浮层必须和输入框左边缘对齐。",
);
assertIncludes(
  composerEntryStripRule,
  "padding: 0;",
  "三入口条必须去掉内部边缘偏移，确保左右对齐。",
);
assertIncludes(
  composerMiniPopoverRule,
  "padding: 0;",
  "三入口浮层必须去掉内部边缘偏移，确保左右对齐。",
);
assertNotIncludes(
  composerMiniPopoverRule,
  "left: 12px;",
  "三入口浮层不能保留 12px 左偏移。",
);
assertNotIncludes(
  composerMiniPopoverRule,
  "right: 12px;",
  "三入口浮层不能保留 12px 右偏移。",
);
assertNotIncludes(
  composerEntryStripRule,
  "gap: 8px;",
  "三入口条不能用 gap 造成入口与浮层左右不齐。",
);
const agentStatusDialog = readText("apps/frontend/src/views/Chat/dialogs/AgentStatusDialog.vue");
assertIncludes(
  agentStatusDialog,
  "max-height: 40vh;",
  "智能体浮层必须统一最大高度 40vh。",
);
assertIncludes(
  agentStatusDialog,
  "overflow: visible;",
  "智能体浮层内部树区域不能再出现独立滚动条。",
);
assertIncludes(
  agentStatusDialog,
  ".agent-status-el-tree",
  "智能体浮层必须覆盖 Element Plus 树组件自身滚动。",
);
assertNotIncludes(
  agentStatusDialog,
  "max-height: min(40vh, 380px);",
  "智能体浮层不能继续使用额外 380px 限制。",
);
assertNotIncludes(
  agentStatusDialog,
  "overflow-y: auto;",
  "智能体浮层内部不能保留自身滚动条。",
);
assertIncludes(
  chatStyle,
  ".chat-page-host .agent-status-tree",
  "Chat 页面必须覆盖智能体树区域，避免 scoped 样式命中不足导致内部滚动条回归。",
);
assertIncludes(
  globalStyle,
  "white-space: normal;",
  "下拉选项说明必须允许换行展示，避免 description 被截断不可见。",
);
assertIncludes(
  globalStyle,
  ".el-select-dropdown__item",
  "必须覆盖 Element Plus 选项高度，确保执行模式和推理深度描述可见。",
);
assertIncludes(
  planDoc,
  "- [x] 补齐本轮 token 外显、三入口激活大小和下拉描述回归",
  "计划.md 必须记录并勾选本轮 UI 回归任务。",
);

console.log("对话输入区 token、三入口和下拉描述回归检查通过。");
