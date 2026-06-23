# 供应商数据库化与 AI SDK 统一适配实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将供应商重做为 SQLite 驱动的一等模型来源模块，并通过 Vercel AI SDK 适配给 Deep Agents 使用。

**架构：** 供应商配置写入 `model_providers` 等 SQLite 表，前端和 API 不再暴露插件、协议模式或运行时字段。中心服务通过 `ModelProviderRuntimeFactory -> AiSdkChatModelAdapter -> Vercel AI SDK` 创建 Deep Agents 可用模型，旧文件供应商和旧 `/api/provider/*` 在替换完成后删除。

**技术栈：** Node.js、TypeScript、Fastify、better-sqlite3、Pinia、Vue 3、Element Plus、Deep Agents、LangChain ChatModel、Vercel AI SDK。

---

## 文件结构

- 创建：`services/center/src/data-access/ModelProviderRepository.ts`
  - 职责：集中维护 `model_providers`、`model_provider_models`、`model_provider_settings`、`model_provider_capabilities`、`model_provider_checks` 的 SQL。
- 创建：`services/center/src/model-provider/ModelProviderSourceRegistry.ts`
  - 职责：按 `provider_source` 返回展示名、默认 Base URL、默认能力和 AI SDK provider 创建逻辑。
- 创建：`services/center/src/model-provider/ModelProviderRuntimeFactory.ts`
  - 职责：读取供应商配置和默认模型，创建 Deep Agents 可用模型。
- 创建：`services/center/src/model-provider/AiSdkChatModelAdapter.ts`
  - 职责：实现 LangChain ChatModel 适配层，把 Vercel AI SDK 调用结果转成 LangChain/Deep Agents 消息。
- 创建：`services/center/src/model-provider/ModelProviderStructuredLogger.ts`
  - 职责：记录模型来源、模型名、工具调用诊断、AI SDK 响应摘要和错误。
- 创建：`services/center/src/api/model-provider.ts`
  - 职责：注册 `/api/model-provider/*` REST 接口。
- 修改：`services/center/src/database.ts`
  - 职责：新增 SQLite 表结构初始化。
- 修改：`services/center/src/api-routes.ts`
  - 职责：注册新模型供应商路由，移除旧供应商路由注册。
- 修改：`services/center/src/deepagents-agent.ts`
  - 职责：切换模型创建入口到 `ModelProviderRuntimeFactory`。
- 修改：`services/center/src/domain/agent-domain.ts`
  - 职责：智能体默认供应商和默认模型读取新表。
- 修改：`services/center/src/domain/usage-domain.ts`
  - 职责：用量统计继续记录供应商 ID 和模型名，来源改为新供应商表。
- 修改：`packages/api-client/src/index.ts`
  - 职责：新增 model-provider API 类型和客户端方法，删除旧 provider API 类型。
- 修改：`apps/frontend/src/stores/app-types.ts`
  - 职责：替换前端供应商类型，删除协议插件类型。
- 修改：`apps/frontend/src/stores/app-management-actions.ts`
  - 职责：供应商管理 action 改接 `/api/model-provider/*`。
- 修改：`apps/frontend/src/views/Providers/RouterIndex.vue`
  - 职责：供应商页面重做为模型来源配置，不展示插件 ID、协议模式、runtime 或 AI SDK provider 字段。
- 删除：`services/center/src/domain/provider-domain.ts`
  - 职责：旧文件供应商和协议插件逻辑完成替换后删除。
- 删除：`services/center/src/model-compat/OpenAiCompatibleChatCompletionsModel.ts`
  - 职责：旧 OpenAI 兼容 Chat Completions 主路径完成替换后删除。
- 删除或改写：`services/center/src/model-gateway-runtime.ts`
  - 职责：旧文件供应商模型创建入口替换为新 runtime factory。

## 任务 1：新增数据库表和仓储

**文件：**
- 修改：`services/center/src/database.ts`
- 创建：`services/center/src/data-access/ModelProviderRepository.ts`

- [ ] **步骤 1：在 `database.ts` 增加表结构**

新增表：

