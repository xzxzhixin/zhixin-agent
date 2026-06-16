# Deep Agents MCP 工具运行时重建实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 删除当前 Deep Agents 注入 MCP tools 的旧链路，按 Provider、Wrapper、ResultNormalizer 三层重建 Agent 对话主链路 MCP 工具运行时。

**架构：** `DeepAgentsToolFactory.ts` 只保留当前轮次工具工厂装配职责；MCP 配置读取和官方 adapter 工具发现进入 `McpToolProvider.ts`；中心服务审计包装进入 `McpToolWrapperStructuredTool.ts`；adapter 输出规范化进入 `McpToolResultNormalizer.ts`。MCP 协议发现和调用仍只通过 `@langchain/mcp-adapters` 的 `MultiServerMCPClient.getTools()` 与官方 tool `invoke()` 完成。

**技术栈：** Node.js 20+、TypeScript、pnpm workspace、Deep Agents、LangChain `StructuredTool`、`@langchain/mcp-adapters`。

---

## 文件结构

- 创建：`services/center/src/StructuredTool/McpToolResultNormalizer.ts`  
  职责：把官方 adapter 返回值规范成模型回填文本、UI 摘要和审计 artifact，隔离 schema mismatch 与巨大 artifact。
- 创建：`services/center/src/StructuredTool/McpToolWrapperStructuredTool.ts`  
  职责：继承 `CenterStructuredToolBase`，包装官方 adapter tool，写入 `tool.mcp.started/completed/failed`，处理 IDEA 项目路径补参。
- 创建：`services/center/src/StructuredTool/McpToolProvider.ts`  
  职责：读取当前会话 MCP 配置，创建官方 `MultiServerMCPClient`，调用 `getTools()`，注册 cleanup，返回 wrapper 后的 MCP tools。
- 创建：`services/center/src/StructuredTool/DeepAgentsToolFactory.ts`  
  职责：只合并命令、MCP provider、agent/team 工具，不直接创建 MCP client、调用 `getTools()` 或包装 adapter tool。
- 修改：`services/center/src/StructuredTool/index.ts`  
  导出新的 provider、wrapper、normalizer；移除旧 `McpAdapterStructuredTool` 主链路导出。
- 删除：`services/center/src/StructuredTool/McpAdapterStructuredTool.ts`  
  删除旧 wrapper、参数补全、事件、结果规范化混合文件，避免新旧链路并存。
- 修改：`scripts/check-deepagents-mcp-tool-choice-regression.mjs`  
  更新静态断言，确认工具工厂文件不再承载 MCP 细节，主链路使用新三层文件。
- 修改：`scripts/check-tool-visibility.mjs`  
  更新静态断言，指向 `McpToolWrapperStructuredTool.ts` 和 `McpToolResultNormalizer.ts`。
- 修改：`设计.md`、`架构.md`、`功能清单与关系.md`  
  实现完成后同步实际模块边界与回归范围。

## 任务 1：用回归脚本锁定新边界

**文件：**
- 修改：`scripts/check-deepagents-mcp-tool-choice-regression.mjs`
- 修改：`scripts/check-tool-visibility.mjs`

- [ ] **步骤 1：修改 MCP 回归脚本的文件路径**

将旧路径：

```js
const mcpAdapterStructuredToolPath = join(
    rootDirectory,
    "services",
    "center",
    "src",
    "StructuredTool",
    "McpAdapterStructuredTool.ts",
);
```

替换为：

```js
const mcpToolProviderPath = join(
    rootDirectory,
    "services",
    "center",
    "src",
    "StructuredTool",
    "McpToolProvider.ts",
);
const mcpToolWrapperPath = join(
    rootDirectory,
    "services",
    "center",
    "src",
    "StructuredTool",
    "McpToolWrapperStructuredTool.ts",
);
const mcpToolResultNormalizerPath = join(
    rootDirectory,
    "services",
    "center",
    "src",
    "StructuredTool",
    "McpToolResultNormalizer.ts",
);
```

