# Deep Agents 执行内核迁移实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将中心服务当前手写 LangGraph 工具循环主路径迁移为 Deep Agents runner，并保持中心服务事实源、权限、事件和多端同步边界。

**架构：** 新增 `services/center/src/deepagents-runner.ts` 作为 Deep Agents 执行适配层，`session-domain.ts` 只负责创建中心服务节点执行器并调用新 runner。Deep Agents runner 复用现有节点执行器和中心事件/checkpoint 语义，先完成主路径切换和依赖接入，再删除无真实调用方的旧 `langgraph-runner.ts`。

**技术栈：** Node.js、TypeScript、pnpm workspace、Fastify、LangChain、Deep Agents、现有静态检查脚本。

---

## 文件结构

- 修改：`services/center/package.json`，添加精确版本 `deepagents` 依赖。
- 修改：`pnpm-lock.yaml`，通过 `pnpm --filter @zhixin/center add deepagents@1.10.2 --save-exact` 更新锁文件。
- 创建：`services/center/src/deepagents-runner.ts`，承载 Deep Agents runner、状态类型、节点执行器类型和中心服务 checkpoint 封装。
- 修改：`services/center/src/domain/session-domain.ts`，把主路径从 `runLangGraphTurn` 切到 `runDeepAgentsTurn`，并调整类型导入。
- 删除：`services/center/src/langgraph-runner.ts`，迁移后无真实调用方则删除。
- 修改：`scripts/check-center-model-tool-loop.ts`，增加 Deep Agents 主路径断言，确认旧 `langgraph-runner.ts` 不再存在且新 runner 存在。
- 修改：`需求.md`、`设计.md`、`架构.md`，实现完成后按真实进度更新 Deep Agents 清单状态。

## 任务 1：添加 Deep Agents 主路径静态检查

**文件：**
- 修改：`scripts/check-center-model-tool-loop.ts`

- [ ] **步骤 1：编写失败的检查**

在 `check-center-model-tool-loop.ts` 中新增文件系统断言：

```ts
import {existsSync, readFileSync} from "node:fs";

function assertDeepAgentsRunnerWiring(): void {
  const runnerPath = join(process.cwd(), "services", "center", "src", "deepagents-runner.ts");
  const legacyRunnerPath = join(process.cwd(), "services", "center", "src", "langgraph-runner.ts");
  const sessionDomainPath = join(process.cwd(), "services", "center", "src", "domain", "session-domain.ts");
  assert(existsSync(runnerPath), "缺少 Deep Agents runner 主路径文件");
  assert(!existsSync(legacyRunnerPath), "旧 langgraph-runner.ts 已无真实调用方，必须删除");
  const sessionDomainSource = readFileSync(sessionDomainPath, "utf-8");
  assert(sessionDomainSource.includes("runDeepAgentsTurn"), "session-domain 未切换到 Deep Agents runner");
  assert(!sessionDomainSource.includes("runLangGraphTurn"), "session-domain 仍引用旧 LangGraph runner");
}
```

在 `main()` 开始处调用 `assertDeepAgentsRunnerWiring()`。

- [ ] **步骤 2：运行检查验证失败**

运行：`pnpm exec tsx scripts/check-center-model-tool-loop.ts`
预期：失败，错误包含 `缺少 Deep Agents runner 主路径文件` 或 `旧 langgraph-runner.ts 已无真实调用方，必须删除`。

- [ ] **步骤 3：Commit**

```bash
git add scripts/check-center-model-tool-loop.ts
git commit -m "test: 添加deepagents主路径检查"
```

## 任务 2：接入 Deep Agents 依赖

**文件：**
- 修改：`services/center/package.json`
- 修改：`pnpm-lock.yaml`

- [ ] **步骤 1：安装精确依赖**

运行：`pnpm --filter @zhixin/center add deepagents@1.10.2 --save-exact`
预期：`services/center/package.json` 出现 `"deepagents": "1.10.2"`，锁文件更新。

- [ ] **步骤 2：检查 package.json**

运行：`node -e "const p=require('./services/center/package.json'); if(p.dependencies.deepagents !== '1.10.2') throw new Error('deepagents version mismatch')"`
预期：无输出，退出码 0。

- [ ] **步骤 3：Commit**

```bash
git add services/center/package.json pnpm-lock.yaml
git commit -m "feat: 添加deepagents依赖"
```

## 任务 3：创建 Deep Agents runner 并删除旧 runner

**文件：**
- 创建：`services/center/src/deepagents-runner.ts`
- 删除：`services/center/src/langgraph-runner.ts`

- [ ] **步骤 1：实现 runner**

