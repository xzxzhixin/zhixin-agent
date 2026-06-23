# 供应商数据库化与 AI SDK 统一适配设计

## 目标

- 将供应商重做为中心服务一等模型来源模块，不再作为插件或协议适配器配置。
- 使用 SQLite 保存供应商、模型、默认设置、能力声明和检测结果。
- 统一通过 Vercel AI SDK 接入具体厂家，并由 `AiSdkChatModelAdapter` 适配为 Deep Agents 可用模型。

## 范围

- 覆盖供应商数据库表、后端接口、前端供应商页、模型运行时适配和旧供应商代码删除。
- 不迁移旧 `providers/*.json` 和 `providers/*.models.json` 文件配置。
- 不提供 `ai-sdk-custom`；只保留 `openai-compatible-custom` 作为自定义来源。

## 保存字段原则

- 数据库只保存业务事实：供应商名称、模型来源、连接信息、密钥引用、模型、能力、代理、状态和检测结果。
- 数据库不保存插件 ID、协议模式、runtime、AI SDK provider 包名或适配器实现字段。
- 中心服务代码根据 `provider_source` 映射到 Vercel AI SDK 官方 provider。

## 数据库表

```sql
CREATE TABLE model_providers (
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

CREATE TABLE model_provider_models (
  model_id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  context_window_tokens INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider_id, model_name)
);

CREATE TABLE model_provider_settings (
  provider_id TEXT PRIMARY KEY,
  default_model_name TEXT,
  reasoning_effort TEXT,
  temperature REAL,
  max_output_tokens INTEGER,
  extra_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE model_provider_capabilities (
  provider_id TEXT PRIMARY KEY,
  supports_vision INTEGER NOT NULL DEFAULT 0,
  supports_tool_calling INTEGER NOT NULL DEFAULT 0,
  supports_json_output INTEGER NOT NULL DEFAULT 0,
  supports_reasoning_effort INTEGER NOT NULL DEFAULT 0,
  supports_model_list INTEGER NOT NULL DEFAULT 0,
  supports_streaming INTEGER NOT NULL DEFAULT 1,
  provides_cache_usage INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE model_provider_checks (
  check_id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  check_type TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  checked_at TEXT NOT NULL
);
```

## 后端接口

```text
POST /api/model-provider/list
POST /api/model-provider/create
POST /api/model-provider/update
POST /api/model-provider/delete
POST /api/model-provider/source-options
POST /api/model-provider/model/save
POST /api/model-provider/check/run
```

## 运行时边界

```text
Deep Agents
  -> ModelProviderRuntimeFactory
  -> AiSdkChatModelAdapter
  -> Vercel AI SDK
  -> 具体厂家
```

- `ModelProviderRepository` 只读写新供应商数据库表。
- `ModelProviderSourceRegistry` 维护 `provider_source` 到 AI SDK provider 创建逻辑的代码映射。
- `ModelProviderRuntimeFactory` 根据供应商和模型创建 Deep Agents 可用模型实例。
- `AiSdkChatModelAdapter` 负责消息、工具调用、流式片段、错误和用量适配。

## 前端边界

- 供应商列表展示供应商、模型来源、默认模型、接口与密钥、状态、最近检测和操作。
- 供应商弹框展示名称、模型来源、Base URL、API Key、自定义请求头、代理策略、默认模型、模型上下文、推理深度、能力声明和启用状态。
- 前端不展示插件 ID、协议模式、runtime 或 AI SDK provider 包名。

## 旧代码删除

- 删除旧 `/api/provider/*`。
- 删除旧 `providers/*.json` 和 `providers/*.models.json` 主事实源读写。
- 删除旧协议插件列表与用户配置中的 `protocolPluginId`、`protocolMode`。
- 删除旧 ChatOpenAI/ChatAnthropic 供应商主路径。
- 保留密钥、代理、用量统计、智能体默认供应商和模型调用日志能力，但改接新表与 AI SDK 适配层。

## 验收口径

- 新供应商配置只写入 SQLite。
- 旧文件供应商不再被读取或生成。
- `openai-compatible-custom` 可保存自定义连接和模型。
- Deep Agents 通过 `AiSdkChatModelAdapter` 完成普通文本和结构化工具调用。
- 供应商空工具名或畸形 text 工具块仍按协议错误处理，不恢复执行。
