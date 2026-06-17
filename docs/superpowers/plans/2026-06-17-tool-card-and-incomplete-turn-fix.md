# 工具卡片重复与半截轮次收尾修复实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 修复 MCP 过程卡片重复正文、工具调用 ID 不一致和半截执行意图被错误标记完成的问题。

**架构：** 前端只负责按同一工具调用聚合和展示去重后的过程正文；中心服务负责让 Deep Agents 工具计划、StructuredTool 执行和模型回填共享同一个 `toolCallId`。半截工具意图在中心服务收尾前判定，避免错误助手消息进入消息表和长期记忆。

**技术栈：** Vue 3、Pinia、Node.js、TypeScript、Deep Agents、LangChain StructuredTool、Fastify 注入式回归脚本。

---

## 文件结构

- 修改：`apps/frontend/src/views/Chat/chat-view-helpers.ts`
  - 职责：过程卡片聚合、正文去重和卡片状态派生。
- 修改：`services/center/src/StructuredTool/CenterStructuredToolBase.ts`
  - 职责：统一模型工具调用请求、执行、回填事件的 `toolCallId`。
- 修改：`services/center/src/deepagents-agent.ts`
  - 职责：消费 Deep Agents 工具调用流、记录工具计划事件、最终轮次完成或失败收尾。
- 修改：`scripts/check-chat-turn-render-order.ts`
  - 职责：补充前端聚合纯函数回归，覆盖 MCP 长文本和截断回填重复。
- 修改：`scripts/check-center-incomplete-tool-intent.ts`
  - 职责：扩展半截工具意图集成检查，覆盖“先看 GitHub 再过滤”类文本。
- 修改：`scripts/check-chat-process-card-regression.mjs`
  - 职责：补充静态约束，确保工具回填不再作为重复正文来源，确保工具调用 ID 有继承逻辑。
- 可能修改：`services/center/src/StructuredTool/deepagents-tool-runtime.ts`
  - 职责：如果 Deep Agents/LangChain 提供调用配置入口，在这里传递运行时 `toolCallId`。

### 任务 1：补前端 MCP 重复正文回归

**文件：**
- 修改：`scripts/check-chat-turn-render-order.ts`

- [ ] **步骤 1：添加失败用例**

在现有命令重复用例后追加 MCP 场景：