- [ ] **步骤 2：修改读取源码变量**

将旧的 `mcpAdapterStructuredToolSource` 替换为：

```js
const mcpToolProviderSource = readFileSync(
    mcpToolProviderPath,
    "utf8",
);
const mcpToolWrapperSource = readFileSync(
    mcpToolWrapperPath,
    "utf8",
);
const mcpToolResultNormalizerSource = readFileSync(
    mcpToolResultNormalizerPath,
    "utf8",
);
```

- [ ] **步骤 3：增加 middleware 职责边界断言**

在 `scripts/check-deepagents-mcp-tool-choice-regression.mjs` 中加入：

```js
assertNotContains(
    deepAgentsToolMiddlewareSource,
    /MultiServerMCPClient|createMcpAdapterClient|getTools\(\)|invoke\(normalizedArg\)|normalizeMcpToolArguments|normalizeMcpAdapterOutput/u,
    "DeepAgentsToolFactory.ts 只能做工具工厂装配，不得承载 MCP client、getTools、参数补全或结果规范化细节。",
);
assert(
    /buildMcpToolsForDeepAgents/u.test(deepAgentsToolMiddlewareSource),
    "DeepAgentsToolFactory.ts 必须通过 McpToolProvider 提供 MCP tools。",
);
```

- [ ] **步骤 4：增加三层文件断言**

在同一脚本中加入：

```js
assert(
    /MultiServerMCPClient/u.test(mcpToolProviderSource)
    && /getTools\(\)/u.test(mcpToolProviderSource)
    && /McpToolWrapperStructuredTool/u.test(mcpToolProviderSource),
    "McpToolProvider.ts 必须使用官方 MultiServerMCPClient.getTools() 并返回中心服务包装后的 MCP tools。",
);
assert(
    /class McpToolWrapperStructuredTool/u.test(mcpToolWrapperSource)
    && /extends CenterStructuredToolBase/u.test(mcpToolWrapperSource)
    && /this\.adapterTool\.invoke\(normalizedArg\)/u.test(mcpToolWrapperSource),
    "McpToolWrapperStructuredTool.ts 必须继承中心服务 StructuredTool 基类，并由官方 adapter tool 执行 MCP tools/call。",
);
assert(
    /normalizeMcpToolResult/u.test(mcpToolResultNormalizerSource)
    && /modelText/u.test(mcpToolResultNormalizerSource)
    && /auditArtifact/u.test(mcpToolResultNormalizerSource),
    "McpToolResultNormalizer.ts 必须输出模型文本、UI 摘要和审计 artifact。",
);
```

- [ ] **步骤 5：运行脚本确认失败**

运行：

```powershell
node scripts/check-deepagents-mcp-tool-choice-regression.mjs
```

预期：失败，提示缺少 `McpToolProvider.ts`、`McpToolWrapperStructuredTool.ts` 或 `McpToolResultNormalizer.ts`。

- [ ] **步骤 6：提交脚本边界**

```powershell
git add -- scripts/check-deepagents-mcp-tool-choice-regression.mjs scripts/check-tool-visibility.mjs
git commit -m "test: 锁定 MCP 工具运行时重建边界"
```

## 任务 2：创建 MCP 结果规范化模块

**文件：**
- 创建：`services/center/src/StructuredTool/McpToolResultNormalizer.ts`

- [ ] **步骤 1：创建类型与入口函数**

创建文件并写入：