```sql
CREATE TABLE IF NOT EXISTS model_providers (
  provider_id TEXT PRIMARY KEY,
  provider_name TEXT NOT NULL,
  provider_source TEXT NOT NULL,
  api_base_url TEXT,
  api_key_secret_ref TEXT,
  custom_headers_json TEXT NOT NULL DEFAULT '{}',
  proxy_mode TEXT NOT NULL DEFAULT 'use-global-default',
  proxy_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

同一迁移块继续创建 `model_provider_models`、`model_provider_settings`、`model_provider_capabilities`、`model_provider_checks`，字段按 `docs/superpowers/specs/2026-06-23-model-provider-ai-sdk-design.md`。

- [ ] **步骤 2：创建仓储类**

创建 `ModelProviderRepository`，只在此文件写 SQL。类方法：

```ts
export class ModelProviderRepository {
    constructor(private readonly database: CenterDatabase) {}
    listProviders(): ModelProviderRecord[] {}
    createProvider(input: CreateModelProviderInput): ModelProviderRecord {}
    updateProvider(input: UpdateModelProviderInput): ModelProviderRecord {}
    deleteProvider(providerId: string): void {}
    saveModels(input: SaveModelProviderModelsInput): void {}
    readProviderForRuntime(providerId: string): ModelProviderRuntimeRecord | null {}
    appendCheck(input: AppendModelProviderCheckInput): void {}
}
```

- [ ] **步骤 3：静态引用检查**

运行：

```powershell
rg -n "model_providers|ModelProviderRepository" services/center/src
```

预期：表名只出现在 `database.ts` 和 `data-access/ModelProviderRepository.ts`。

## 任务 2：定义 API 类型和模型来源枚举

**文件：**
- 修改：`packages/api-client/src/index.ts`
- 创建：`services/center/src/model-provider/ModelProviderSourceRegistry.ts`

- [ ] **步骤 1：新增 API 类型**

新增类型：

```ts
export type ModelProviderSource =
  | "openai"
  | "anthropic"
  | "google"
  | "deepseek"
  | "qwen"
  | "openrouter"
  | "codex"
  | "openai-compatible-custom";
