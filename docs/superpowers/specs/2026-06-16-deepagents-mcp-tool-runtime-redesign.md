# Deep Agents MCP 工具运行时重建设计

## 背景

当前对话执行主链路已经要求 MCP 工具只通过官方 `@langchain/mcp-adapters` 的 `MultiServerMCPClient.getTools()` 暴露给 Deep Agents。实际运行中，IDEA MCP 工具返回的 `structuredContent` 可能与 MCP Server 声明的输出 schema 不一致，导致 adapter 或包装层抛错，并进一步让中心服务轮次停留在运行中或服务异常。

本次只覆盖 Agent 对话执行主链路中的 Deep Agents MCP tools 注入、调用、结果规范化和失败收尾。MCP 管理页工具查看、MCP 配置文件格式和前端入口不在本次重写范围。

## 目标

- 删除当前 Deep Agents 注入 MCP tools 的旧装配链路，按清晰模块边界重建。
- MCP 工具发现和协议调用只使用官方 `MultiServerMCPClient.getTools()` 返回的 LangChain tools。
- 中心服务继续保留权限、审计、会话项目路径补参、结果摘要和失败收尾边界。
- MCP Server 返回内容与声明 schema 不一致时，不能导致中心服务停机、轮次长期运行或页面停留在“重连中/执行中”。

## 非目标

- 不重写 MCP 管理页 `tools/list` 查看链路。
- 不改变 MCP Server 配置 JSON 格式。
- 不按用户提示词硬编码选择 MCP 工具。
- 不绕过中心服务直接把官方 adapter tool 暴露为无审计、无权限的裸工具。

## 方案

采用“Provider + Wrapper + ResultNormalizer”三层结构重建 Deep Agents MCP 工具运行时。

### McpToolProvider

`McpToolProvider` 负责从中心服务事实源读取当前会话可用 MCP 配置，创建官方 `MultiServerMCPClient`，调用 `getTools()` 获取本轮可注入的官方 adapter tools。

它只处理：

- `centerDirectory`、`projectId` 和当前会话项目路径输入。
- 全局和项目级 MCP 配置读取。
- 官方 adapter client 创建。
- `getTools()` 工具发现。
- 当前智能体工具权限过滤前的 MCP 工具候选输出。

它不处理：

- 工具审计事件。
- UI 摘要。
- 模型回填文本。
- MCP 调用失败收尾。

### McpToolWrapperStructuredTool

`McpToolWrapperStructuredTool` 负责把每个官方 adapter tool 包装成中心服务 `StructuredTool`。

它必须：

- 继承当前中心服务 `StructuredTool` 基类体系。
- 权限边界统一映射为 `builtin.mcp.call`。
- 调用前写入 `tool.mcp.started`。
- 调用完成写入 `tool.mcp.completed`。
- 调用失败写入 `tool.mcp.failed`。
- IDEA MCP 工具收到空 `projectPath` 或根路径 `/` 时，只能使用当前项目会话登记的 `latestPath` 补全。
- 不读取用户原始提示词，也不按提示词修正工具名或参数。

### McpToolResultNormalizer

`McpToolResultNormalizer` 负责把官方 adapter tool 的返回值规范化成三类结果：

- 模型回填文本：优先取官方 adapter 返回的 `content` 文本；如果 content 是对象数组，只提取文本项并序列化必要对象。
- UI 摘要：生成短摘要用于过程卡片，避免把巨大 artifact 直接塞进标题或摘要。
- 审计 artifact：保留 `structuredContent`、`artifact`、原始错误和 trace 信息，供排查使用。

`structuredContent` 与 MCP Server 声明 schema 不一致时，不得让 schema mismatch 继续向外扩散为中心服务进程异常。规范化层应把它转成可审计 artifact，并用文本结果或结构化失败结果回填 Deep Agents。

### 工具工厂文件边界

`DeepAgentsToolFactory.ts` 只承担 Deep Agents 当前轮次工具工厂职责：

- 合并命令工具、agent/team 工具和 MCP provider 输出。
- 注册工具到当前 Deep Agents 轮次。
- 不内嵌 MCP adapter 配置转换、结果规范化、IDEA 参数补全或审计包装细节。

不属于 `AgentMiddleware` 基类体系的工具工厂不得使用 middleware 命名；真正的 Agent middleware 必须放在 `services/center/src/AgentMiddleware` 并继承项目中间件基类。

## 失败收尾

MCP 工具调用失败分两层处理：

- 工具层失败：写入 `tool.mcp.failed`，生成可回填模型的失败文本，允许 Deep Agents 基于失败结果继续生成最终回复。
- 运行时突破失败：由当前 Deep Agents 轮次统一失败收尾，写入轮次终态和任务终态，前端停止运行中展示。

任何单个 MCP 工具 schema、返回值或连接异常都不能导致中心服务进程退出。

## 验收口径

- `mcp__idea__get_all_open_file_paths` 返回 `structuredContent` 与声明 schema 不一致时，轮次不会卡在运行中，中心服务不会停机。
- MCP 工具成功时，页面展示真实 MCP 调用过程和摘要，模型收到规范化后的文本结果。
- MCP 工具失败时，页面展示失败卡片或失败回复，发送按钮恢复可用。
- 代码检索不再出现 Deep Agents MCP 对话主链路依赖自建动态 MCP 短名注册表、自写 `tools/call` 或按提示词强制选择 IDEA MCP 工具。
- `DeepAgentsToolFactory.ts` 不使用 middleware 命名，只承担工具工厂装配职责。

## 文档同步

- `需求.md` 当前已覆盖官方 MCP adapter 主路径和中心服务包装边界，本次无需新增产品需求。
- `设计.md` 需要在实现完成后同步 MCP 工具运行时重建的实际模块边界。
- `架构.md` 需要在实现完成后同步 provider、StructuredTool、normalizer 和工具工厂文件边界。
- `功能清单与关系.md` 需要在实现完成后同步 Deep Agents MCP 官方 adapter 真实调用链路的最小回归范围。
