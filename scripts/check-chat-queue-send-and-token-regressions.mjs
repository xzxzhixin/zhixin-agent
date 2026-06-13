import fs from "node:fs";
import path from "node:path";

/**
 * readText：读取项目内文本文件。
 *
 * @param {string} relativePath 项目相对路径。
 * @returns {string} 文件内容。
 */
function readText(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

/**
 * assertIncludes：检查源码或文档中必须存在的稳定片段。
 *
 * @param {string} source 被检查文本。
 * @param {string} needle 必须存在的片段。
 * @param {string} message 失败说明。
 * @returns {void}
 */
function assertIncludes(source, needle, message) {
  if (!source.includes(needle)) {
    console.error(message);
    console.error(`缺少片段：${needle}`);
    process.exit(1);
  }
}

/**
 * assertNotIncludes：检查源码或文档中不能存在的旧行为片段。
 *
 * @param {string} source 被检查文本。
 * @param {string} needle 禁止存在的片段。
 * @param {string} message 失败说明。
 * @returns {void}
 */
function assertNotIncludes(source, needle, message) {
  if (source.includes(needle)) {
    console.error(message);
    console.error(`禁止片段：${needle}`);
    process.exit(1);
  }
}

/**
 * assertNotMatches：检查源码不能匹配指定正则。
 *
 * @param {string} source 被检查文本。
 * @param {RegExp} pattern 禁止匹配的正则。
 * @param {string} message 失败说明。
 * @returns {void}
 */
function assertNotMatches(source, pattern, message) {
  if (pattern.test(source)) {
    console.error(message);
    console.error(`禁止正则：${pattern}`);
    process.exit(1);
  }
}

// requirementDoc: 产品需求事实源，必须记录本轮已确认的交互口径。
const requirementDoc = readText("需求.md");
// architectureDoc: 架构事实源，必须记录本轮前端状态与事件来源边界。
const architectureDoc = readText("架构.md");
// chatView: 对话页源码，承载输入区、排队提示和按钮状态。
const chatView = readText("apps/frontend/src/views/Chat/RouterIndex.vue");
// chatPanel: 对话内容组件，承载拆分后的输入区、排队提示和按钮状态。
const chatPanel = readText("apps/frontend/src/views/Chat/components/ChatConversationPanel.vue");
// composerContextUsage: 输入区 token 展示组合逻辑。
const composerContextUsage = readText("apps/frontend/src/views/Chat/useComposerContextUsage.ts");
// conversationActions: 对话发送 action，承载运行中发送排队逻辑。
const conversationActions = readText("apps/frontend/src/stores/app-conversation-actions.ts");
// managementActions: 管理 action，包含上下文 token 统计调度。
const managementActions = readText("apps/frontend/src/stores/app-management-actions.ts");
// sessionRepository: 中心服务会话仓储，负责默认任务标题。
const sessionRepository = readText("services/center/src/data-access/session-repository.ts");
// appStore: 主状态容器，承载排队消息状态和输入区事件。
const appStore = readText("apps/frontend/src/stores/app.ts");
// appTypes: 状态类型文件，必须为新增字段写清楚中文注释。
const appTypes = readText("apps/frontend/src/stores/app-types.ts");
// chatConversation: 对话组合逻辑，负责任务面板行展示。
const chatConversation = readText("apps/frontend/src/views/Chat/useChatConversation.ts");

assertIncludes(
  requirementDoc,
  "运行中轮次存在时，用户按 Enter 发送的新消息不能直接打断或替换当前轮次，必须进入当前对话的本地排队消息区。",
  "需求.md 必须明确运行中 Enter 发送进入本地排队消息区。",
);
assertIncludes(
  requirementDoc,
  "点击排队消息右侧的“引导”后，该排队消息必须立即从排队区移除。",
  "需求.md 必须明确点击引导后直接移除排队消息。",
);
assertIncludes(
  requirementDoc,
  "用户输入过程中不进行 token 统计；token 只在本轮执行中根据中心服务或模型事件更新，并在本轮完成后显示最终总览。",
  "需求.md 必须明确 token 不在输入阶段统计。",
);
assertIncludes(
  architectureDoc,
  "本地排队消息只保存在前端当前对话窗口状态中，点击“引导”后立即移除该排队项。",
  "架构.md 必须明确排队消息的前端状态边界和引导移除行为。",
);
assertIncludes(
  architectureDoc,
  "上下文 token 总览不因用户输入变化触发 tokenizer 请求。",
  "架构.md 必须明确输入变化不触发 token 统计。",
);
assertIncludes(
  appTypes,
  "QueuedComposerMessage",
  "状态类型必须定义本地排队消息结构。",
);
assertIncludes(
  appStore,
  "queuedComposerMessages",
  "Pinia 状态必须保存当前对话本地排队消息列表。",
);
assertIncludes(
  conversationActions,
  "queueDraftForCurrentTurn",
  "对话 action 必须提供运行中发送入队方法。",
);
assertIncludes(
  conversationActions,
  "submitQueuedMessageAsGuidance",
  "对话 action 必须提供排队消息转引导并移除的方法。",
);
assertIncludes(
  conversationActions,
  "ensureRealtimeOpenForUserAction",
  "对话 action 必须在用户主动发送、引导或停止前校验实时连接已恢复。",
);
assertIncludes(
  conversationActions,
  "实时连接未恢复",
  "连接未恢复时必须给出本地错误提示，并保留输入内容不发送。",
);
assertIncludes(
  chatView + chatPanel,
  "pending-guidance-queue",
  "对话页输入区顶部必须渲染排队消息区域。",
);
assertIncludes(
  chatView + chatPanel,
  "canUseRealtimeUserAction",
  "发送、停止和引导按钮必须根据实时连接状态禁用。",
);
assertIncludes(
  chatView + chatPanel,
  ":disabled=\"!canUseRealtimeUserAction\"",
  "连接未恢复时用户主动发送按钮必须禁用，避免已停止仍发出问题。",
);
assertIncludes(
  chatView + chatPanel,
  "submitQueuedMessageAsGuidance(message.queuedMessageId)",
  "排队消息引导按钮必须调用移除并引导发送方法。",
);
assertIncludes(
  chatView + chatPanel,
  "handleComposerEnterSend",
  "Enter 发送必须经过运行中入队判断，而不是直接调用 sendDraft。",
);
assertNotMatches(
  chatPanel,
  /function\s+handleComposerEnterSend\(\):\s*void\s*\{\s*void\s+handleComposerPrimaryAction\(\);\s*\}/u,
  "输入框 Enter 不能复用发送/停止主按钮动作；运行中 Enter 必须进入排队，停止只能由停止按钮触发。",
);
assertIncludes(
  chatPanel,
  "chatConversation.sendDraftForConversation()",
  "主对话输入框 Enter 必须调用发送动作，由 sendDraft 在运行中进入本地排队消息区。",
);
assertNotIncludes(
  chatView + chatPanel,
  "@keyup.enter.exact.prevent=\"chatConversation.sendDraftForConversation\"",
  "输入框 Enter 不能直接调用发送，应在运行中进入排队消息。",
);
assertIncludes(
  chatView + chatPanel,
  "composerPrimaryButtonText",
  "发送按钮必须由运行状态计算为发送或停止。",
);
assertIncludes(
  chatView + chatPanel,
  "turn.status === \"queued\"",
  "停止态必须覆盖 queued 未结束轮次。",
);
assertIncludes(
  chatView + chatPanel,
  "turn.status === \"running\"",
  "停止态必须覆盖 running 未结束轮次。",
);
assertIncludes(
  chatView + chatPanel,
  "turn.status === \"waiting_user\"",
  "停止态必须覆盖 waiting_user 未结束轮次。",
);
assertIncludes(
  chatView + chatPanel,
  "停止",
  "发送按钮执行中必须显示停止。",
);
assertIncludes(
  chatView + chatPanel,
  "composerContextPercentText",
  "token 外显必须使用独立百分比文本，不能继续展示长明细。",
);
assertIncludes(
  chatView + chatPanel,
  "composer-context-progress",
  "token 外显必须提供进度圈节点。",
);
assertIncludes(
  chatView + chatPanel + composerContextUsage,
  "usedTokens > 0",
  "0 token 必须显示为 0，不能被格式化成未配置窗口。",
);
assertNotIncludes(
  sessionRepository,
  "等待 Agent 执行",
  "任务标题不能显示伪 Agent 状态，应展示真实任务容器语义。",
);
assertIncludes(
  chatConversation,
  "normalizeTaskTitle(task.title)",
  "任务面板必须兼容旧数据，把伪 Agent 标题转换为真实任务标题。",
);
assertIncludes(
  managementActions,
  "updateComposerContextUsageFromExecution",
  "token 统计必须提供执行中或完成后更新入口。",
);
assertIncludes(
  managementActions,
  "scheduleComposerContextUsageUpdate(): void",
  "输入阶段 token 调度必须保留兼容方法。",
);
assertIncludes(
  managementActions,
  "用户输入阶段不进行 token 统计",
  "输入阶段 token 调度必须直接跳过并写明原因。",
);
assertNotIncludes(
  appStore,
  "this.scheduleComposerContextUsageUpdate();",
  "输入、引用和附件变更不能继续触发 token 统计调度。",
);

console.log("对话排队发送、按钮状态和 token 统计回归检查通过。");
