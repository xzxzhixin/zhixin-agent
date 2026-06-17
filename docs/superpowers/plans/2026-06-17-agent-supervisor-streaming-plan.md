# Agent 任务监督与实时过程渲染实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 新增中心服务任务监督层，把 Deep Agents 单次 graph 停止改为候选终态，并保证过程事件运行中实时渲染。

**架构：** 后端新增 `AgentCompletionGate` 与 `DeepAgentTurnSupervisor`，`deepagents-agent.ts` 只负责创建一次 Deep Agents 运行候选并交给 Supervisor 判断。前端保持 `event.appended` 为实时事实入口，补齐事件合并回归检查和快照覆盖保护。

**技术栈：** TypeScript、Deep Agents、LangChain、Pinia、Vue 3、pnpm 脚本检查、IDEA Run Configuration `dev:desktop-shell`、Chrome DevTools 浏览器验收。

---

## 文件结构

- 创建：`services/center/src/agent-runtime/AgentRunCandidate.ts`
  - 职责：定义单次 Deep Agents 运行候选、模型诊断摘要、工具事件摘要和完成网关判定结果。
- 创建：`services/center/src/agent-runtime/AgentCompletionGate.ts`
  - 职责：基于候选结果判断 `completed`、`continue`、`retry`、`waiting_user`、`failed`，不读取用户提示词，不恢复工具调用。
- 创建：`services/center/src/agent-runtime/DeepAgentTurnSupervisor.ts`
  - 职责：在同一轮次同一任务下循环运行候选、追加内部续跑提示、管理预算和终态收尾。
- 创建：`services/center/src/agent-runtime/index.ts`
  - 职责：聚合导出 agent-runtime 运行期类型和类。
- 修改：`services/center/src/deepagents-agent.ts`
  - 职责：把一次 Deep Agents 运行拆成可复用候选函数，移除正则式半截意图失败主路径，终态交给 Supervisor。
- 修改：`services/center/src/AgentMiddleware/CenterToolChoiceMiddleware.ts`
  - 职责：把最后一次模型诊断写回当前工具执行上下文，供候选结果读取。
- 修改：`services/center/src/StructuredTool/deepagents-tool-runtime.ts` 或相关上下文类型文件
  - 职责：给 `DeepAgentsToolExecutionContext` 增加本轮模型诊断暂存字段。
- 修改：`apps/frontend/src/stores/app-conversation-actions.ts`
  - 职责：确保实时事件合并不被快照旧事件覆盖，补齐运行中过程事件即时展示入口。
- 创建：`scripts/check-center-agent-supervisor-continuation.mjs`
  - 职责：静态和轻量行为检查监督层接口、预算、非法工具形态处理和最终消息固化边界。
- 创建：`scripts/check-frontend-realtime-event-merge.mjs`
  - 职责：检查前端 WebSocket `event.appended` 即时合并、快照保护和终态兜底逻辑。
- 修改：`package.json`
  - 职责：增加上述两个检查脚本入口，不加入 `tsc --noEmit` 或 `vue-tsc`。
- 修改：`需求.md`、`设计.md`、`架构.md`、`功能清单与关系.md`
  - 职责：同步任务监督、完成标准和实时过程渲染事实源。
- 测试记录：`启动进程.md`、`浏览器页面.md`
  - 职责：按项目测试规范记录 IDEA 启动进程和浏览器页面。

## 任务 1：写失败检查脚本

**文件：**
- 创建：`scripts/check-center-agent-supervisor-continuation.mjs`
- 创建：`scripts/check-frontend-realtime-event-merge.mjs`
- 修改：`package.json`

- [ ] **步骤 1：编写后端失败检查脚本**

`scripts/check-center-agent-supervisor-continuation.mjs` 必须读取目标源码并检查这些事实：

