# 轮次状态收敛器实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让多端对话页面始终以中心服务轮次事实为准收敛运行态，避免“当前轮次已耗时”和“停止”按钮在终态后残留。

**架构：** 中心服务新增轻量轮次状态查询和统一终态事件，前端新增 `TurnStateReconciler` 统一管理运行态确认、疑似失联追赶和终态收敛。完整会话快照只用于恢复消息和事件，运行态是否继续展示由轻量状态事实决定。

**技术栈：** Fastify/WebSocket 中心服务、SQLite 会话事实源、Pinia/Vue 前端状态、现有静态回归脚本。

---

### 任务 1：静态回归脚本

**文件：**
- 创建：`scripts/check-turn-state-reconciler-regression.mjs`
- 修改：`package.json`

- [ ] **步骤 1：编写失败的静态回归脚本**

```js
import {readFileSync} from "node:fs";
import {join} from "node:path";

const rootDirectory = process.cwd();

function readProjectFile(pathInProject) {
  return readFileSync(join(rootDirectory, pathInProject), "utf8");
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function assertIncludes(source, pattern, message) {
  if (!source.includes(pattern)) {
    fail(message);
  }
}

const syncRouteSource = readProjectFile("services/center/src/api/sync-route.ts");
const sessionDomainSource = readProjectFile("services/center/src/domain/session-domain.ts");
const appSource = readProjectFile("apps/frontend/src/stores/app.ts");
const conversationActionsSource = readProjectFile("apps/frontend/src/stores/app-conversation-actions.ts");
const reconcilerSource = readProjectFile("apps/frontend/src/stores/TurnStateReconciler.ts");

assertIncludes(syncRouteSource, "session.turn.state", "WebSocket 必须提供 session.turn.state 轻量轮次状态请求。");
assertIncludes(sessionDomainSource, "turn.state.changed", "轮次终态必须追加统一 turn.state.changed 事件。");
assertIncludes(conversationActionsSource, "TurnStateReconciler", "会话动作必须接入 TurnStateReconciler。");
assertIncludes(reconcilerSource, "SUSPECTED_STALE_FAST_INTERVAL_MS = 20", "疑似失联阶段必须使用 20ms 快速追赶。");
assertIncludes(reconcilerSource, "CONFIRMED_RUNNING_INTERVAL_MS", "确认运行态必须使用低频事实对账。");
assertIncludes(reconcilerSource, "stopRunningTurnSnapshotRecovery", "新收敛器必须替代旧完整快照轮询入口。");
assertIncludes(appSource, "turn.state.changed", "实时事件处理必须识别统一轮次状态事件。");
```

- [ ] **步骤 2：运行脚本确认失败**

运行：`node scripts/check-turn-state-reconciler-regression.mjs`
预期：失败，至少提示缺少 `TurnStateReconciler.ts`。

- [ ] **步骤 3：加入根脚本入口**

在 `package.json` 的 `scripts` 中加入：

```json
"check:turn-state-reconciler": "node scripts/check-turn-state-reconciler-regression.mjs"
```

### 任务 2：中心服务轻量状态事实源

**文件：**
- 修改：`services/center/src/domain/session-domain.ts`
- 修改：`services/center/src/api/sync-route.ts`

- [ ] **步骤 1：新增轮次状态查询函数**

在 `session-domain.ts` 新增 `getActiveTurnState`，从 `SessionRepository` 读取当前会话最后一个未结束运行态轮次、最近事件序号、最近活动时间和最近助手消息时间。

- [ ] **步骤 2：统一终态事件**

在 `updateTurnStatus` 写入既有 `turn.updated` 后追加 `turn.state.changed`，payload 直接包含 `sessionId`、`turnId`、`status`、`endedAt`、`durationMs`、`taskId`、`lastSequence`。

- [ ] **步骤 3：WebSocket 接口**

在 `sync-route.ts` 增加 `session.turn.state` 请求，返回 `getActiveTurnState`。该接口只返回轻量状态，不拉完整 `messages/events/tasks`。

### 任务 3：前端状态收敛器

**文件：**
- 创建：`apps/frontend/src/stores/TurnStateReconciler.ts`
- 修改：`apps/frontend/src/stores/app-types.ts`
- 修改：`apps/frontend/src/stores/app.ts`
- 修改：`apps/frontend/src/stores/app-conversation-actions.ts`

- [ ] **步骤 1：创建收敛器类**

`TurnStateReconciler` 负责单会话单轮次状态机：

```text
idle -> optimisticRunning -> confirmedRunning -> suspectedStale -> terminal
```

确认运行态低频对账，疑似失联阶段 20ms 快速请求 `session.turn.state`。收到终态、助手消息或完整快照终态后停止。

- [ ] **步骤 2：替换旧快照轮询**

保留旧公开方法名 `startRunningTurnSnapshotRecovery` / `stopRunningTurnSnapshotRecovery`，内部委托到收敛器，避免大范围改调用点。

- [ ] **步骤 3：实时事件接入**

收到 `message.created` 助手消息、`turn.updated`、`turn.state.changed`、`task.updated` 终态时通知收敛器，必要时加载完整快照。

### 任务 4：文档同步和验证

**文件：**
- 修改：`需求.md`
- 修改：`设计.md`
- 修改：`功能清单与关系.md`

- [ ] **步骤 1：同步需求和设计**

补充“轻量轮次状态事实源”和“前端状态收敛器”的设计约束。

- [ ] **步骤 2：同步功能清单**

更新“轮次失败收尾与运行中恢复”的依赖和最小回归范围。

- [ ] **步骤 3：验证**

运行：

```bash
node scripts/check-turn-state-reconciler-regression.mjs
```

预期：退出码 0。