```ts
/** McpToolNormalizedResult：MCP 工具结果规范化后的三类输出。 */
export interface McpToolNormalizedResult {
    /** modelText: 回填给模型的文本。 */
    modelText: string;
    /** uiSummary: 写入过程卡片的短摘要。 */
    uiSummary: string;
    /** auditArtifact: 只进入审计 payload 的原始结构。 */
    auditArtifact: unknown;
}

/**
 * normalizeMcpToolResult：把官方 MCP adapter 返回值规范化为模型文本、UI 摘要和审计 artifact。
 *
 * @param output 官方 adapter tool 返回值。
 * @returns 规范化后的结果对象。
 */
export function normalizeMcpToolResult(output: unknown): McpToolNormalizedResult {
    const modelText = normalizeMcpModelText(output);
    return {
        modelText,
        uiSummary: modelText.slice(
            0,
            240,
        ),
        auditArtifact: output,
    };
}
```

- [ ] **步骤 2：实现 content 与 artifact 识别**

在同一文件追加：

```ts
/**
 * normalizeMcpModelText：优先提取官方 adapter content 文本。
 *
 * @param output 官方 adapter tool 返回值。
 * @returns 可回填模型的文本。
 */
function normalizeMcpModelText(output: unknown): string {
    if (typeof output === "string") {
        return output;
    }
    if (isContentAndArtifactOutput(output)) {
        return normalizeMcpModelText(output[0]);
    }
    if (isMcpTextContentBlock(output)) {
        return output.text;
    }
    if (Array.isArray(output)) {
        return output.map((item) => normalizeMcpModelText(item)).join("\n");
    }
    if (output && typeof output === "object") {
        return JSON.stringify(
            output,
            null,
            2,
        );
    }
    return String(output ?? "");
}

/**
 * isContentAndArtifactOutput：识别 LangChain content_and_artifact 二元返回值。
 *
 * @param output 官方 adapter tool 返回值。
 * @returns 是 `[content, artifact]` 结构时返回 true。
 */
function isContentAndArtifactOutput(output: unknown): output is [unknown, unknown] {
    return Array.isArray(output)
        && output.length === 2
        && Array.isArray(output[0])
        && Array.isArray(output[1]);
}

/**
 * isMcpTextContentBlock：识别 MCP 文本 content block。
 *
 * @param output 单个输出片段。
 * @returns 是文本片段时返回 true。
 */
function isMcpTextContentBlock(output: unknown): output is {
    /** text: MCP 文本片段正文。 */
    text: string;
} {
    return Boolean(output)
        && typeof output === "object"
        && "type" in output
        && (output as {type?: unknown}).type === "text"
        && typeof (output as {text?: unknown}).text === "string";
}
```

- [ ] **步骤 3：运行边界脚本确认仍失败但 normalizer 断言通过**

运行：

```powershell
node scripts/check-deepagents-mcp-tool-choice-regression.mjs
```

预期：仍失败，但失败原因不再是 `McpToolResultNormalizer.ts` 缺失。

- [ ] **步骤 4：提交 normalizer**

```powershell
git add -- services/center/src/StructuredTool/McpToolResultNormalizer.ts
git commit -m "feat: 新增 MCP 工具结果规范化模块"
```

## 任务 3：创建 MCP 工具包装类

**文件：**
- 创建：`services/center/src/StructuredTool/McpToolWrapperStructuredTool.ts`
- 后续删除：`services/center/src/StructuredTool/McpAdapterStructuredTool.ts`

- [ ] **步骤 1：创建 wrapper 类骨架**

创建文件并写入：

