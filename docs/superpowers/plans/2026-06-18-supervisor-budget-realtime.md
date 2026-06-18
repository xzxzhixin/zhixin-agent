# 监督预算与实时渲染修正实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 修正监督层预算为三个 6，并在续跑成功后重置预算，同时让前端过程事件实时渲染。

**架构：** 中心服务继续由 `DeepAgentTurnSupervisor` 负责预算计数和完成判断，默认预算从 `deepagents-agent.ts` 注入。前端继续以 WebSocket `event.appended` 为实时事实入口，合并时统一刷新全局事件数组新引用并递增事件版本号。

**技术栈：** TypeScript、Vue 3、Pinia、Deep Agents、WebSocket 实时同步。

---

## 文件结构

- `services/center/src/deepagents-agent.ts`：修改默认监督预算，三个字段固定为 6。
- `services/center/src/agent-runtime/DeepAgentTurnSupervisor.ts`：增加续跑成功后重置预算计数的逻辑。
- `apps/frontend/src/stores/app.ts`：保存 `eventsRevision` 事件写入版本号。
- `apps/frontend/src/stores/app-conversation-actions.ts`：实时事件合并后统一写入全局事件数组新引用并递增版本号。
- `apps/frontend/src/views/Chat/useChatConversation.ts`：读取 `eventsRevision`，确保过程卡片 computed 立即重算。
- `需求.md`：同步预算和实时渲染需求口径。
- `设计.md`：同步本次修正设计。
- `架构.md`：同步监督层预算和前端事件响应式约束。
- `功能清单与关系.md`：同步两个可回归功能的关注点。

### 任务 1：后端监督预算

**文件：**
- 修改：`services/center/src/deepagents-agent.ts`
- 修改：`services/center/src/agent-runtime/DeepAgentTurnSupervisor.ts`

- [ ] **步骤 1：修改默认预算**

将 `createDefaultSupervisorBudget()` 返回值改为三个字段全部为 `6`。

- [ ] **步骤 2：增加成功重置逻辑**

在 `DeepAgentTurnSupervisor` 中记录最近消耗预算的原因。每次候选进入完成网关前，若候选不再命中该原因，重置当前预算窗口计数、清零两个分类计数并清空最近原因。

- [ ] **步骤 3：保持同类失败消耗预算**

在 `increaseBudgetCounter` 内记录当前预算原因，确保同一原因连续出现时不会被重置。

### 任务 2：前端实时事件响应式合并

**文件：**
- 修改：`apps/frontend/src/stores/app-conversation-actions.ts`

- [ ] **步骤 1：抽取事件写入辅助**

新增 `writeMergedEvents(events: EventRecord[]): void`，统一排序、写入 `this.events` 新数组引用并递增 `eventsRevision`。

- [ ] **步骤 2：应用到实时和快照合并**

`replaceRealtimeEvent` 和 `mergeSnapshotEvents` 都使用同一写入方式，避免实时事件和快照事件走不同响应式入口；`useChatConversation` 显式读取 `eventsRevision`。

### 任务 3：事实源同步

**文件：**
- 修改：`需求.md`
- 修改：`设计.md`
- 修改：`架构.md`
- 修改：`功能清单与关系.md`

- [ ] **步骤 1：同步需求**

补充监督预算三个字段为 6、续跑成功重置预算、实时事件需刷新全局事件数组新引用。

- [ ] **步骤 2：同步设计和架构**

把规格设计要点写入 `设计.md`；在 `架构.md` 的 agent-runtime 和 WebSocket 事件响应式段落补充约束。

- [ ] **步骤 3：同步功能清单**

更新 `Agent 任务完成监督` 和 `对话过程事件实时渲染` 两条回归关注点。

### 任务 4：静态自查与提交推送

**文件：**
- 检查：上述所有修改文件

- [ ] **步骤 1：静态检索预算和引用**

运行 `rg "maxSupervisorAttempts|continuationRetryBudget|toolFailureRetryBudget|resetBudgetCountersAfterProgress|writeMergedEvents" services apps docs 需求.md 设计.md 架构.md 功能清单与关系.md`。

- [ ] **步骤 2：查看 diff**

运行 `git diff -- services/center/src/deepagents-agent.ts services/center/src/agent-runtime/DeepAgentTurnSupervisor.ts apps/frontend/src/stores/app-conversation-actions.ts 需求.md 设计.md 架构.md 功能清单与关系.md docs/superpowers/specs/2026-06-18-supervisor-budget-realtime-design.md docs/superpowers/plans/2026-06-18-supervisor-budget-realtime.md`。

- [ ] **步骤 3：按用户要求跳过测试和构建**

不运行测试，不运行构建。

- [ ] **步骤 4：提交并推送**

提交本次范围内文件并推送。