```ts
const mcpDuplicatedRows = createGroupedProcessRows([
  {
    eventId: "event-mcp-completed",
    eventType: "tool.mcp.completed",
    scopeType: "tool",
    scopeId: "task-mcp",
    sessionId: "session-order",
    turnId: "turn-order",
    taskId: "task-order",
    stepId: null,
    agentId: null,
    projectId: null,
    clientId: null,
    sequence: 40,
    status: "completed",
    occurredAt: now,
    title: "MCP 调用完成",
    summary: "## Pages\n1: https://github.com/trending\n2: https://example.com",
    payload: {
      toolKind: "mcp",
      toolCallId: "tool-call-mcp-duplicate",
      toolName: "mcp__chrome-devtools__new_page",
      outputSummary: "## Pages\n1: https://github.com/trending\n2: https://example.com",
    },
    errorCode: null,
    traceId: "trace-mcp-completed",
  },
  {
    eventId: "event-mcp-result-appended",
    eventType: "model.tool.result.appended",
    scopeType: "model",
    scopeId: "task-mcp",
    sessionId: "session-order",
    turnId: "turn-order",
    taskId: "task-order",
    stepId: null,
    agentId: null,
    projectId: null,
    clientId: null,
    sequence: 41,
    status: "completed",
    occurredAt: now,
    title: "工具结果回填模型",
    summary: "已回填工具结果：mcp__chrome-devtools__new_page",
    payload: {
      toolId: "builtin.mcp.call",
      toolCallId: "tool-call-mcp-duplicate",
      toolName: "mcp__chrome-devtools__new_page",
      status: "completed",
      resultSummary: "## Pages\n1: https://github.com/trending",
    },
    errorCode: null,
    traceId: "trace-mcp-result-appended",
  },
]);
assert(
  mcpDuplicatedRows.length === 1
    && mcpDuplicatedRows[0].responseText === "## Pages\n1: https://github.com/trending\n2: https://example.com",
  "MCP 卡片正文不能把完成结果和截断回填结果重复拼接。",
);
```

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm exec tsx scripts/check-chat-turn-render-order.ts`

预期：失败，提示 `MCP 卡片正文不能把完成结果和截断回填结果重复拼接。`

### 任务 2：实现前端过程正文去重

**文件：**
- 修改：`apps/frontend/src/views/Chat/chat-view-helpers.ts`

- [ ] **步骤 1：增强去重函数**

把 `deduplicateProcessTextParts` 改成保留更完整文本：

```ts
function deduplicateProcessTextParts(parts: string[]): string[] {
    const deduplicatedParts: string[] = [];
    for (const part of parts) {
        const normalizedPart = part.trim();
        if (normalizedPart.length === 0) {
            continue;
        }
        const existingIndex = deduplicatedParts.findIndex((existingPart) => {
            return existingPart === normalizedPart
                || existingPart.includes(normalizedPart)
                || normalizedPart.includes(existingPart);
        });
        if (existingIndex === -1) {
            deduplicatedParts.push(normalizedPart);
            continue;
        }
        if (normalizedPart.length > deduplicatedParts[existingIndex].length) {
            deduplicatedParts[existingIndex] = normalizedPart;
        }
    }
    return deduplicatedParts;
}
```

- [ ] **步骤 2：避免模型回填抢占工具正文**

在 `resolveProcessTerminalText` 非命令分支中优先读取真实工具事件正文，只在没有真实工具正文时使用 `model.tool.result.appended`：

```ts
const toolExecutionTextParts = sortedEvents.map((event) => {
    if (event.eventType === "model.tool.result.appended") {
        return "";
    }
    return resolveProcessLogText(event);
}).filter((text) => {
    return text.trim().length > 0;
});
const deduplicatedToolParts = deduplicateProcessTextParts(toolExecutionTextParts);
if (deduplicatedToolParts.length > 0) {
    return deduplicatedToolParts.join("\n");
}
const fallbackTextParts = sortedEvents.map((event) => {
    return resolveProcessLogText(event);
}).filter((text) => {
    return text.trim().length > 0;
});
return deduplicateProcessTextParts(fallbackTextParts).join("\n");
```

- [ ] **步骤 3：运行前端聚合回归**

运行：`pnpm exec tsx scripts/check-chat-turn-render-order.ts`

预期：通过，输出包含 `对话轮次渲染顺序检查通过。`

### 任务 3：补工具调用 ID 统一静态约束

**文件：**
- 修改：`scripts/check-chat-process-card-regression.mjs`

- [ ] **步骤 1：添加静态断言**

添加对 `CenterStructuredToolBase.ts` 的读取，并断言存在调用 ID 继承逻辑：

```js
const centerStructuredToolBase = readProjectFile("services/center/src/StructuredTool/CenterStructuredToolBase.ts");
assertIncludes(
  centerStructuredToolBase,
  "resolveRuntimeToolCallId",
  "StructuredTool 基类必须优先继承 Deep Agents/LangChain 传入的工具调用 ID。",
);
assertIncludes(
  centerStructuredToolBase,
  "randomUUID()",
  "StructuredTool 基类只允许在没有运行时工具调用 ID 时生成兼容 ID。",
);
```

- [ ] **步骤 2：运行测试验证失败**

运行：`node scripts/check-chat-process-card-regression.mjs`

预期：失败，提示 `StructuredTool 基类必须优先继承 Deep Agents/LangChain 传入的工具调用 ID。`

### 任务 4：统一 StructuredTool 工具调用 ID

**文件：**
- 修改：`services/center/src/StructuredTool/CenterStructuredToolBase.ts`
- 可能修改：`services/center/src/StructuredTool/deepagents-tool-runtime.ts`

- [ ] **步骤 1：读取 LangChain 工具运行配置**

如果当前 `_call` 只能接收 `arg`，先确认父类是否支持第二参数。目标签名如下：

```text
protected override async _call(
    arg: ToolInputSchemaOutputType<SchemaT>,
    runManager?: unknown,
    config?: unknown,
): Promise<string> {
```

- [ ] **步骤 2：实现 `resolveRuntimeToolCallId`**

在基类底部新增函数：

```ts
function resolveRuntimeToolCallId(
    runManager: unknown,
    config: unknown,
): string {
    const configToolCallId = readNestedString(
        config,
        [
            "toolCall",
            "id",
        ],
    ) || readNestedString(
        config,
        [
            "metadata",
            "toolCallId",
        ],
    );
    const managerToolCallId = readNestedString(
        runManager,
        [
            "toolCall",
            "id",
        ],
    );
    return configToolCallId || managerToolCallId;
}
```

同时新增 `readNestedString`：

```ts
function readNestedString(
    value: unknown,
    path: string[],
): string {
    let currentValue = value;
    for (const key of path) {
        if (typeof currentValue !== "object" || currentValue === null) {
            return "";
        }
        currentValue = (currentValue as Record<string, unknown>)[key];
    }
    return typeof currentValue === "string" && currentValue.length > 0
        ? currentValue
        : "";
}
```

- [ ] **步骤 3：使用统一 ID**

把原来的：

```ts
const toolCallId = randomUUID();
```

替换为：

```ts
const runtimeToolCallId = resolveRuntimeToolCallId(
    runManager,
    config,
);
const toolCallId = runtimeToolCallId || randomUUID();
```

- [ ] **步骤 4：运行静态回归**

运行：`node scripts/check-chat-process-card-regression.mjs`

预期：通过，输出 `对话过程卡片体验回归检查通过。`

### 任务 5：补半截工具意图回归

**文件：**
- 修改：`scripts/check-center-incomplete-tool-intent.ts`

- [ ] **步骤 1：扩展假模型文本**

把假模型返回文本改成当前真实复现文本：

```text
content: "我先看 GitHub 今日趋势，再重点过滤 AI/LLM/Agent/模型工程相关项目。",
```

- [ ] **步骤 2：强化断言**

在事件断言里要求存在 `message.turn.incomplete`，且不存在助手消息固化：

```ts
assert(
  events.some((event) => event.eventType === "message.turn.incomplete"),
  "半截工具意图必须写入 message.turn.incomplete。",
);
assert(
  !events.some((event) => event.eventType === "message.created" && (event.payload as {role?: string}).role === "assistant"),
  "半截工具意图不能固化为助手最终回复。",
);
assert(
  !events.some((event) => event.eventType === "turn.updated" && event.status === "completed"),
  "半截工具意图不能把轮次标记为 completed。",
);
```

- [ ] **步骤 3：运行测试验证失败**

运行：`pnpm exec tsx scripts/check-center-incomplete-tool-intent.ts`

预期：失败，当前实现会把半截文本固化为助手回复或 completed 轮次。

### 任务 6：实现半截工具意图收尾

**文件：**
- 修改：`services/center/src/deepagents-agent.ts`

- [ ] **步骤 1：新增半截意图判定函数**

在 `finalizeDeepAgentTurn` 前新增：

```ts
function isIncompleteToolIntentText(
    assistantText: string,
    modelResult: ProviderModelGatewayResult | null,
): boolean {
    const normalizedText = assistantText.trim();
    if (normalizedText.length === 0 || modelResult?.toolCalls.length) {
        return false;
    }
    const intentPatterns = [
        /我先看/u,
        /再重点过滤/u,
        /继续(查询|执行|调用|检查)/u,
        /改用.+(工具|命令|MCP)/u,
        /准备(调用|执行|查询|检查)/u,
        /下一步.+(调用|执行|查询|检查)/u,
    ];
    const hasIntent = intentPatterns.some((pattern) => {
        return pattern.test(normalizedText);
    });
    const hasFinalAnswerSignal = /结论|总结|推荐|如下|分别是|已经完成|结果是/u.test(normalizedText);
    return hasIntent && !hasFinalAnswerSignal;
}
```

- [ ] **步骤 2：新增不完整收尾函数**

```ts
async function failIncompleteToolIntentTurn(
    input: DeepAgentsAgentRunInput,
    assistantText: string,
): Promise<void> {
    const failureReason = "MODEL_INCOMPLETE_TOOL_INTENT";
    input.events.append({
        eventType: "message.turn.incomplete",
        scopeType: "turn",
        scopeId: input.sent.turnId,
        sessionId: input.sent.sessionId,
        turnId: input.sent.turnId,
        taskId: input.sent.taskId,
        status: "failed",
        title: "模型返回了未完成执行意图",
        summary: "模型表达了继续调用工具的意图，但没有返回结构化工具调用，本轮已失败收尾。",
        payload: {
            failureReason,
            assistantTextPreview: assistantText.slice(0, 240),
        },
    });
    updateTurnStatus(
        input.database,
        input.events,
        input.sent.turnId,
        "failed",
        input.sent.taskId,
    );
}
```

- [ ] **步骤 3：在完成收尾前拦截**

在 `runDeepAgentsAgentTurn` 计算 `assistantText` 后、调用 `finalizeDeepAgentTurn` 前加入：

```ts
if (isIncompleteToolIntentText(
    assistantText,
    finalModelResult,
)) {
    await failIncompleteToolIntentTurn(
        runtimeInput,
        assistantText,
    );
    return;
}
```

- [ ] **步骤 4：运行半截意图回归**

运行：`pnpm exec tsx scripts/check-center-incomplete-tool-intent.ts`

预期：通过，输出脚本自身通过信息。

### 任务 7：验证相关回归脚本

**文件：**
- 不修改代码，只执行验证。

- [ ] **步骤 1：运行过程卡片回归**

运行：`pnpm exec tsx scripts/check-chat-turn-render-order.ts`

预期：通过。

- [ ] **步骤 2：运行静态过程卡片回归**

运行：`node scripts/check-chat-process-card-regression.mjs`

预期：通过。

- [ ] **步骤 3：运行半截工具意图回归**

运行：`pnpm exec tsx scripts/check-center-incomplete-tool-intent.ts`

预期：通过。

- [ ] **步骤 4：运行工具闭环回归**

运行：`pnpm exec tsx scripts/check-center-model-tool-loop.ts`

预期：通过；如果出现 Windows 日志清理 `EPERM` 噪声，先区分是否为业务断言失败。

### 任务 8：同步事实源与收尾

**文件：**
- 修改：`设计.md`
- 修改：`功能清单与关系.md`
- 检查：`需求.md`
- 检查：`架构.md`

- [ ] **步骤 1：回查文档**

确认 `需求.md` 已覆盖以下事实：工具过程完整展示、半截工具意图不能完成、工具调用闭环、轮次终态事件。

- [ ] **步骤 2：同步 `设计.md`**

若实现细节与本计划一致，在 `对话过程卡片与模型中途文字设计` 或新增一级标题中记录：

```md
- ⏳ 同一工具调用中，真实工具完成输出优先作为卡片正文，模型回填结果只表示回填状态，不重复展示同一结果正文。
- ⏳ 模型只返回继续执行意图但没有结构化工具调用时，中心服务写入 `message.turn.incomplete` 并失败收尾，不固化助手最终回复。
```

- [ ] **步骤 3：同步 `功能清单与关系.md`**

修订 `命令工具过程卡片与轮次终态展示` 或新增一行 MCP 卡片功能，明确最小回归包含：

```md
同一 `toolCallId` 的 MCP 完成输出和模型回填不能重复展示；半截工具意图不能进入 completed。
```

- [ ] **步骤 4：查看工作区改动**

运行：`git status --short`

预期：只包含本次修复相关文件。

## 自检

- 规格覆盖：MCP 卡片重复、工具调用 ID 不一致、半截工具意图错误完成均有任务覆盖。
- 占位符扫描：计划不包含未细化实现；每个代码变更步骤都有明确路径和代码片段。
- 类型一致性：`toolCallId`、`message.turn.incomplete`、`model.tool.result.appended`、`tool.mcp.completed` 使用现有事件字段。