```ts
import type {
    StructuredToolInterface,
    ToolInputSchemaBase,
    ToolInputSchemaOutputType,
} from "@langchain/core/tools";

import {SessionRepository} from "../data-access/session-repository.js";
import {CenterStructuredToolBase} from "./CenterStructuredToolBase.js";
import type {
    DeepAgentsToolExecutionContext,
    DeepAgentsToolExecutionResult,
} from "./deepagents-tool-runtime.js";
import {normalizeMcpToolResult} from "./McpToolResultNormalizer.js";

/** MCP_TOOL_INTERNAL_TOOL_ID：官方 MCP adapter 工具统一继承的中心服务权限 ID。 */
export const MCP_TOOL_INTERNAL_TOOL_ID = "builtin.mcp.call";

/** McpToolWrapperStructuredTool：中心服务对官方 MCP adapter tool 的审计包装。 */
export class McpToolWrapperStructuredTool extends CenterStructuredToolBase<ToolInputSchemaBase> {
    /** description: 复用并补充官方 adapter tool 描述。 */
    override description: string;
    /** schema: 复用官方 adapter tool schema。 */
    override schema: ToolInputSchemaBase;
    /** adapterTool: 官方 adapter 返回的 LangChain tool。 */
    private readonly adapterTool: StructuredToolInterface;

    /**
     * constructor：创建 MCP adapter 工具包装。
     *
     * @param context 当前轮次工具执行上下文。
     * @param adapterTool 官方 adapter 返回的 LangChain tool。
     */
    constructor(
        context: DeepAgentsToolExecutionContext,
        adapterTool: StructuredToolInterface,
    ) {
        super(
            context,
            MCP_TOOL_INTERNAL_TOOL_ID,
            adapterTool.name,
        );
        this.adapterTool = adapterTool;
        this.description = adapterTool.description;
        this.schema = adapterTool.schema;
    }
}
```

- [ ] **步骤 2：实现 executeTool**

在类中加入：

```ts
/**
 * executeTool：调用官方 adapter tool 并归一化返回文本。
 *
 * @param arg 模型传入的 MCP 工具参数。
 * @param toolCallId 当前工具调用 ID。
 * @returns 工具执行结果。
 */
protected override async executeTool(
    arg: ToolInputSchemaOutputType<ToolInputSchemaBase>,
    toolCallId: string,
): Promise<DeepAgentsToolExecutionResult> {
    this.appendMcpStartedEvent(
        arg as Record<string, unknown>,
        toolCallId,
    );
    try {
        const output = await this.adapterTool.invoke(arg);
        const normalizedResult = normalizeMcpToolResult(output);
        this.appendMcpCompletedEvent(
            normalizedResult,
            toolCallId,
        );
        return {
            outputText: normalizedResult.modelText,
            status: "completed",
        };
    } catch (error) {
        const failureReason = error instanceof Error
            ? error.message
            : "MCP_ADAPTER_TOOL_CALL_FAILED";
        this.appendMcpFailedEvent(
            failureReason,
            toolCallId,
        );
        return {
            outputText: failureReason,
            status: "failed",
        };
    }
}
```

- [ ] **步骤 3：保持官方 adapter 参数原样传递**

wrapper 不做 MCP 工具描述增强和参数补全，模型参数必须原样传给官方 adapter tool：

```ts
const output = await this.adapterTool.invoke(arg);
```

- [ ] **步骤 4：迁移事件写入**

在类中加入 `appendMcpStartedEvent`、`appendMcpCompletedEvent`、`appendMcpFailedEvent`。`appendMcpCompletedEvent` 的参数类型使用：

```ts
import type {McpToolNormalizedResult} from "./McpToolResultNormalizer.js";
```

完成事件 payload 必须包含：

```ts
payload: {
    toolId: MCP_TOOL_INTERNAL_TOOL_ID,
    toolKind: "mcp",
    toolCallId,
    toolName: this.name,
    outputSummary: normalizedResult.modelText.slice(
        0,
        2000,
    ),
    auditArtifact: normalizedResult.auditArtifact,
},
```

- [ ] **步骤 5：运行脚本确认 wrapper 断言通过**

运行：

```powershell
node scripts/check-deepagents-mcp-tool-choice-regression.mjs
```

预期：仍失败，但失败原因不再是 `McpToolWrapperStructuredTool.ts` 缺失。

- [ ] **步骤 6：提交 wrapper**

```powershell
git add -- services/center/src/StructuredTool/McpToolWrapperStructuredTool.ts
git commit -m "feat: 新增 MCP 工具审计包装类"
```

## 任务 4：创建 MCP 工具 Provider 并收缩 middleware

