# Deep Agents 官方 MCP Adapter 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将 Deep Agents MCP 工具主路径改为官方 `@langchain/mcp-adapters` 的 `MultiServerMCPClient.getTools()`，删除自建动态 MCP 结构化工具调用主路径。

**架构：** 中心服务继续保存 MCP 配置、权限、审计和 UI 事件；MCP 协议发现与调用交给 LangChain 官方 adapter。Deep Agents 每轮创建前读取中心目录 MCP 配置，构造官方 MCP client，获取 LangChain tools，包一层中心审计 wrapper 后传给 `createDeepAgent`。

**技术栈：** TypeScript、Deep Agents、LangChain JS、`@langchain/mcp-adapters`、中心服务 `StructuredTool` 分层。

---

### 任务 1：官方 adapter 规则约束

**文件：**
- 修改：`scripts/check-deepagents-mcp-tool-choice-regression.mjs`

- [ ] **步骤 1：把旧短名注册表断言改成官方 adapter 断言**

脚本必须断言 `services/center/src/StructuredTool/deepagents-tool-middleware.ts` 使用 `MultiServerMCPClient` 或官方 adapter helper，且不能再引用 `DynamicMcpStructuredTool`。

- [ ] **步骤 2：保留工具自主选择和空工具名恢复约束**

继续保留“不按用户文本强制 tool_choice”“空工具名只能按结构化参数唯一匹配恢复”“Deep Agents 默认工具排除”的断言。

### 任务 2：依赖与配置转换

**文件：**
- 修改：`services/center/package.json`
- 修改：`pnpm-lock.yaml`
- 创建：`services/center/src/StructuredTool/mcp-adapter-config.ts`

- [ ] **步骤 1：新增官方 adapter 依赖**

添加精确依赖 `@langchain/mcp-adapters`。

- [ ] **步骤 2：实现中心 MCP 配置到 adapter 配置的转换**

从 `readAllMcpServerConfigs(centerDirectory)` 转换 stdio/http 配置，供 `MultiServerMCPClient` 使用。

### 任务 3：MCP 工具 wrapper

**文件：**
- 创建：`services/center/src/StructuredTool/McpAdapterStructuredTool.ts`

- [ ] **步骤 1：包装官方 adapter 返回的 LangChain tool**

包装类继承 `CenterStructuredToolBase`，保留官方 tool 的 `name`、`description` 和 `schema`。

- [ ] **步骤 2：执行时调用官方 tool**

`executeTool` 只调用官方 tool 的 `invoke`，并将结果归一化成文本回填模型；异常转换为失败结果。

### 任务 4：Deep Agents 工具注入切换

**文件：**
- 修改：`services/center/src/StructuredTool/deepagents-tool-middleware.ts`
- 修改：`services/center/src/StructuredTool/index.ts`
- 修改：`services/center/src/StructuredTool/tool-model-specs.ts`

- [ ] **步骤 1：用 `MultiServerMCPClient.getTools()` 替代自建 MCP 动态工具实例化**

MCP 权限通过时，创建官方 MCP client，获取 tools，再包装为中心服务 wrapper 后加入 Deep Agents tools。

- [ ] **步骤 2：模型提示中的可用 MCP 名称来自官方 adapter tools**

`listAvailableModelToolSpecsForCenter` 不再调用旧 `listConfiguredMcpModelToolSpecs`，改为返回 adapter 发现到的工具名和 schema。

### 任务 5：删除旧 MCP 主路径

**文件：**
- 删除：`services/center/src/StructuredTool/DynamicMcpStructuredTool.ts`
- 删除或停止导出：`services/center/src/StructuredTool/mcp-tool-executor.ts`
- 修改：`services/center/src/StructuredTool/mcp-tool-specs.ts`

- [ ] **步骤 1：删除 DynamicMcpStructuredTool**

确保源码不再引用该文件。

- [ ] **步骤 2：保留管理页只读 MCP 工具查看能力**

`mcp-tool-specs.ts` 可继续保留 `listConfiguredMcpToolViews*`，但不再作为 Deep Agents 工具调用主路径。

### 任务 6：事实源文档同步

**文件：**
- 修改：`需求.md`
- 修改：`设计.md`
- 修改：`架构.md`
- 修改：`功能清单与关系.md`

- [ ] **步骤 1：把 MCP 动态工具主路径改成官方 adapter**

文档中不再要求短名注册表和自建 `DynamicMcpStructuredTool` 作为主路径。

- [ ] **步骤 2：明确中心服务职责**

中心服务只负责 MCP 配置来源、权限过滤、审计事件、UI 过程和失败收尾，不重写官方 MCP 协议调用。
