# Deep Agents 工具三层重构实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 把中心服务当前核心工具重构为 `StructuredTool` 类、纯执行器 helper 和 middleware 注册器三层结构，并删除旧工具壳与 `UnifiedToolCallIntent` 转换口。

**架构：** `services/center/src/tools` 中每个核心工具拆分为 `*-structured-tool.ts` 与 `*-tool-executor.ts`，Deep Agents 只通过 middleware 注入 `StructuredTool` 类实例。MCP 的动态工具 specs、管理页 views 和动态工具名编码解码再拆到独立 specs 层，统一出口收敛到 `tools/index.ts`。

**技术栈：** TypeScript、LangChain `StructuredTool`、Deep Agents、中心服务事件事实源、IDEA 文件问题检查、静态回归脚本。

---

## 文件结构

- 创建：`services/center/src/tools/command-tool-executor.ts`  
  职责：命令执行 helper、事件写入、结果对象整理。
- 创建：`services/center/src/tools/command-structured-tool.ts`  
  职责：命令 `StructuredTool` 类。
- 创建：`services/center/src/tools/mcp-tool-executor.ts`  
  职责：MCP 调用 helper、事件写入、结果对象整理。
- 创建：`services/center/src/tools/mcp-tool-specs.ts`  
  职责：MCP 动态工具 specs、tool views、动态工具名编码解码。
- 创建：`services/center/src/tools/mcp-structured-tool.ts`  
  职责：MCP `StructuredTool` 类。
- 创建：`services/center/src/tools/agent-team-structured-tools.ts`  
  职责：长期智能体、子智能体、team 相关 `StructuredTool` 类。
- 创建：`services/center/src/tools/agent-team-tool-executors.ts`  
  职责：长期智能体、子智能体、team 相关执行 helper。
- 修改：`services/center/src/tools/deepagents-tool-middleware.ts`  
  职责：只负责注册和注入新 `StructuredTool` 类。
- 修改：`services/center/src/tools/index.ts`  
  职责：统一出口切到新三层结构。
- 修改：`services/center/src/tools/tool-model-specs.ts`  
  职责：改用新的 MCP specs 读取口。
- 修改：`services/center/src/deepagents-agent.ts`  
  职责：只保留运行入口，不再引用旧工具壳。
- 删除：`services/center/src/tools/command-tool.ts`
- 删除：`services/center/src/tools/mcp-tool.ts`
- 修改：`scripts/check-center-tool-loop-static.mjs`
- 修改：`scripts/check-dialog-agent-workflow-regression.mjs`
- 修改：`设计.md`
- 创建：`docs/superpowers/specs/2026-06-14-deepagents-tools-three-layer-design.md`（已完成）

### 任务 1：拆出命令工具三层结构

**文件：**
- 创建：`services/center/src/tools/command-tool-executor.ts`
- 创建：`services/center/src/tools/command-structured-tool.ts`
- 删除：`services/center/src/tools/command-tool.ts`
- 修改：`services/center/src/tools/deepagents-tool-middleware.ts`
- 修改：`services/center/src/tools/index.ts`

- [ ] **步骤 1：创建命令执行器文件并迁移执行逻辑**

```ts
// services/center/src/tools/command-tool-executor.ts
export interface CommandToolExecutionRequest {
    toolCallId?: string | null;
    shellCommand?: string | null;
    executablePath: string;
    args: string[];
    inputSummary: string;
}

export interface CommandToolExecutionResult {
    toolKind: "command";
    command: string;
    status: "completed" | "failed";
    outputSummary: string;
    failureReason: string | null;
    traceId: string;
}

export async function executeCommandTool(
    events: CenterEventStore,
    sessionId: string,
    taskId: string,
    turnId: string,
    request: CommandToolExecutionRequest,
    graphCheckpoint?: TurnGraphCheckpoint,
): Promise<CommandToolExecutionResult> {
    // 从旧 runCommandTool 迁移原有逻辑
}
```

- [ ] **步骤 2：创建命令 StructuredTool 类**

