# 执行图过程与任务拆解分离实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** Deep Agents 图节点只写过程事件，`task_steps` 只保存用户可见拆解步骤，避免执行态和终态混用。

**架构：** 中心服务新增计划步骤创建入口和 graph node 过程事件入口；todoList 使用计划步骤入口；Deep Agents 节点执行器改写 graph 过程事件；前端过程卡片消费 graph node 事件。

**技术栈：** Node.js、TypeScript、Fastify、better-sqlite3、Vue 3、Vite、Chrome DevTools。

---

## 文件结构

- 修改 `需求.md`：新增产品事实源。
- 修改 `设计.md`：新增本轮独立设计与清单状态。
- 修改 `架构.md`：更新 `task_steps` 与 Deep Agents graph 事件边界。
- 修改 `services/center/src/domain/session-domain.ts`：新增用户可见步骤创建参数与 graph node 过程事件 helper，替换 Deep Agents graph 节点的步骤写入。
- 修改 `services/center/src/data-access/session-repository.ts`：让创建步骤支持显式初始状态，并去掉创建步骤时隐式更新任务主状态的副作用。
- 修改 `services/center/src/tools/todo-list-tool.ts`：todoList 新建步骤按模型状态直接创建，不再先 running 再回写。
- 修改 `services/center/src/domain/session-guidance-domain.ts`：继续创建用户可见引导步骤，保持重规划语义。
- 修改 `apps/frontend/src/views/Chat/chat-view-helpers.ts`：把 `graph.node.*` 纳入过程卡片聚合与状态展示。
- 更新 `scripts/check-*.mjs` 中与 graph/task step 边界相冲突的静态回归断言。

### 任务 1：文档事实源

**文件：**
- 修改：`需求.md`
- 修改：`设计.md`
- 修改：`架构.md`

- [ ] **步骤 1：写入需求、设计和架构口径**

将“执行图过程和用户可见任务拆解分离”写入三份事实源；`设计.md` 标题使用 `# 执行图过程与用户可见任务拆解分离设计`。

- [ ] **步骤 2：静态检查文档状态**

运行：`rg -n "执行图过程|graph.node|task_steps.*只保存|Chrome DevTools 验收" 需求.md 设计.md 架构.md`

预期：能定位到本轮新增口径，且清单状态使用 `⏳`。

### 任务 2：后端步骤创建和 graph 过程事件

**文件：**
- 修改：`services/center/src/data-access/session-repository.ts`
- 修改：`services/center/src/domain/session-domain.ts`

- [ ] **步骤 1：编写失败的静态回归检查**

新增或修改现有检查脚本，断言 `thinkingContext`、`modelStream`、`toolPlan` 节点不再调用 `createTaskStep(`，并断言存在 `graph.node.started` 和 `graph.node.completed`。

运行：`node scripts/check-center-graph-checkpoint-regression.mjs`

预期：修改生产代码前失败，提示 graph 节点仍写入 `task_steps` 或缺少 graph node 事件。

- [ ] **步骤 2：实现 graph node 事件 helper**

在 `session-domain.ts` 增加 graph node 过程事件 helper。事件字段必须包含 `sessionId`、`turnId`、`taskId`、`payload.graph`、节点标题和状态。

- [ ] **步骤 3：替换 Deep Agents graph 节点步骤写入**

把 `thinkingContext`、`modelStream`、`toolPlan` 中的 `createTaskStep` 和对应 `updateTaskStep` 改为 graph node 事件。`modelStream` 异常时写 `graph.node.failed`。

- [ ] **步骤 4：运行回归检查确认通过**

运行：`node scripts/check-center-graph-checkpoint-regression.mjs`

预期：退出码 0。

### 任务 3：todoList 用户可见步骤状态

**文件：**
- 修改：`services/center/src/data-access/session-repository.ts`
- 修改：`services/center/src/domain/session-domain.ts`
- 修改：`services/center/src/tools/todo-list-tool.ts`

- [ ] **步骤 1：编写失败的 todoList 回归检查**

更新 `scripts/check-current-long-task-websocket-agent-regression.mjs`，断言 todoList 新建步骤使用显式初始状态，且不要求创建时写 `task.step.started`。

运行：`node scripts/check-current-long-task-websocket-agent-regression.mjs`

预期：修改生产代码前失败，提示 todoList 仍先 running 再更新。

- [ ] **步骤 2：让仓储创建步骤支持初始状态**

`SessionRepository.createTaskStep` 增加 `status`、`endedAt` 和 `summary` 输入；创建时不再调用 `updateTaskStatus`。中文注释说明任务主状态由 worker/task 生命周期维护。

- [ ] **步骤 3：让领域创建步骤支持计划态**

`createTaskStep` 支持 `initialStatus` 和 `summary` 选项；非 running 状态写 `task.step.created`，running 状态继续写 `task.step.started`。

- [ ] **步骤 4：todoList 按模型状态直接创建步骤**

`todo-list-tool.ts` 新建步骤时传入 `initialStatus: item.status`，删除新建后立刻 `updateTaskStep` 的回写。

- [ ] **步骤 5：运行回归检查确认通过**

运行：`node scripts/check-current-long-task-websocket-agent-regression.mjs`

预期：退出码 0。

### 任务 4：前端过程聚合

**文件：**
- 修改：`apps/frontend/src/views/Chat/chat-view-helpers.ts`

- [ ] **步骤 1：编写失败的前端静态检查**

更新前端回归检查，断言 `graph.node.started`、`graph.node.completed`、`graph.node.failed` 属于可见过程事件。

运行：`node scripts/check-dialog-agent-workflow-regression.mjs`

预期：修改生产代码前失败。

- [ ] **步骤 2：实现 graph node 过程卡片聚合**

`isVisibleProcessEvent` 包含 `graph.node.*`；`resolveProcessGroupKey` 按 `payload.graph.nodeId` 聚合；`resolveProcessGroupTitle` 展示 graph node 标题；状态解析复用事件 status。

- [ ] **步骤 3：运行前端回归检查确认通过**

运行：`node scripts/check-dialog-agent-workflow-regression.mjs`

预期：退出码 0。

### 任务 5：集成验证与浏览器验收

**文件：**
- 修改：`启动进程.md`（如启动开发进程）
- 修改：`浏览器页面.md`（如打开浏览器页面）

- [ ] **步骤 1：运行静态回归检查**

运行：

```bash
node scripts/check-center-graph-checkpoint-regression.mjs
node scripts/check-current-long-task-websocket-agent-regression.mjs
node scripts/check-dialog-agent-workflow-regression.mjs
pnpm --filter @zhixin/frontend build
```

预期：所有命令退出码 0；Vite chunk warning 只作为体积提示，不算失败。

- [ ] **步骤 2：启动桌面验收环境**

先关闭旧桌面壳和中心服务进程，再运行：

```bash
pnpm dev:frontend
pnpm dev:desktop-shell
```

把进程记录到 `启动进程.md`。

- [ ] **步骤 3：使用 Chrome DevTools 验收**

通过 Chrome DevTools 打开本地页面，按真实用户路径发送会话消息、等待过程卡片和任务入口更新，记录页面到 `浏览器页面.md`。

预期：graph node 过程进入过程卡片；任务浮窗只展示 todoList 或用户引导产生的用户可见拆解步骤；任务完成后不残留“执行中”；任务浮窗右侧只显示耗时。