**文件：**
- 创建：`services/center/src/StructuredTool/McpToolProvider.ts`
- 创建：`services/center/src/StructuredTool/DeepAgentsToolFactory.ts`

- [ ] **步骤 1：创建 Provider**

创建 `McpToolProvider.ts`：

```ts
import type {StructuredToolInterface} from "@langchain/core/tools";

import type {DeepAgentsToolExecutionContext} from "./deepagents-tool-runtime.js";
import {createMcpAdapterClient} from "./mcp-adapter-config.js";
import {McpToolWrapperStructuredTool} from "./McpToolWrapperStructuredTool.js";

/**
 * buildMcpToolsForDeepAgents：按当前轮次上下文发现并包装 MCP tools。
 *
 * @param context 当前轮次工具执行上下文。
 * @returns 可注入 Deep Agents 的 MCP 工具列表。
 */
export async function buildMcpToolsForDeepAgents(
    context: DeepAgentsToolExecutionContext,
): Promise<StructuredToolInterface[]> {
    const mcpClient = createMcpAdapterClient(
        context.centerDirectory,
        context.projectId,
    );
    context.cleanupCallbacks.push(async () => {
        await mcpClient.close();
    });
    const adapterTools = await mcpClient.getTools();
    return adapterTools.map((adapterTool) => {
        return new McpToolWrapperStructuredTool(
            context,
            adapterTool,
        );
    });
}
```

- [ ] **步骤 2：修改 middleware 导入**

在 `DeepAgentsToolFactory.ts` 中不要引入：

```ts
import {
    createMcpAdapterClient,
} from "./mcp-adapter-config.js";
import {
    wrapMcpAdapterToolsForCenter,
} from "./McpAdapterStructuredTool.js";
```

新增：

```ts
import {
    buildMcpToolsForDeepAgents,
} from "./McpToolProvider.js";
```

- [ ] **步骤 3：替换 middleware 中 MCP 构建逻辑**

将旧代码：

```ts
const mcpClient = createMcpAdapterClient(
    context.centerDirectory,
    context.projectId,
);
context.cleanupCallbacks.push(async () => {
    await mcpClient.close();
});
const mcpTools = await mcpClient.getTools();
tools.push(...wrapMcpAdapterToolsForCenter(
    context,
    mcpTools,
));
```

替换为：

```ts
const mcpTools = await buildMcpToolsForDeepAgents(context);
tools.push(...mcpTools);
```

- [ ] **步骤 4：运行边界脚本确认 middleware 断言通过**

运行：

```powershell
node scripts/check-deepagents-mcp-tool-choice-regression.mjs
```

预期：MCP provider、wrapper、normalizer 和 middleware 边界断言通过，若仍失败应只剩旧导出或旧文件引用。

- [ ] **步骤 5：提交 provider 与 middleware**

```powershell
git add -- services/center/src/StructuredTool/McpToolProvider.ts services/center/src/StructuredTool/DeepAgentsToolFactory.ts
git commit -m "feat: 重建 MCP 工具 provider 注入链路"
```

## 任务 5：删除旧包装链路并更新导出

**文件：**
- 修改：`services/center/src/StructuredTool/index.ts`
- 删除：`services/center/src/StructuredTool/McpAdapterStructuredTool.ts`

- [ ] **步骤 1：更新统一导出**

在 `index.ts` 删除：

```ts
export {
    McpAdapterStructuredTool,
    wrapMcpAdapterToolsForCenter,
} from "./McpAdapterStructuredTool.js";
```

新增：

```ts
export {
    buildMcpToolsForDeepAgents,
} from "./McpToolProvider.js";
export {
    MCP_TOOL_INTERNAL_TOOL_ID,
    McpToolWrapperStructuredTool,
} from "./McpToolWrapperStructuredTool.js";
export {
    normalizeMcpToolResult,
} from "./McpToolResultNormalizer.js";
export type {
    McpToolNormalizedResult,
} from "./McpToolResultNormalizer.js";
```

