# AI SDK 工具调用流式适配修复实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:test-driven-development。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 修复 AI SDK 流式工具调用进入 Deep Agents 后丢失结构化 `tool_calls` 的问题。

**架构：** 不从普通 `text` 块恢复工具调用，不修改监督层预算策略。只在 `AiSdkChatModelAdapter` 内修正 AI SDK `fullStream` 到 LangChain `AIMessageChunk` 的结构映射，让 `tool-call` 事件独立生成 LangChain `tool_call_chunks`，并用回归脚本覆盖“文本 + 工具调用”混合输出。

**技术栈：** TypeScript、Vercel AI SDK、LangChain `AIMessageChunk`、项目脚本回归检查。

---

### 任务 1：补充适配器回归脚本

**文件：**
- 创建：`scripts/check-ai-sdk-stream-tool-call-adapter.ts`
- 修改：`package.json`

- [ ] **步骤 1：编写失败的测试**

创建脚本，导入 `convertAiSdkStreamPartForLangChainTest`，构造 `text-delta` 后接 `tool-call` 的 AI SDK 流事件，断言工具调用 chunk 使用 `tool_call_chunks` 且不把 `id/name/args` 放入 text content block。

- [ ] **步骤 2：运行测试验证失败**

运行：`pnpm exec tsx scripts/check-ai-sdk-stream-tool-call-adapter.ts`

预期：当前实现如果导出缺失或 chunk 字段不符合断言，应失败。

### 任务 2：修复流式 chunk 映射

**文件：**
- 修改：`services/center/src/model-provider/AiSdkChatModelAdapter.ts`

- [ ] **步骤 1：导出测试入口**

导出一个测试专用转换入口，复用生产转换逻辑，不复制转换逻辑。

- [ ] **步骤 2：修正 `tool-call` chunk 字段**

确保 `AIMessageChunk` 的 `tool_call_chunks` 项包含 `type: "tool_call_chunk"`、`id`、`name`、`args`、`index`，并且 `content` 为纯文本空字符串。

- [ ] **步骤 3：保持约束**

不得解析 text block 内的 `id/name/args`，不得按提示词或工具名做兼容恢复。

### 任务 3：验证与文档回查

**文件：**
- 修改：`功能清单与关系.md`（仅当验收关系需要新增或调整时）

- [ ] **步骤 1：运行回归脚本**

运行：`pnpm exec tsx scripts/check-ai-sdk-stream-tool-call-adapter.ts`

- [ ] **步骤 2：运行相关现有脚本**

运行：`pnpm exec tsx scripts/check-ai-sdk-tool-json-schema.ts`

- [ ] **步骤 3：按项目规则回查文档**

确认 `需求.md`、`设计.md`、`架构.md`、`功能清单与关系.md` 是否需要同步。