```javascript
import fs from "node:fs";

const gatePath = "services/center/src/agent-runtime/AgentCompletionGate.ts";
const supervisorPath = "services/center/src/agent-runtime/DeepAgentTurnSupervisor.ts";
const agentPath = "services/center/src/deepagents-agent.ts";

function read(path) {
  if (!fs.existsSync(path)) {
    throw new Error(`缺少文件：${path}`);
  }
  return fs.readFileSync(path, "utf8");
}

const gate = read(gatePath);
const supervisor = read(supervisorPath);
const agent = read(agentPath);

if (!gate.includes("class AgentCompletionGate")) {
  throw new Error("AgentCompletionGate 必须用 class 组织完成标准。");
}

if (!gate.includes("protocolRetryBudget")) {
  throw new Error("完成网关必须包含协议形态重试预算。");
}

if (!gate.includes("containsTextToolShape")) {
  throw new Error("完成网关必须识别普通文本里的伪工具形态，但不能恢复工具。");
}

if (gate.includes("mcp__chrome") || gate.includes("github")) {
  throw new Error("完成网关不能硬编码具体 MCP 工具或用户场景。");
}

if (!supervisor.includes("class DeepAgentTurnSupervisor")) {
  throw new Error("DeepAgentTurnSupervisor 必须用 class 组织监督循环。");
}

if (!supervisor.includes("maxSupervisorAttempts")) {
  throw new Error("Supervisor 必须包含总续跑预算。");
}

if (!agent.includes("DeepAgentTurnSupervisor")) {
  throw new Error("deepagents-agent.ts 必须把终态交给 Supervisor。");
}

if (agent.includes("isIncompleteToolIntentText(")) {
  throw new Error("旧的窄正则半截意图判断不能继续作为主路径。");
}
```

- [ ] **步骤 2：编写前端失败检查脚本**

`scripts/check-frontend-realtime-event-merge.mjs` 必须读取前端 store 并检查这些事实：

```javascript
import fs from "node:fs";

const storePath = "apps/frontend/src/stores/app-conversation-actions.ts";
const store = fs.readFileSync(storePath, "utf8");

if (!store.includes("replaceRealtimeEvent(event)")) {
  throw new Error("WebSocket event.appended 必须立即合并实时事件。");
}

if (!store.includes("mergeSnapshotEvents")) {
  throw new Error("快照事件必须和实时事件合并，不能用旧快照覆盖运行中事件。");
}

if (!store.includes("event.sequence")) {
  throw new Error("实时事件合并必须保留 sequence 排序。");
}

if (!store.includes("model.stream.completed")) {
  throw new Error("模型流结束仍需要快照兜底。");
}
```

- [ ] **步骤 3：注册检查脚本**

`package.json` scripts 增加：

```json
"check:agent-supervisor": "node scripts/check-center-agent-supervisor-continuation.mjs",
"check:frontend-realtime-event-merge": "node scripts/check-frontend-realtime-event-merge.mjs"
```

- [ ] **步骤 4：运行脚本确认红灯**

运行：

```powershell
pnpm check:agent-supervisor
pnpm check:frontend-realtime-event-merge
```

预期：两个脚本都失败，分别提示缺少监督层文件和缺少 `mergeSnapshotEvents`。

## 任务 2：实现后端候选结果与完成网关

**文件：**
- 创建：`services/center/src/agent-runtime/AgentRunCandidate.ts`
- 创建：`services/center/src/agent-runtime/AgentCompletionGate.ts`
- 创建：`services/center/src/agent-runtime/index.ts`

- [ ] **步骤 1：定义候选结果类型**

创建 `AgentRunCandidate.ts`，包含候选文本、工具摘要、模型诊断和判定枚举。接口字段必须逐项写中文注释，数组和对象多行格式。

- [ ] **步骤 2：实现完成网关最小逻辑**

创建 `AgentCompletionGate.ts`，实现：