- [ ] **步骤 2：删除旧文件**

运行：

```powershell
Remove-Item -LiteralPath 'services\center\src\StructuredTool\McpAdapterStructuredTool.ts'
```

- [ ] **步骤 3：检索旧符号引用**

运行：

```powershell
rg "McpAdapterStructuredTool|wrapMcpAdapterToolsForCenter|normalizeMcpAdapterOutput|isContentAndArtifactOutput|isMcpTextContentBlock" services scripts docs -g "!center-data/**"
```

预期：代码和脚本中没有旧主链路引用；历史计划或规格文档中出现旧名称可以保留为历史记录。

- [ ] **步骤 4：提交删除与导出**

```powershell
git add -- services/center/src/StructuredTool/index.ts services/center/src/StructuredTool/McpAdapterStructuredTool.ts
git commit -m "refactor: 删除旧 MCP adapter 包装链路"
```

## 任务 6：更新静态检查脚本和源码组织检查

**文件：**
- 修改：`scripts/check-tool-visibility.mjs`
- 修改：`scripts/check-center-src-organization-and-team.mjs`
- 修改：`scripts/check-dialog-agent-workflow-regression.mjs`
- 修改：`scripts/check-center-graph-checkpoint-regression.mjs`
- 修改：`scripts/check-command-tool-streaming.mjs`

- [ ] **步骤 1：替换检查脚本中的旧文件名**

把所有：

```text
services/center/src/StructuredTool/McpAdapterStructuredTool.ts
```

替换为：

```text
services/center/src/StructuredTool/McpToolWrapperStructuredTool.ts
```

涉及结果规范化的断言改为读取：

```text
services/center/src/StructuredTool/McpToolResultNormalizer.ts
```

- [ ] **步骤 2：更新源码组织检查允许文件清单**

在 `scripts/check-center-src-organization-and-team.mjs` 中，移除：

```js
"McpAdapterStructuredTool.ts",
```

新增：

```js
"McpToolProvider.ts",
"McpToolWrapperStructuredTool.ts",
"McpToolResultNormalizer.ts",
```

- [ ] **步骤 3：运行静态检查脚本**

运行：

```powershell
node scripts/check-deepagents-mcp-tool-choice-regression.mjs
node scripts/check-tool-visibility.mjs
node scripts/check-center-src-organization-and-team.mjs
node scripts/check-dialog-agent-workflow-regression.mjs
node scripts/check-center-graph-checkpoint-regression.mjs
node scripts/check-command-tool-streaming.mjs
```

预期：全部通过。

- [ ] **步骤 4：提交检查脚本更新**

```powershell
git add -- scripts/check-tool-visibility.mjs scripts/check-center-src-organization-and-team.mjs scripts/check-dialog-agent-workflow-regression.mjs scripts/check-center-graph-checkpoint-regression.mjs scripts/check-command-tool-streaming.mjs
git commit -m "test: 更新 MCP 工具运行时回归检查"
```

## 任务 7：同步事实源文档

**文件：**
- 修改：`设计.md`
- 修改：`架构.md`
- 修改：`功能清单与关系.md`

- [ ] **步骤 1：更新设计.md**

在“Deep Agents 工具三层重构设计”或新增“Deep Agents MCP 工具运行时重建设计”一级标题中记录：

```md
- ✅ Deep Agents MCP 对话主链路拆为 `McpToolProvider`、`McpToolWrapperStructuredTool` 和 `McpToolResultNormalizer`。
- ✅ `DeepAgentsToolFactory.ts` 只承担 Deep Agents 当前轮次工具工厂职责，不使用 middleware 命名，也不内嵌 MCP client、`getTools()`、IDEA 参数补全或结果规范化细节。
- ✅ MCP adapter 返回的 `structuredContent` 和 `artifact` 只进入审计 payload，不再要求与 MCP Server 声明输出 schema 匹配后才允许轮次继续。
```

