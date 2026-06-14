# Deep Agents 工具三层重构设计

## 背景

当前 `services/center/src/tools` 已经引入 `StructuredTool` 暴露层，但核心工具文件本体仍然混合了三类职责：

- 工具类或工具暴露定义
- 执行逻辑与事件写入
- 管理页/MCP specs 读取

同时，`command-tool.ts`、`mcp-tool.ts` 仍保留旧 `UnifiedToolCallIntent` 转换函数。这与当前项目要求的“复杂功能用 class 组织代码”和用户明确要求的“所有工具都按 middleware 或 `StructuredTool` 继承实现”不一致。

本设计把当前 Deep Agents 主路径和相关管理读取口统一收敛成三层结构，并直接删除旧壳与旧转换口。

## 目标

1. 把当前核心工具统一拆成三层：
   - `StructuredTool` 类
   - 纯执行器 helper
   - middleware 注册器
2. 删除旧 `command-tool.ts` / `mcp-tool.ts` 一类“函数执行器即工具本体”的结构。
3. 删除 `UnifiedToolCallIntent` 在工具目录中的旧转换口。
4. 把 MCP 动态工具 specs、管理页 tool views 和工具执行逻辑分离。

## 范围

### 包含

- `command`
- `mcp`
- `create-long-term-agent`
- `create-sub-agent`
- `create-agent-team`
- `add-agent-team-member`
- `remove-agent-team-member`
- `disband-agent-team`
- `deepagents-tool-middleware.ts`
- `tool-model-specs.ts`
- `tools/index.ts`
- 当前相关静态检查脚本
- `设计.md`、必要的 `需求.md` / `架构.md` 同步

### 不包含

- 中心服务事件表、消息表、任务表结构调整
- WebSocket 协议调整
- 前端 UI 行为调整
- 非当前核心工具范围的无关目录重构

## 方案比较

### 方案 A：保留旧文件名，内部重排

在 `command-tool.ts`、`mcp-tool.ts` 中同时放工具类、执行逻辑和管理读取。

问题：

- 文件职责仍然混合
- 只是把旧函数文件扩展得更复杂
- 不符合本次“工具本体、执行器、注册器分层”的目标

### 方案 B：明确三层，并把管理读取口一起纳入

每个工具拆成：

- `*-structured-tool.ts`
- `*-tool-executor.ts`
- middleware 注册器

MCP 相关再拆出：

- 动态工具 specs
- 管理页 tool views
- 动态工具名编码解码

优点：

- 边界最清楚
- 结构与用户要求完全一致
- 后续新增工具时能稳定复用

缺点：

- 需要修改 import 路径和统一出口
- 改动面大于兼容式方案

### 方案 C：三层拆分，但保留旧兼容转发文件

新结构完整建立，但保留旧 `command-tool.ts` / `mcp-tool.ts` 作为转发层。

问题：

- 旧壳仍然存在
- 与用户“直接移除”的要求冲突

### 结论

采用 **方案 B**。

## 设计

### 1. 工具三层结构

每个核心工具统一采用如下结构：

- `*-structured-tool.ts`
  - 只定义 `class extends CenterStructuredToolBase`
  - 只负责 schema、name、description、调用 executor
- `*-tool-executor.ts`
  - 只负责执行逻辑、事件写入、结果整理、权限关联
  - 不承担模型可见工具定义职责
- `deepagents-tool-middleware.ts`
  - 只负责根据当前 `DeepAgentsToolExecutionContext` 注入实例
  - 不直接编写业务执行逻辑

### 2. MCP 专项拆分

MCP 除了工具类与执行器外，还需要单独拆出读取层：

- `mcp-tool-specs.ts`
  - MCP 动态工具 specs 生成
  - 动态工具名编码解码
  - 管理页 tool views 读取

理由：

- 这些能力不属于工具执行器
- 它们服务于模型可见工具定义和管理页
- 和 `tools/call` 执行逻辑混在一起会继续放大 `mcp` 文件职责

### 3. 旧壳处理

以下旧壳或旧口直接删除，不保留兼容转发：

- `command-tool.ts`
- `mcp-tool.ts`
- `commandRequestFromUnifiedToolIntent`
- `mcpRequestFromUnifiedToolIntent`

如有必要，调用方直接切换到新文件路径和新统一出口。

### 4. 统一出口

`tools/index.ts` 只保留聚合职责：

- 导出工具 capability registry
- 导出 tool model specs
- 导出 middleware
- 导出各 `StructuredTool` 类
- 导出 executor/helper 的必要类型

`index.ts` 不再继续为旧壳结构做兼容转发。

### 5. 代码迁移顺序

1. 先抽 executor
2. 再抽 `StructuredTool` 类
3. 再更新 middleware
4. 再迁移 MCP specs/view 层
5. 最后删除旧壳和旧转换口

这样可以避免在迁移过程中出现一半走新类、一半走旧函数的混杂状态。

## 验收口径

1. `services/center/src/tools` 当前核心工具文件已按三层结构拆分完成。
2. `deepagents-tool-middleware.ts` 只依赖 `StructuredTool` 类实例。
3. `command-tool.ts`、`mcp-tool.ts` 和 `UnifiedToolCallIntent` 旧工具转换口已删除。
4. MCP 动态工具 specs、管理页 tool views 与执行器已分离。
5. 静态检查脚本能断言：
   - 工具类存在
   - middleware 注册存在
   - 旧工具壳和旧转换口不存在

## 风险与约束

1. MCP 文件当前承担的职责最多，拆分时最容易漏掉管理页读取口和动态工具名编码逻辑。
2. `tools/index.ts` 统一出口调整后，可能影响脚本检查和少量中心服务调用方，需要一起回归。
3. 不允许顺手改动无关前端或协议层，以免扩大范围。

## 实施后文档同步要求

实现完成后需要同步检查：

- `设计.md` 清单状态
- `需求.md` 中“middleware + StructuredTool 承载工具”的实现口径
- `架构.md` 中 `services/center/src/tools` 的目录描述