```typescript
export class AgentCompletionGate {
    public evaluate(candidate: AgentRunCandidate): AgentCompletionDecision {
        if (candidate.cancelled) {
            return {
                status: "failed",
                reason: "TURN_CANCELLED",
            };
        }
        if (this.containsTextToolShape(candidate.visibleText)) {
            return this.retryOrFail(candidate, "TEXT_TOOL_SHAPE");
        }
        if (candidate.hasPendingTaskState) {
            return this.continueOrFail(candidate, "TASK_STILL_RUNNING");
        }
        if (!candidate.hasStructuredToolCall && candidate.isProcessTextOnly) {
            return this.continueOrFail(candidate, "PROCESS_TEXT_ONLY");
        }
        return {
            status: "completed",
            reason: "FINAL_TEXT_READY",
        };
    }
}
```

要求：`containsTextToolShape` 只识别通用字段形态，例如对象里同时出现 `name` 与 `args`、或 content text 中出现工具调用块摘要；不能返回工具名，不能生成工具参数。

- [ ] **步骤 3：聚合导出**

`index.ts` 导出所有 agent-runtime 类型和类。

- [ ] **步骤 4：运行后端检查确认仍红灯但错误推进**

运行：

```powershell
pnpm check:agent-supervisor
```

预期：不再报缺少 `AgentCompletionGate`，仍报缺少 `DeepAgentTurnSupervisor` 或 `deepagents-agent.ts` 未接入。

## 任务 3：实现 Supervisor 并接入 Deep Agents 执行

**文件：**
- 创建：`services/center/src/agent-runtime/DeepAgentTurnSupervisor.ts`
- 修改：`services/center/src/deepagents-agent.ts`
- 修改：`services/center/src/AgentMiddleware/CenterToolChoiceMiddleware.ts`
- 修改：`services/center/src/StructuredTool/index.ts` 或上下文定义所在文件

- [ ] **步骤 1：给上下文增加模型诊断暂存**

在 `DeepAgentsToolExecutionContext` 中增加 `lastModelMessageDiagnostics` 字段或 setter 方法。字段注释说明来源是 `CenterToolChoiceMiddleware.afterModel`，只用于诊断和完成网关，不用于恢复工具。

- [ ] **步骤 2：Middleware 写入上下文**

`CenterToolChoiceMiddleware.afterModel` 在构造诊断后同步写入上下文，仍保留现有事件落库。

- [ ] **步骤 3：拆出单次候选运行函数**

`deepagents-agent.ts` 将现有 `runDeepAgentsAgentTurn` 内部一次运行拆成 `runSingleDeepAgentCandidate`，返回 `AgentRunCandidate`。该函数负责创建上下文、创建 Deep Agent、收集流式文本、工具事件和输出状态，不调用 `finalizeDeepAgentTurn`。

- [ ] **步骤 4：实现监督循环**

`DeepAgentTurnSupervisor` 接收 `runCandidate` 回调和 `finalize/fail/waiting` 回调。预算内根据 `AgentCompletionGate.evaluate` 决策继续或重试；重试提示只作为下一次模型输入的内部上下文，不写 `messages` 表。

- [ ] **步骤 5：接入主入口**

`runDeepAgentsAgentTurn` 创建 Supervisor，并把终态收尾委托给 Supervisor。移除旧 `isIncompleteToolIntentText` 主路径和 `failIncompleteToolIntentTurn` 主路径。

- [ ] **步骤 6：运行后端检查确认绿灯**

运行：

```powershell
pnpm check:agent-supervisor
```

预期：退出码 0。

## 任务 4：修复前端快照覆盖与实时事件回归

**文件：**
- 修改：`apps/frontend/src/stores/app-conversation-actions.ts`

- [ ] **步骤 1：新增快照事件合并函数**

新增 `mergeSnapshotEvents(snapshotEvents: EventRecord[]): void`，按 `eventId` 去重，保留实时事件和快照事件中 `sequence` 较新的记录，再按 `sequence` 排序后赋新数组引用。