```ts
// services/center/src/tools/command-structured-tool.ts
export class CommandStructuredTool extends CenterStructuredToolBase<typeof COMMAND_TOOL_SCHEMA> {
    override description = "在中心服务受控环境中执行明确的本机命令。";
    override schema = COMMAND_TOOL_SCHEMA;

    protected override async executeTool(
        arg: z.output<typeof COMMAND_TOOL_SCHEMA>,
        toolCallId: string,
    ): Promise<DeepAgentsToolExecutionResult> {
        const result = await executeCommandTool(
            this.context.input.events,
            this.context.input.sent.sessionId,
            this.context.input.sent.taskId,
            this.context.input.sent.turnId,
            {
                toolCallId,
                shellCommand: arg.shellCommand,
                executablePath: arg.executablePath ?? "",
                args: arg.args ?? [],
                inputSummary: arg.inputSummary,
            },
        );
        return {
            outputText: result.status === "completed"
                ? result.outputSummary || "工具没有输出。"
                : result.failureReason ?? "工具执行失败。",
            status: result.status,
        };
    }
}
```

- [ ] **步骤 3：更新 middleware 和 index 出口**

```ts
// services/center/src/tools/deepagents-tool-middleware.ts
import {CommandStructuredTool} from "./command-structured-tool.js";
// 删除 runCommandTool 旧引用
```

- [ ] **步骤 4：删除旧命令工具壳与旧转换口**

运行：`rg -n "UnifiedToolCallIntent|commandRequestFromUnifiedToolIntent|runCommandTool\\(" services/center/src/tools`
预期：不再出现 `command-tool.ts` 和 `commandRequestFromUnifiedToolIntent`。

- [ ] **步骤 5：Commit**

```bash
git add services/center/src/tools/command-tool-executor.ts services/center/src/tools/command-structured-tool.ts services/center/src/tools/deepagents-tool-middleware.ts services/center/src/tools/index.ts
git commit -m "refactor: split command tool layers"
```

### 任务 2：拆出 MCP 工具三层结构与 specs 层

**文件：**
- 创建：`services/center/src/tools/mcp-tool-executor.ts`
- 创建：`services/center/src/tools/mcp-tool-specs.ts`
- 创建：`services/center/src/tools/mcp-structured-tool.ts`
- 删除：`services/center/src/tools/mcp-tool.ts`
- 修改：`services/center/src/tools/tool-model-specs.ts`
- 修改：`services/center/src/tools/deepagents-tool-middleware.ts`
- 修改：`services/center/src/tools/index.ts`

- [ ] **步骤 1：创建 MCP 执行器文件**

```ts
// services/center/src/tools/mcp-tool-executor.ts
export interface McpToolExecutionRequest {
    toolCallId?: string | null;
    transportType?: "http" | "stdio" | null;
    serverId: string;
    toolName: string;
    arguments: Record<string, unknown>;
    inputSummary: string;
}

export async function executeMcpTool(
    events: CenterEventStore,
    centerDirectory: string,
    sessionId: string,
    taskId: string,
    turnId: string,
    request: McpToolExecutionRequest,
    graphCheckpoint?: TurnGraphCheckpoint,
): Promise<McpToolExecutionResult> {
    // 从旧 runMcpTool 迁移原有逻辑
}
```

- [ ] **步骤 2：创建 MCP specs 文件**

```ts
// services/center/src/tools/mcp-tool-specs.ts
export async function listConfiguredMcpModelToolSpecs(centerDirectory: string): Promise<OpenAiToolSpec[]> {
    // 从旧 mcp-tool.ts 迁移
}

export function readMcpDynamicToolName(modelToolName: string): {
    serverId: string;
    toolName: string;
} | null {
    // 从旧 mcp-tool.ts 迁移
}
```

- [ ] **步骤 3：创建动态 MCP StructuredTool 类**

```ts
// services/center/src/tools/mcp-structured-tool.ts
export class DynamicMcpStructuredTool extends CenterStructuredToolBase<typeof MCP_TOOL_SCHEMA> {
    protected override async executeTool(
        arg: z.output<typeof MCP_TOOL_SCHEMA>,
        toolCallId: string,
    ): Promise<DeepAgentsToolExecutionResult> {
        const result = await executeMcpTool(...);
        return {
            outputText: result.status === "completed"
                ? result.outputSummary || "工具没有输出。"
                : result.failureReason ?? "工具执行失败。",
            status: result.status,
        };
    }
}
```