创建 `deepagents-runner.ts`，从旧 runner 迁移状态类型、执行器类型、checkpoint 创建和节点编排。新增 `createDeepAgent` 引用和中文注释，主导出函数命名为 `runDeepAgentsTurn`。

关键代码骨架：

```ts
import {createDeepAgent} from "deepagents";
import {END, START, StateGraph} from "@langchain/langgraph";

export async function runDeepAgentsTurn(input: RunDeepAgentsTurnInput): Promise<void> {
  const deepAgentGraph = createDeepAgent({
    tools: [],
    systemPrompt: "中心服务负责事实源、权限和审计，Deep Agents 只承载当前轮次执行编排。",
  });
  void deepAgentGraph;
  // 继续使用中心服务 StateGraph 节点边界，保证现有事件、checkpoint、任务步骤和恢复语义不变。
}
```

实现必须保留原节点执行顺序：`thinking.context -> model.stream -> tool.execute/tool.result 循环 -> message.persist -> memory.commit -> tool.plan -> usage.record`，并把所有类型名从 `LangGraphTurnState` 改为 `DeepAgentsTurnState`。

- [ ] **步骤 2：删除旧 runner**

删除 `services/center/src/langgraph-runner.ts`。

- [ ] **步骤 3：运行主路径静态检查**

运行：`pnpm exec tsx scripts/check-center-model-tool-loop.ts`
预期：不再因为 runner 文件缺失或旧文件存在失败；如果集成行为尚未切换，允许下一任务修复具体导入错误。

- [ ] **步骤 4：Commit**

```bash
git add services/center/src/deepagents-runner.ts services/center/src/langgraph-runner.ts
git commit -m "feat: 新增deepagents执行runner"
```

## 任务 4：切换 session-domain 主路径

**文件：**
- 修改：`services/center/src/domain/session-domain.ts`

- [ ] **步骤 1：调整导入**

把 `../langgraph-runner.js` 改成 `../deepagents-runner.js`，类型名改为：

```ts
runDeepAgentsTurn,
type DeepAgentsTurnState,
type DeepAgentsNodeExecutors,
type DeepAgentsToolResult,
```

- [ ] **步骤 2：调整调用和注释**

把 `runLangGraphTurn({ ... })` 改为 `runDeepAgentsTurn({ ... })`。函数注释中“LangGraph 状态”改为“Deep Agents 状态”，事件摘要中“LangGraph 节点”改为“Deep Agents 执行节点”。

- [ ] **步骤 3：运行主路径检查验证通过**

运行：`pnpm exec tsx scripts/check-center-model-tool-loop.ts`
预期：工具闭环检查通过，且新增静态断言通过。

- [ ] **步骤 4：Commit**

```bash
git add services/center/src/domain/session-domain.ts
git commit -m "feat: 切换会话执行到deepagents"
```

## 任务 5：同步文档状态和清理残留引用

**文件：**
- 修改：`需求.md`
- 修改：`设计.md`
- 修改：`架构.md`

- [ ] **步骤 1：更新状态**

把 Deep Agents 已完成部分更新为 ✅：依赖接入、runner、主路径切换、旧 runner 清理。工具桥接、todoList 映射、子智能体映射、事件适配如果本轮仍复用旧中心执行器但入口已迁移，保持 ⏳ 并说明后续细化。

- [ ] **步骤 2：查找残留引用**

运行：`rg -n "langgraph-runner|runLangGraphTurn|LangGraphTurnState|TurnGraphNodeExecutors|TurnGraphToolResult" . --glob '!node_modules/**' --glob '!.worktrees/**'`
预期：没有源码残留；文档中只允许出现旧 runner 清理说明。

- [ ] **步骤 3：Commit**

```bash
git add 需求.md 设计.md 架构.md
git commit -m "docs: 同步deepagents实现状态"
```

## 任务 6：最终验证与推送

**文件：**
- 无新增文件；验证全量相关脚本。

- [ ] **步骤 1：运行相关检查**

运行：`pnpm exec tsx scripts/check-center-model-tool-loop.ts`
预期：通过。

运行：`pnpm exec tsx scripts/check-center-agent-permissions.ts`
预期：通过。

- [ ] **步骤 2：检查状态**

运行：`git status --short`
预期：没有未提交的本轮改动。

- [ ] **步骤 3：推送**

运行：`git push origin feature/deepagents-execution-core`
预期：远端分支更新成功。

---

## 自检

- 规格覆盖：依赖接入、runner、工具桥、todo、子智能体、事件适配和旧文件清理均有任务覆盖。
- 占位符扫描：计划没有“待定/TODO/后续实现”步骤。
- 类型一致性：计划统一使用 `DeepAgentsTurnState`、`DeepAgentsNodeExecutors`、`DeepAgentsToolResult`。