- [ ] **步骤 2：替换快照直接赋值**

把 `loadActiveSessionSnapshot` 和 `refreshEvents` 中直接 `this.events = result.events` 改成调用 `mergeSnapshotEvents`，清理会话和切换会话场景保留直接清空。

- [ ] **步骤 3：确认实时事件入口不等待终态**

保留 `event.appended` 分支中的 `replaceRealtimeEvent(event)` 在任何终态判断之前执行，确保模型流式片段和工具事件先进入 `events`。

- [ ] **步骤 4：运行前端检查确认绿灯**

运行：

```powershell
pnpm check:frontend-realtime-event-merge
```

预期：退出码 0。

## 任务 5：同步事实源文档

**文件：**
- 修改：`需求.md`
- 修改：`设计.md`
- 修改：`架构.md`
- 修改：`功能清单与关系.md`

- [ ] **步骤 1：更新需求**

在 `需求.md` 单层清单中补充或修订任务完成标准、监督预算、过程文本实时展示和非法工具形态不恢复工具的验收口径。

- [ ] **步骤 2：更新设计**

在 `设计.md` 增加一级标题“Agent 任务监督与实时过程渲染设计”，内容和规格文档保持一致。

- [ ] **步骤 3：更新架构**

在 `架构.md` 中心服务源码目录边界补充 `services/center/src/agent-runtime` 职责，说明 Supervisor/CompletionGate 是 Deep Agents 外围任务监督层。

- [ ] **步骤 4：更新功能清单**

在 `功能清单与关系.md` 增加单一可回归功能：`Agent 任务完成监督` 和 `对话过程事件实时渲染`，列明依赖、影响范围和最小回归。

## 任务 6：验证、IDEA 启动和浏览器验收

**文件：**
- 修改：`启动进程.md`
- 修改：`浏览器页面.md`

- [ ] **步骤 1：运行检查脚本**

运行：

```powershell
pnpm check:agent-supervisor
pnpm check:frontend-realtime-event-merge
pnpm check:turn-state-reconciler
```

预期：全部退出码 0。

- [ ] **步骤 2：关闭旧桌面壳和中心服务**

检查并关闭旧 `electron`、`node scripts/dev-desktop-shell.mjs`、监听 `8866` 的中心服务进程。不能删除数据库或中心目录。

- [ ] **步骤 3：用 IDEA Run Configuration 启动**

使用 IDEA MCP 执行 Run Configuration：

```text
dev:desktop-shell
```

记录 `启动进程.md`，格式：

```text
{pid} = {port} = pnpm dev:desktop-shell
```

- [ ] **步骤 4：浏览器真实验收**

使用 Chrome DevTools 打开本地应用页面，记录 `浏览器页面.md`：

```text
{pageId} = {pageUrl}
```

真实点击进入 `项目对话测试` 项目对话，分别发送三种不同提示词：

```text
用可控浏览器打开 GitHub Trending，筛选今天 AI/LLM/Agent 相关项目，给我工具和思想总结。
打开 GitHub 搜索最近更新的 agent workflow 项目，整理值得参考的能力点。
用浏览器查看 GitHub 上和 Deep Agents 相关的公开项目，判断有什么可借鉴的执行链路。
```

验收观察：

- 运行中出现模型中途 Markdown 或工具过程卡片。
- 工具请求、工具执行和工具结果卡片在最终助手消息前出现。
- 如果模型只返回过程文本或非法工具形态，本轮不会立即完成。
- 最终回复出现后轮次终态收敛，发送按钮恢复。

- [ ] **步骤 5：提交和推送**

运行：

```powershell
git status --short
git pull --rebase
git add .
git commit -m "fix: 增加 Agent 任务监督与实时过程渲染"
git push
```

提交前不要强制加入 `.gitignore` 忽略文件；远端领先时先 rebase。
