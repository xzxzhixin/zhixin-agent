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
// chatConversationPanel: 完整共享对话组件，承载消息、时间线、三入口和输入区。
const chatConversationPanel = readText("apps/frontend/src/views/Chat/components/ChatConversationPanel.vue");
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
// composerToolbarRule: 输入区底部工具栏样式块，校验底部两个角不被内部背景裁掉。
const composerToolbarRule = extractCssRule(
  chatStyle,
  ".chat-page-host .composer-toolbar",
);
// globalStyle: 前端全局样式，承载 Element Plus 下拉选项多行展示约束。
const globalStyle = readText("apps/frontend/src/styles.css");
// planDoc: 计划事实源，必须记录本轮已完成的 UI 回归任务。
const planDoc = readText("计划.md");
// agentConversationDialog: 智能体对话弹框，必须复用完整对话组件。
const agentConversationDialog = readText("apps/frontend/src/views/Chat/dialogs/AgentConversationDialog.vue");
// sharedConversationPanel: 主对话和智能体对话弹框共用完整对话组件。
const sharedConversationPanel = fs.existsSync(path.join(process.cwd(), "apps/frontend/src/views/Chat/components/ChatConversationPanel.vue"))
  ? readText("apps/frontend/src/views/Chat/components/ChatConversationPanel.vue")
  : "";
// sharedTypes: 共享协议类型必须包含智能体子对话与待确认编辑记录。
const sharedTypes = readText("packages/shared/src/index.ts");
// apiClient: API client 必须暴露智能体子对话和编辑记录真实接口。
const apiClient = readText("packages/api-client/src/index.ts");
// centerRoutes: 中心服务路由必须注册智能体子对话和编辑记录接口，允许按职责拆到独立路由文件。
const centerRoutes = [
  readText("services/center/src/api/api-routes.ts"),
  readText("services/center/src/api/agent-edit-routes.ts"),
].join("\n");
// centerEditDomain: 中心服务编辑领域，必须负责真实文件编辑后的待确认记录落库。
const centerEditDomain = fs.existsSync(path.join(process.cwd(), "services/center/src/agent-edit-domain.ts"))
  ? readText("services/center/src/agent-edit-domain.ts")
  : "";
// centerDatabase: 中心服务数据库层必须创建真实持久表。
const centerDatabase = readText("services/center/src/database.ts");
// ideaBridge: IDEA 宿主桥接必须提供原生 diff 打开能力。
const ideaBridge = readText("plugins/idea/src/main/java/top/xzxsrq/agent/ZhixinPluginBridge.java");

