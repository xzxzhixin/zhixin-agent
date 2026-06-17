# 工具卡片重复与半截轮次收尾修复设计

## 目标

- 修复同一 MCP 工具卡片中工具完成结果和模型回填结果重复展示的问题。
- 修复 Deep Agents 工具计划事件和中心服务工具执行事件使用不同 `toolCallId` 导致聚合错乱的问题。
- 修复模型只返回“我先看 / 我将继续 / 我改用工具”等半截执行意图时，中心服务仍把轮次标记为完成的问题。

## 范围

- 覆盖前端过程卡片聚合、中心服务 `StructuredTool` 工具调用 ID 传递、Deep Agents 原生工具计划事件、半截工具意图判定和回归脚本。
- 不改变 MCP adapter 工具发现方式，不恢复旧的按用户提示词解析工具逻辑，不对具体 MCP 工具名写死特殊规则。
- 不改变任务拆解事实表结构，不新增用户可见任务步骤。

## 设计要点

- 前端过程卡片正文以真实工具执行结果为主：同一 `toolCallId` 下已经存在 `tool.mcp.completed.outputSummary`、`tool.command.completed.outputSummary` 或失败事件时，`model.tool.result.appended.resultSummary` 只作为模型回填状态，不再重复拼入正文。
- 去重规则不能只做完全相等判断；当后一个片段是前一个片段的前缀、或前一个片段已经包含后一个片段时，只保留信息更完整的一条。
- `CenterStructuredToolBase` 需要优先继承 Deep Agents/LangChain 传入的工具调用 ID。只有运行时没有传入 ID 时才生成本地 UUID，并在注释中说明这是非模型触发或兼容路径。
- `McpToolWrapperStructuredTool`、`CommandStructuredTool` 和其他 `StructuredTool` 子类继续只接收统一后的 `toolCallId`，不自行生成第二套调用 ID。
- `recordToolCallLifecycle` 写入 `tool.plan.created` 和 `tool.plan.completed` 时，必须使用与 `StructuredTool` 执行事件一致的调用 ID；如果 Deep Agents 流中出现空 `callId`，只能把计划事件绑定到工具安全名和参数摘要，不能生成会与真实执行事件冲突的独立过程卡片。
- 半截工具意图判定只基于模型本次返回内容的形态和本轮工具上下文，不解析用户提示词、不匹配具体工具名。模型返回文本中同时满足“表达继续执行/准备调用/改用工具/下一步操作”和“没有结构化 tool_calls”时，若本轮仍有未完成目标或最近刚完成工具回填，则写入 `message.turn.incomplete`，并把轮次收尾为 `failed` 或 `waiting_user`。
- 半截工具意图不能固化为助手最终回复，也不能写入长期记忆。失败摘要使用稳定短文本，详情放事件 payload。
- 保留正常总结能力：如果模型在工具结果后返回的是明确结论、列表、摘要、建议或最终回答，仍按完成处理。

## 验收口径

- 同一 MCP 工具调用的页面卡片只显示一份工具结果正文，仍保留完成态和回填态。
- 同一工具调用的 `tool.plan.created`、`model.tool.requested`、`tool.mcp.*` 或 `tool.command.*`、`model.tool.result.appended` 使用同一个聚合 ID，页面只形成一张卡片。
- 模型返回“我先看 GitHub 今日趋势，再重点过滤……”但没有继续返回结构化工具调用时，轮次不能标记为 `completed`，不能固化为最终助手回复。
- 正常完成回复不受影响：模型基于工具结果输出明确分析结论时，轮次仍进入 `completed`。
- 回归脚本覆盖 MCP 截断重复、工具调用 ID 统一、半截工具意图失败收尾。

## 清单状态

- ⏳ MCP 卡片正文去重
- ⏳ 工具调用 ID 统一
- ⏳ 半截工具意图收尾
- ⏳ 回归脚本