```

新增 `ModelProviderView`、`ModelProviderModelView`、`ModelProviderCapabilityView`、`ModelProviderCheckView`、`CreateModelProviderPayload`、`UpdateModelProviderPayload`、`SaveModelProviderModelsPayload`。

- [ ] **步骤 2：新增模型来源注册表**

创建 `ModelProviderSourceRegistry` 类，提供：

```ts
export class ModelProviderSourceRegistry {
    listSourceOptions(): ModelProviderSourceOption[] {}
    getSourceDefinition(providerSource: ModelProviderSource): ModelProviderSourceDefinition {}
}
```

第一版来源必须包含：OpenAI、Anthropic、Google、DeepSeek、Qwen、OpenRouter、Codex、OpenAI 兼容自定义。

- [ ] **步骤 3：确认未出现 ai-sdk-custom**

运行：

```powershell
rg -n "ai-sdk-custom" packages services apps
```

预期：无结果。

## 任务 3：实现新后端接口

**文件：**
- 创建：`services/center/src/api/model-provider.ts`
- 修改：`services/center/src/api-routes.ts`
- 修改：`packages/api-client/src/index.ts`

- [ ] **步骤 1：注册接口**

在 `model-provider.ts` 注册：

```text
POST /api/model-provider/list
POST /api/model-provider/create
POST /api/model-provider/update
POST /api/model-provider/delete
POST /api/model-provider/source-options
POST /api/model-provider/model/save
POST /api/model-provider/check/run
```

- [ ] **步骤 2：实现接口输入校验**

校验规则：

```ts
providerName: string;
providerSource: ModelProviderSource;
apiBaseUrl?: string | null;
apiKey?: string;
customHeadersJson: "{}" 或 JSON 对象字符串;
proxyMode: "none" | "use-global-default" | "use-specified";
proxyId?: string | null;
```

`enabled=true` 时必须存在默认模型和 API Key secret 引用。

- [ ] **步骤 3：更新 API client**

新增客户端方法：

```ts
listModelProviders()
createModelProvider(payload)
updateModelProvider(payload)
deleteModelProvider(payload)
listModelProviderSourceOptions()
saveModelProviderModels(payload)
runModelProviderCheck(payload)
```

- [ ] **步骤 4：静态路由检查**

运行：

```powershell
rg -n "/api/model-provider|/api/provider" services/center/src packages/api-client/src
```

预期：新路由存在；旧 `/api/provider/*` 只在尚未删除的旧文件中出现。

## 任务 4：重做前端供应商页面

**文件：**
- 修改：`apps/frontend/src/stores/app-types.ts`
- 修改：`apps/frontend/src/stores/app-management-actions.ts`
- 修改：`apps/frontend/src/views/Providers/RouterIndex.vue`

- [ ] **步骤 1：替换前端类型**

删除前端使用的 `providerProtocolPlugins`、`protocolPluginId`、`protocolMode` 相关草稿字段，替换为：

```ts
providerSource: ModelProviderSource;
apiBaseUrl: string;
customHeadersText: string;
defaultModelName: string;
manualModelContextText: string;
reasoningEffortText: string;
```

- [ ] **步骤 2：改写管理 action**

`loadProviders()` 改为调用 `listModelProviders()` 和 `listModelProviderSourceOptions()`。`saveProvider()` 改为提交 `createModelProvider` 或 `updateModelProvider`。模型保存调用 `saveModelProviderModels()`。

- [ ] **步骤 3：改写页面字段**

列表列：

```text
供应商 / 模型来源 / 默认模型 / 接口与密钥 / 状态 / 最近检测 / 操作
```

弹框字段：

```text
供应商名称 / 模型来源 / Base URL / API Key 新值 / 自定义请求头 / 代理策略 / 指定代理 / 默认模型 / 手填模型与上下文 / 推理深度 / 能力声明 / 启用
```

页面不得出现：插件、协议适配器、协议模式、runtime、AI SDK provider。

- [ ] **步骤 4：静态 UI 文案检查**

运行：

```powershell
rg -n "插件|协议适配器|协议模式|protocolPlugin|protocolMode|runtime|AI SDK provider" apps/frontend/src/views/Providers apps/frontend/src/stores
```

预期：供应商页面和供应商 store 不出现这些用户可见字段。

## 任务 5：实现 AI SDK ChatModel 适配器

**文件：**
- 修改：`services/center/package.json`
- 创建：`services/center/src/model-provider/AiSdkChatModelAdapter.ts`
- 创建：`services/center/src/model-provider/ModelProviderStructuredLogger.ts`

- [ ] **步骤 1：新增依赖**

在 `services/center/package.json` 精确添加：

```json
"ai": "当前确认版本",
"@ai-sdk/openai": "当前确认版本",
"@ai-sdk/openai-compatible": "当前确认版本",
"@ai-sdk/anthropic": "当前确认版本",
"@ai-sdk/google": "当前确认版本",
"@openrouter/ai-sdk-provider": "当前确认版本"
```

执行依赖锁定时使用用户系统 Node 和 pnpm，不运行项目级 `tsc`。

- [ ] **步骤 2：实现适配器类**

`AiSdkChatModelAdapter` 继承 LangChain ChatModel 基类，至少实现非流式 `_generate` 和流式 `_streamResponseChunks`。适配职责：

```text
LangChain BaseMessage[] -> AI SDK message input
LangChain StructuredTool[] -> AI SDK tools
AI SDK tool calls -> AIMessage.tool_calls
AI SDK usage -> usage_metadata
AI SDK stream -> ChatGenerationChunk
```

- [ ] **步骤 3：实现日志辅助类**

`ModelProviderStructuredLogger` 记录：

```text
providerId
providerSource
modelName
aiSdkEventSummary
toolCallCount
invalidToolCallCount
usage
errorKind
traceId
```

- [ ] **步骤 4：适配器静态检查**

运行：

```powershell
rg -n "AiSdkChatModelAdapter|streamText|generateText|toolCalls" services/center/src/model-provider
```

预期：适配逻辑只集中在 `model-provider` 目录。

## 任务 6：运行时工厂接入 Deep Agents

**文件：**
- 创建：`services/center/src/model-provider/ModelProviderRuntimeFactory.ts`
- 修改：`services/center/src/deepagents-agent.ts`
- 修改：`services/center/src/AgentMiddleware/CenterModelCallLogMiddleware.ts`

- [ ] **步骤 1：实现运行时工厂**

`ModelProviderRuntimeFactory` 从 `ModelProviderRepository.readProviderForRuntime()` 读取供应商、默认模型、能力、代理策略和密钥引用，返回 `AiSdkChatModelAdapter` 实例。

- [ ] **步骤 2：替换 Deep Agents 模型创建入口**

`deepagents-agent.ts` 不再调用旧 `model-gateway-runtime.ts` 读取文件供应商配置，改为使用 `ModelProviderRuntimeFactory`。

- [ ] **步骤 3：更新模型调用日志中间件**

日志字段改为：

```text
providerId
providerSource
modelName
requestUrl
aiSdkResponseSummary
rawToolCallSummary
usage
```

不再要求 `protocolPluginId` 和 `protocolMode`。

- [ ] **步骤 4：模型路径引用检查**

运行：

```powershell
rg -n "model-gateway-runtime|protocolPluginId|protocolMode|ChatOpenAI|ChatAnthropic" services/center/src
```

预期：Deep Agents 主路径不再依赖这些旧入口；尚未删除的旧文件只在删除任务前可见。

## 任务 7：改接智能体默认供应商和用量统计

**文件：**
- 修改：`services/center/src/domain/agent-domain.ts`
- 修改：`services/center/src/data-access/agent-repository.ts`
- 修改：`services/center/src/domain/usage-domain.ts`
- 修改：`apps/frontend/src/views/AgentManagement/RouterIndex.vue`

- [ ] **步骤 1：智能体默认供应商读取新表**

智能体默认供应商下拉来自 `model_providers.enabled = 1`。默认模型来自 `model_provider_settings.default_model_name` 和 `model_provider_models`。

- [ ] **步骤 2：用量统计保留 providerId**

用量记录继续保存 `providerId` 和 `modelName`，展示时通过 `model_providers.provider_name` 和 `provider_source` 关联。

- [ ] **步骤 3：前端默认模型选择改接新 snapshot**

对话输入区、智能体管理页和相关弹框只消费新供应商列表与模型列表。

- [ ] **步骤 4：引用检查**

运行：

```powershell
rg -n "providers\\[|providerProtocolPlugins|ProviderProtocolPluginView" apps/frontend/src services/center/src packages/api-client/src
```

预期：旧协议插件类型不再被新页面和新 API 使用。

## 任务 8：删除旧供应商文件链路

**文件：**
- 删除：`services/center/src/domain/provider-domain.ts`
- 删除：`services/center/src/model-compat/OpenAiCompatibleChatCompletionsModel.ts`
- 删除或改写：`services/center/src/model-gateway-runtime.ts`
- 修改：`services/center/src/api/provider-routes.ts`
- 修改：`scripts/check-openai-compatible-chat-completions-regression.mjs`

- [ ] **步骤 1：删除旧 API 路由**

移除旧 `/api/provider/*` 注册，确保 `api-routes.ts` 只注册 `/api/model-provider/*`。

- [ ] **步骤 2：删除旧文件供应商读写**

删除 `providers/*.json`、`providers/*.models.json` 主事实源读写逻辑。保留中心目录 `providers` 文件夹只作为历史文件，不读取、不写入、不删除用户文件。

- [ ] **步骤 3：删除旧 ChatOpenAI 兼容包装主路径**

移除 `OpenAiCompatibleChatCompletionsModel` 和旧回归脚本引用。若脚本只服务旧路径，删除脚本；若仍需能力检测，改成 `model-provider` 检测脚本。

- [ ] **步骤 4：全仓旧词检查**

运行：

```powershell
rg -n "protocolPluginId|protocolMode|providerProtocolPlugins|OpenAiCompatibleChatCompletionsModel|/api/provider/" services apps packages scripts
```

预期：只允许文档历史说明中出现，运行代码不出现。

## 任务 9：验证与回归

**文件：**
- 修改：`启动进程.md`
- 修改：`浏览器页面.md`

- [ ] **步骤 1：静态检查**

运行：

```powershell
rg -n "ai-sdk-custom|protocolPluginId|protocolMode|/api/provider/" services apps packages
```

预期：运行代码无结果。

- [ ] **步骤 2：启动桌面壳**

按项目规则先关闭旧 `dev:desktop-shell` 和其拉起的中心服务，再运行：

```powershell
pnpm dev:desktop-shell
```

记录 `{pid} = {port} = {启动命令}` 到 `启动进程.md`。

- [ ] **步骤 3：浏览器真实验收**

使用 Chrome DevTools 打开供应商页，记录 `{pageId} = {pageUrl}` 到 `浏览器页面.md`。真实操作：

```text
新增 openai-compatible-custom
填写 Base URL、API Key、模型列表
保存
启用
运行检测
创建普通对话
触发一次结构化工具调用
```

- [ ] **步骤 4：三种提示词回归**

对同一功能使用三种不同提示词，验证工具调用闭环：

```text
查看当前 Node 和 pnpm 版本。
请用命令确认这个项目当前使用的包管理器版本。
帮我检查本机 Git 版本，并把结果简短说明。
```

- [ ] **步骤 5：旧链路删除检查**

确认不再读取旧供应商文件：

```powershell
rg -n "providers/.*\\.json|providers/.*\\.models\\.json" services/center/src
```

预期：运行代码无结果。

## 自检

- 规格覆盖：数据库、接口、前端、AI SDK 适配、Deep Agents 接入、旧代码删除、验证均有任务。
- 占位符扫描：计划中不使用待实现占位语句；每个任务都列出文件、步骤和检查命令。
- 类型一致性：统一使用 `provider_source`、`ModelProviderRepository`、`ModelProviderRuntimeFactory`、`AiSdkChatModelAdapter`、`/api/model-provider/*`。