assertIncludes(
  chatConversationPanel,
  "composerContextPercentText",
  "token 外显必须拆出只用于外部展示的百分比文本。",
);
assertIncludes(
  chatConversationPanel,
  "el-progress",
  "token 外显必须改用 Element Plus 进度组件。",
);
assertIncludes(
  chatConversationPanel,
  "type=\"circle\"",
  "token 外显必须使用 Element Plus 圆形进度组件。",
);
assertNotIncludes(
  chatConversationPanel,
  "composer-context-ring",
  "token 外显不能继续使用手写边框进度圈。",
);
assertIncludes(
  chatConversationPanel,
  "composer-context-percent",
  "token 外显必须包含百分比节点。",
);
assertNotIncludes(
  chatConversationPanel,
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
assertNotIncludes(
  composerEntryTabRule,
  "height: 52px;",
  "三入口按钮不能继续写死 52px 高度。",
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
const taskDetailDialog = readText("apps/frontend/src/views/Chat/dialogs/TaskDetailDialog.vue");
const editDetailDialog = readText("apps/frontend/src/views/Chat/dialogs/EditDetailDialog.vue");
assertIncludes(
  chatConversationPanel,
  "blurComposerInput();",
  "打开任务、智能体或编辑浮层时必须释放输入框焦点。",
);
assertIncludes(
  chatConversationPanel,
  "composerInputRef",
  "输入框必须保留组件引用，供浮层打开时 blur。",
);
assertIncludes(
  chatConversationPanel,
  "ref=\"composerInputRef\"",
  "输入框组件必须绑定 ref，避免只更新聚焦状态但真实输入仍激活。",
);
assertIncludes(
  composerShellRule,
  "border-radius: 12px;",
  "输入框外壳必须保留完整圆角，避免顶部两个角样式丢失。",
);
assertIncludes(
  composerEntryStripRule,
  "overflow: visible;",
  "三入口条不能裁掉输入框顶部两个圆角。",
);
assertIncludes(
  composerToolbarRule,
  "border-radius: 0 0 12px 12px;",
  "输入区底部工具栏必须保留外壳底部两个圆角。",
);
assertIncludes(
  taskDetailDialog,
  "overflow: visible;",
  "任务浮层内部不能出现自身滚动条，滚动只允许发生在外层 40vh 浮层。",
);
assertNotIncludes(
  taskDetailDialog,
  "overflow-y: auto;",
  "任务浮层内部不能保留 overflow-y: auto。",
);
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
  "highlight-current",
  "智能体浮层树组件不能启用 Element Plus 当前节点高亮。",
);
assertNotIncludes(
  agentStatusDialog,
  ":class=\"{ active: props.selectedNode?.agentId === data.agentId }\"",
  "智能体浮层节点不能继续按 selectedNode 显示激活样式。",
);
assertNotIncludes(
  agentStatusDialog,
  ".composer-agent-node.active",
  "智能体浮层不能保留自定义激活节点样式。",
);
assertNotIncludes(
  agentStatusDialog,
  "data.taskSummary",
  "智能体浮层节点只显示智能体名称和状态，不能展示任务说明。",
);
assertNotIncludes(
  agentStatusDialog,
  "data.conversationHint",
  "智能体浮层节点只显示智能体名称和状态，不能展示对话提示。",
);
assertNotIncludes(
  agentStatusDialog,
  ".composer-agent-node:hover",
  "智能体浮层鼠标悬停不能再改变边框或背景形成激活感。",
);
assertIncludes(
  agentStatusDialog,
  ":deep(.agent-status-el-tree .el-tree-node__content)",
  "智能体浮层必须覆盖 Element Plus 树节点默认高度，避免内容被 26px 行高裁剪。",
);
assertIncludes(
  agentStatusDialog,
  "height: auto;",
  "智能体浮层树节点必须允许内容自动撑开高度。",
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
  agentStatusDialog,
  "flex-direction: row;",
  "智能体浮层节点必须把智能体名称和状态放在同一行。",
);
assertIncludes(
  agentStatusDialog,
  "justify-content: flex-start;",
  "智能体浮层节点状态必须紧跟名称后面，不能被推到浮层右侧。",
);
assertNotIncludes(
  agentStatusDialog,
  "justify-content: space-between;",
  "智能体浮层节点不能使用两端对齐，否则状态会远离名称。",
);
assertIncludes(
  agentConversationDialog,
  "agent-conversation-panel-shell",
  "智能体对话弹框必须提供稳定外壳，避免完整对话组件内容区被压缩为空。",
);
assertIncludes(
  agentConversationDialog,
  "min-height: 40vh;",
  "智能体对话弹框内容区域至少需要 40vh。",
);
assertIncludes(
  agentConversationDialog,
  ".agent-conversation-dialog .agent-conversation-panel-shell .conversation-body",
  "智能体对话弹框必须用高优先级选择器覆盖主页面 min-height: 0，确保内容区计算高度至少 40vh。",
);
assertIncludes(
  editDetailDialog,
  "composer-edit-actionbar",
  "编辑浮层必须提供 CCGUI 风格顶部操作条。",
);
assertIncludes(
  editDetailDialog,
  "撤回全部",
  "编辑浮层必须实现撤回全部入口。",
);
assertIncludes(
  editDetailDialog,
  "保存全部",
  "编辑浮层必须实现保存全部入口。",
);
assertIncludes(
  editDetailDialog,
  "composer-edit-row",
  "编辑浮层必须使用紧凑文件变更列表行。",
);
assertIncludes(
  editDetailDialog,
  "composer-edit-stat",
  "编辑浮层必须展示每个文件的增删统计。",
);
assertIncludes(
  editDetailDialog,
  "revert-all",
  "编辑浮层必须向页面暴露撤回全部事件。",
);
assertIncludes(
  editDetailDialog,
  "save-all",
  "编辑浮层必须向页面暴露保存全部事件。",
);
assertNotIncludes(
  editDetailDialog,
  "el-empty",
  "编辑浮层不能继续展示 Element Plus 大插画空态。",
);
assertNotIncludes(
  editDetailDialog,
  "composer-edit-description",
  "编辑浮层不能继续展示大段说明文案。",
);
assertIncludes(
  editDetailDialog,
  "overflow: visible;",
  "编辑浮层内部不能出现自身滚动条，滚动只允许发生在外层 40vh 浮层。",
);
assertNotIncludes(
  editDetailDialog,
  "composer-diff-view",
  "编辑浮层不能继续展示旧 diff 预览块。",
);
assertNotIncludes(
  editDetailDialog,
  "overflow-y: auto;",
  "编辑浮层内部不能保留 overflow-y: auto。",
);
assertIncludes(
  chatConversationPanel,
  "closeComposerMiniDialogOnInputFocus",
  "点击输入框时必须关闭已打开的三入口浮层。",
);
assertIncludes(
  chatPage,
  "ChatConversationPanel",
  "主对话页必须通过完整共享对话组件渲染消息、时间线、浮层和输入区。",
);
assertIncludes(
  agentConversationDialog,
  "ChatConversationPanel",
  "智能体对话弹框必须复用完整共享对话组件。",
);
assertNotIncludes(
  agentConversationDialog,
  ":messages=\"selectedAgentConversationMessages\"",
  "智能体对话弹框不能接收主会话消息列表。",
);
assertNotIncludes(
  chatPage,
  "selectedAgentConversationMessages",
  "主对话页不能把主会话消息映射给智能体弹框。",
);
assertNotIncludes(
  chatPage,
  "仍通过当前会话发送",
  "智能体弹框发送必须进入智能体子对话 API，不能继续回写主会话。",
);
assertIncludes(
  sharedConversationPanel,
  "conversation-timeline",
  "共享完整对话组件必须包含内容区左侧时间线。",
);
assertIncludes(
  sharedConversationPanel,
  "message-list",
  "共享完整对话组件必须包含消息内容区。",
);
assertIncludes(
  sharedConversationPanel,
  "composer-shell",
  "共享完整对话组件必须包含完整输入区。",
);
assertIncludes(
  sharedConversationPanel,
  "AgentStatusDialog",
  "共享完整对话组件必须包含智能体浮层入口。",
);
assertIncludes(
  sharedConversationPanel,
  "EditDetailDialog",
  "共享完整对话组件必须包含编辑浮层入口。",
);
assertIncludes(
  sharedTypes,
  "AgentSubConversationDetail",
  "共享协议必须定义当前主会话内按 agentId 隔离的智能体子对话详情。",
);
assertIncludes(
  sharedTypes,
  "PendingEditRecord",
  "共享协议必须定义可保存、撤回和对比的待确认编辑记录。",
);
assertIncludes(
  apiClient,
  "getAgentSubConversation",
  "API client 必须提供智能体子对话详情接口。",
);
assertIncludes(
  apiClient,
  "sendAgentSubConversationMessage",
  "API client 必须提供智能体子对话发送接口。",
);
assertIncludes(
  apiClient,
  "listPendingEdits",
  "API client 必须提供待确认编辑列表接口。",
);
assertIncludes(
  apiClient,
  "savePendingEdit",
  "API client 必须提供单文件保存接口。",
);
assertIncludes(
  apiClient,
  "revertPendingEdit",
  "API client 必须提供单文件撤回接口。",
);
assertIncludes(
  apiClient,
  "getPendingEditDiff",
  "API client 必须提供编辑前后对比接口。",
);
assertIncludes(
  centerRoutes,
  "/api/agent-sub-conversation/detail",
  "中心服务必须注册智能体子对话详情接口。",
);
assertIncludes(
  centerRoutes,
  "/api/agent-sub-conversation/message/send",
  "中心服务必须注册智能体子对话发送接口。",
);
assertIncludes(
  centerRoutes,
  "/api/edit-pending/list",
  "中心服务必须注册待确认编辑列表接口。",
);
assertIncludes(
  centerRoutes,
  "/api/edit-pending/save",
  "中心服务必须注册待确认编辑保存接口。",
);
assertIncludes(
  centerRoutes,
  "/api/edit-pending/revert",
  "中心服务必须注册待确认编辑撤回接口。",
);
assertIncludes(
  centerRoutes,
  "/api/edit-pending/diff",
  "中心服务必须注册待确认编辑对比接口。",
);
assertIncludes(
  centerDatabase,
  "agent_sub_conversation_messages",
  "中心服务数据库必须创建智能体子对话消息事实表。",
);
assertIncludes(
  centerDatabase,
  "pending_edit_records",
  "中心服务数据库必须创建待确认编辑事实表。",
);
assertIncludes(
  centerEditDomain,
  "recordPendingFileEdit",
  "中心服务必须提供真实文件编辑后的待确认记录写入能力。",
);
assertIncludes(
  centerEditDomain,
  "INSERT INTO pending_edit_records",
  "真实文件编辑发生后必须向 pending_edit_records 落库，不能只提供空列表接口。",
);
assertIncludes(
  centerRoutes,
  "revertPendingEdit",
  "中心服务待确认编辑撤回必须走真实文件恢复逻辑。",
);
assertIncludes(
  centerRoutes,
  "PENDING_EDIT_FILE_MISSING",
  "撤回编辑时必须处理文件缺失，不能让读取异常直接打断路由。",
);
assertIncludes(
  centerRoutes,
  "PENDING_EDIT_CONFLICT",
  "撤回编辑时必须检测当前文件已再次变更的冲突。",
);
assertIncludes(
  ideaBridge,
  "openEditDiff",
  "IDEA 插件桥接必须提供打开编辑前后对比的原生 diff 能力。",
);
assertNotIncludes(
  agentConversationDialog,
  "agent-dialog-composer-shell",
  "智能体对话弹框不能保留独立输入框外壳。",
);
assertNotIncludes(
  agentConversationDialog,
  "agent-dialog-entry-strip",
  "智能体对话弹框不能保留独立三入口条。",
);
assertIncludes(
  sharedConversationPanel,
  "class=\"composer-shell\"",
  "共享完整对话组件必须承载主输入框外壳。",
);
assertIncludes(
  sharedConversationPanel,
  "composer-context-progress",
  "共享完整对话组件必须承载上下文进度显示。",
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
assertIncludes(
  planDoc,
  "- [x] 修复本轮输入区浮层滚动、编辑文字化、焦点释放和圆角回归",
  "计划.md 必须记录并勾选本轮输入区浮层反馈修复任务。",
);

console.log("对话输入区 token、三入口和下拉描述回归检查通过。");
