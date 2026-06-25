# Deep Agents 工具失败继续执行设计

## 目标

- 修复 MCP 工具调用失败被中心服务观测层提升为整轮失败的问题。
- 让 Deep Agents 原生 ReAct 循环继续处理工具失败后的下一步决策。
- 避免为 `new_page`、导航超时或具体 MCP 工具写死恢复逻辑。

## 范围

- 覆盖 Deep Agents 工具调用流观测、MCP 工具失败回填、轮次失败收尾边界。
- 不新增 Chrome DevTools 专用逻辑。
- 不改变中心服务 MCP 审计、过程卡片、取消信号和 `write_todos` 任务步骤桥接。

## 设计要点

- `McpToolWrapperStructuredTool` 继续捕获官方 adapter tool 异常，写入 `tool.mcp.failed`，并返回 `status = failed` 与失败文本。
- `CenterStructuredToolBase` 继续把工具结果通过 `model.tool.result.appended` 回填模型；失败文本也是模型可见工具结果。
- `deepagents-agent.ts` 的 `recordToolCallLifecycle` 只作为 Deep Agents 工具调用流观测层：写入 `tool.plan.created`、`tool.plan.completed` 或 `tool.plan.failed`，不再因为普通工具计划失败直接抛错终止轮次。
- Deep Agents 最终是否失败由 `run.output` 或 Deep Agents 原生执行异常决定；真实执行异常仍进入现有 `failDeepAgentTurn`。
- 用户取消、中心服务运行时中止和重复同工具同参数同错误失败阻断仍允许终止轮次。
- `write_todos` 到 `task_steps` 的桥接继续只在工具计划完成且输出可解析时执行。

## 数据流

1. 模型调用 MCP 工具，例如 Chrome DevTools `new_page`。
2. MCP adapter 工具因导航超时或其他执行异常返回失败。
3. 中心服务工具包装层写入 MCP 失败事件，并把失败文本作为工具结果回填模型。
4. Deep Agents 原生循环看到工具结果后继续下一轮模型调用。
5. 模型可以自行调用 `list_pages`、`select_page`、`take_snapshot` 或其他可用工具复用已有状态。
6. Deep Agents 最终形成助手消息时，中心服务按既有流程固化消息、任务和轮次终态。

## 错误处理

- 普通 MCP 工具失败：展示失败过程卡片，回填模型，轮次继续。
- 普通内联工具失败：按工具自己的返回语义处理；观测层不额外提升为整轮失败。
- 重复失败阻断：同一轮次内同一工具、同一参数、同一错误第二次出现时，`CenterStructuredToolBase` 继续抛出 `TOOL_REPEATED_FAILURE`，避免无限循环。
- 取消或中止：`throwIfTurnRuntimeAborted` 继续让当前轮次退出，不回填迟到工具结果。
- Deep Agents 原生运行异常：仍由 `failDeepAgentTurn` 创建失败总结并写入终态。

## 验收口径

- Chrome DevTools `new_page` 导航超时后，中心服务不直接把整轮标记失败。
- 页面能展示 `new_page` 对应 MCP 失败卡片。
- 模型能继续调用后续 Chrome DevTools 工具，并有机会复用已创建页面完成查询。
- 代码中不出现针对 `new_page`、Chrome DevTools 工具名或导航超时文本的硬编码恢复分支。
- 重复同工具同参数同错误失败仍会阻断，避免循环重试。
- Deep Agents 真正运行异常时，现有失败总结和轮次终态仍正常写入。

## 文档同步

- `设计.md` 需要补充 Deep Agents 工具失败继续执行边界。
- `功能清单与关系.md` 需要把“Deep Agents 直接终态收尾”回归点补充为：普通工具计划失败不直接导致整轮失败。
- `需求.md` 和 `架构.md` 已有“工具调用失败进入事件、Deep Agents 原生工具循环继续、不能写死具体 MCP 工具名”的上游约束，本设计不新增上游产品能力。