- [ ] **步骤 2：更新架构.md**

在 `services/center/src/StructuredTool` 目录说明中补充：

```md
MCP 对话主链路使用 `McpToolProvider` 读取配置并调用官方 `MultiServerMCPClient.getTools()`，`McpToolWrapperStructuredTool` 继承中心服务 `StructuredTool` 基类做权限和审计包装，`McpToolResultNormalizer` 负责模型文本、UI 摘要和审计 artifact 规范化；`DeepAgentsToolFactory.ts` 只负责工具工厂装配。
```

- [ ] **步骤 3：更新功能清单与关系.md**

修订“Deep Agents MCP 官方 adapter 真实调用链路”一行，依赖文件改为：

```text
services/center/src/StructuredTool/McpToolProvider.ts
services/center/src/StructuredTool/McpToolWrapperStructuredTool.ts
services/center/src/StructuredTool/McpToolResultNormalizer.ts
services/center/src/StructuredTool/DeepAgentsToolFactory.ts
```

测试关注点增加：

```text
MCP structuredContent 与声明 schema 不一致时不导致中心服务停机或轮次卡住。
```

- [ ] **步骤 4：提交文档同步**

```powershell
git add -- 设计.md 架构.md 功能清单与关系.md
git commit -m "docs: 同步 MCP 工具运行时重建边界"
```

## 任务 8：验证与推送

**文件：**
- 检查：所有本次修改文件
- 更新：`启动进程.md`、`浏览器页面.md` 仅在实际启动测试时按项目规则记录

- [ ] **步骤 1：检索旧链路残留**

运行：

```powershell
rg "McpAdapterStructuredTool|wrapMcpAdapterToolsForCenter|DynamicMcpStructuredTool|listConfiguredMcpModelToolSpecs|readMcpDynamicToolName" services scripts -g "!center-data/**"
```

预期：无业务主链路残留；如果脚本中出现历史禁止项，应确认是负向断言。

- [ ] **步骤 2：运行静态回归脚本**

运行：

```powershell
node scripts/check-deepagents-mcp-tool-choice-regression.mjs
node scripts/check-tool-visibility.mjs
node scripts/check-center-src-organization-and-team.mjs
node scripts/check-dialog-agent-workflow-regression.mjs
node scripts/check-center-graph-checkpoint-regression.mjs
node scripts/check-command-tool-streaming.mjs
```

预期：全部通过。

- [ ] **步骤 3：运行中心服务构建占位脚本**

运行：

```powershell
pnpm --filter @zhixin/center build
```

预期：输出 `services/center 由 tsx 运行源码，当前阶段不执行 TypeScript 编译器检查`，退出码为 0。

- [ ] **步骤 4：按项目规则做浏览器验收**

如果用户允许启动桌面壳，先关闭旧桌面壳和中心服务进程，再运行：

```powershell
pnpm dev:desktop-shell
```

记录 `启动进程.md`。使用 Chrome DevTools 打开测试页面但不主动切换用户页面，记录 `浏览器页面.md`。在 `项目对话测试` 项目会话内用三种不同提示词测试 MCP IDEA 工具：

```text
主动调用 get_repositories 看看返回什么？
查看 IDEA 当前打开文件列表。
读取当前项目的打开文件上下文。
```

预期：MCP 成功或失败都形成终态卡片，发送按钮恢复，中心服务不退出，页面不长期停留在运行中。

- [ ] **步骤 5：提交最终验证记录**

如果浏览器验收更新了 `启动进程.md` 或 `浏览器页面.md`，按项目规则提交这些记录：

```powershell
git add -- 启动进程.md 浏览器页面.md
git commit -m "test: 记录 MCP 工具运行时验收进程"
```

- [ ] **步骤 6：推送**

运行：

```powershell
git status --short
git pull --rebase
git push
```

预期：远端推送成功；如果 pull 出现冲突，停止并报告冲突文件。