- [ ] **步骤 4：更新模型工具定义与管理口引用**

运行：`rg -n "listConfiguredMcpModelToolSpecs|listConfiguredMcpToolViews|readMcpDynamicToolName|runMcpTool\\(" services/center/src`
预期：全部指向新文件，不再指向 `mcp-tool.ts`。

- [ ] **步骤 5：Commit**

```bash
git add services/center/src/tools/mcp-tool-executor.ts services/center/src/tools/mcp-tool-specs.ts services/center/src/tools/mcp-structured-tool.ts services/center/src/tools/tool-model-specs.ts services/center/src/tools/index.ts
git commit -m "refactor: split mcp tool layers"
```

### 任务 3：拆出 agent/team 工具类与执行器，并清理静态检查

**文件：**
- 创建：`services/center/src/tools/agent-team-tool-executors.ts`
- 创建：`services/center/src/tools/agent-team-structured-tools.ts`
- 修改：`services/center/src/tools/deepagents-tool-middleware.ts`
- 修改：`services/center/src/deepagents-agent.ts`
- 修改：`scripts/check-center-tool-loop-static.mjs`
- 修改：`scripts/check-dialog-agent-workflow-regression.mjs`
- 修改：`设计.md`

- [ ] **步骤 1：抽出 agent/team 执行器 helper**

```ts
// services/center/src/tools/agent-team-tool-executors.ts
export function executeCreateLongTermAgentForTool(
    context: DeepAgentsToolExecutionContext,
    arg: { name: string; roleDescription: string; capabilityBoundary?: string },
): DeepAgentsToolExecutionResult {
    return {
        outputText: JSON.stringify(
            executeCreateLongTermAgentTool(
                context.input.database,
                context.input.events,
                context.centerDirectory,
                arg,
            ),
        ),
        status: "completed",
    };
}
```

- [ ] **步骤 2：创建 agent/team StructuredTool 类文件**

```ts
// services/center/src/tools/agent-team-structured-tools.ts
export class CreateLongTermAgentStructuredTool extends CenterStructuredToolBase<typeof CREATE_LONG_TERM_AGENT_SCHEMA> {
    protected override async executeTool(arg: z.output<typeof CREATE_LONG_TERM_AGENT_SCHEMA>): Promise<DeepAgentsToolExecutionResult> {
        return executeCreateLongTermAgentForTool(this.context, arg);
    }
}
```

- [ ] **步骤 3：收紧 middleware 与入口依赖**

```ts
// deepagents-tool-middleware.ts
// 只 import 各 StructuredTool 类，不再直接 import executeCreateLongTermAgentTool 等领域函数
```

- [ ] **步骤 4：更新静态检查脚本与设计状态**

运行：`node scripts/check-center-tool-loop-static.mjs`
预期：通过，且断言命中新的三层结构文件。

- [ ] **步骤 5：Commit**

```bash
git add services/center/src/tools/agent-team-tool-executors.ts services/center/src/tools/agent-team-structured-tools.ts services/center/src/tools/deepagents-tool-middleware.ts services/center/src/deepagents-agent.ts scripts/check-center-tool-loop-static.mjs scripts/check-dialog-agent-workflow-regression.mjs 设计.md
git commit -m "refactor: split deep agents tool layers"
```

## 自检

- 规格覆盖度：计划覆盖了命令、MCP、agent/team 工具、管理读取口、middleware、统一出口、静态检查与设计文档同步。
- 占位符扫描：没有保留 TODO、待定、后续实现式占位符。
- 类型一致性：计划统一使用 `StructuredTool` 类、executor、middleware 三层术语；命令与 MCP 执行器命名统一为 `execute*Tool`。

## 执行交接

计划已完成并保存到 `docs/superpowers/plans/2026-06-14-deepagents-tools-three-layer-plan.md`。当前会话继续按该计划内联执行。
