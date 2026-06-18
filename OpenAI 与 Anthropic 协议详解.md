# OpenAI 与 Anthropic 协议详解

## 文档目的

本文是后续供应商接入、模型协议选择、工具调用解析、异常诊断的开发规范。

核心目标：

- 明确 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages / Tool Use 的结构差异。
- 明确本项目后续推荐使用的协议形态。
- 明确工具调用只能来自协议规定的结构化字段，不能从普通文本里猜测或恢复。
- 记录本次 Deep Agents / OpenAI 兼容模型工具调用形态漂移问题的结论。

## 本项目协议结论

### 推荐协议

| 供应商类型 | 推荐协议 | 项目配置建议 | 原因 |
| --- | --- | --- | --- |
| OpenAI 兼容供应商 | OpenAI Chat Completions | `protocolPluginId: "openai-langchain"`，`protocolMode: "chat-completions"` | 工具调用结构稳定，LangChain 和 Deep Agents 能稳定标准化为 `AIMessage.tool_calls`。 |
| Anthropic 供应商 | Anthropic Messages / Tool Use | 使用 Anthropic 原生 Messages 工具协议，由 LangChain Anthropic 模型承接 | Anthropic 的工具调用本来就在 `content[]` 的 `tool_use` block 中，协议语义明确。 |
| OpenAI Responses | 暂不作为 OpenAI 兼容供应商主路径 | 仅在后续单独完成兼容验证后再纳入 | Responses 是 output item / content block 模型，很多兼容网关支持不完整，容易和 Chat Completions 工具循环混淆。 |

### 工具调用判定原则

- OpenAI Chat Completions 只认 `message.tool_calls`。
- OpenAI Chat Completions 流式只认 `delta.tool_calls` 拼接后的工具调用。
- Anthropic Messages 只认 assistant `content[]` 中的 `tool_use` block。
- 普通 `text` block 中即使夹带 `id`、`name`、`args`，也不能当作工具调用执行。
- 中心服务可以记录畸形结构用于诊断，但不能把畸形文本反解析成工具调用。

## OpenAI Chat Completions

OpenAI Chat Completions 是本项目接入 OpenAI 兼容供应商的主路径。

### 普通文本

模型直接返回文本时，助手消息通常只有 `content`。

```json
{
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "你好，有什么可以帮助你的？"
      },
      "finish_reason": "stop"
    }
  ]
}
```

处理规则：

- 没有 `tool_calls` 时，按普通助手文本处理。
- `finish_reason: "stop"` 表示当前轮次自然结束。

### 非流式工具调用

模型决定调用工具时，必须通过 `message.tool_calls` 返回结构化工具调用。

```json
{
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": null,
        "tool_calls": [
          {
            "id": "call_abc123",
            "type": "function",
            "function": {
              "name": "write_todos",
              "arguments": "{\"todos\":[{\"content\":\"打开页面\",\"status\":\"pending\"}]}"
            }
          }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ]
}
```

处理规则：

- 工具名只从 `tool_calls[].function.name` 读取。
- 工具参数只从 `tool_calls[].function.arguments` 读取。
- `finish_reason: "tool_calls"` 表示需要执行工具并回填结果。
- `content` 可以为空，也可以带一段过程说明，但工具执行仍然必须以 `tool_calls` 为准。

### 工具结果回填

工具执行完成后，结果通过 `role: "tool"` 回填。

```json
{
  "role": "tool",
  "tool_call_id": "call_abc123",
  "content": "{\"ok\":true}"
}
```

处理规则：

- `tool_call_id` 必须对应上一次助手消息里的 `tool_calls[].id`。
- 不能用工具名替代 `tool_call_id`。
- 一个助手消息中如果有多个工具调用，每个工具调用都要有对应结果。

### 流式工具调用

流式响应中，工具调用通过 `choices[].delta.tool_calls[]` 分片返回。

```json
{
  "choices": [
    {
      "index": 0,
      "delta": {
        "tool_calls": [
          {
            "index": 0,
            "id": "call_abc123",
            "type": "function",
            "function": {
              "name": "write_todos",
              "arguments": ""
            }
          }
        ]
      },
      "finish_reason": null
    }
  ]
}
```

```json
{
  "choices": [
    {
      "index": 0,
      "delta": {
        "tool_calls": [
          {
            "index": 0,
            "function": {
              "arguments": "{\"todos\""
            }
          }
        ]
      },
      "finish_reason": null
    }
  ]
}
```

处理规则：

- 同一个 `index` 的 `function.arguments` 需要按顺序拼接。
- 同一个 `index` 或同一个 `id` 的工具名只允许被非空 `function.name` 设置。
- 后续空字符串 `function.name` 不能覆盖前面已经收到的非空工具名。
- 最终以拼接后的工具调用对象进入 LangChain / Deep Agents 工具循环。

### reasoning_content

部分 OpenAI 兼容模型会返回 `reasoning_content`。

```json
{
  "message": {
    "role": "assistant",
    "content": "最终答案是 42。",
    "reasoning_content": "这里是模型推理摘要。"
  }
}
```

处理规则：

- `reasoning_content` 仅用于调试或日志。
- 不用 `reasoning_content` 推断工具调用。
- 不把 `reasoning_content` 当作最终用户可见文本。

## OpenAI Responses

OpenAI Responses API 的核心模型是 `output[]` 与多类型 item / content block。

简化形态如下：

```json
{
  "id": "resp_abc123",
  "object": "response",
  "output": [
    {
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "我会先检查项目结构。"
        }
      ]
    }
  ]
}
```

它和 Chat Completions 的区别：

- Chat Completions 以 `choices[].message` 为核心。
- Responses 以 `output[]` item 为核心。
- Chat Completions 的工具调用在 `message.tool_calls`。
- Responses 的工具调用是 output item / block 语义，不等同于 `message.tool_calls`。

本项目当前不推荐把 OpenAI 兼容供应商主路径切到 Responses，原因是：

- 很多 OpenAI 兼容网关宣称兼容 OpenAI，但主要兼容的是 Chat Completions。
- Responses 的 block 语义和 LangChain / Deep Agents 当前稳定工具循环不完全一致。
- 兼容网关若把工具调用相关字段塞进普通文本 block，会造成工具协议形态漂移。
- 中心服务不能为兼容网关的畸形输出补充猜测逻辑，否则会破坏工具执行安全边界。

## Anthropic Messages / Tool Use

Anthropic Messages 的工具协议和 OpenAI Chat Completions 不同。Anthropic 的工具调用本来就是 assistant `content[]` 里的 `tool_use` block。

### 请求结构

Anthropic 的 `system` 是顶层字段，`messages` 通常只包含 `user` 与 `assistant`。

```json
{
  "model": "claude-sonnet-4-5",
  "system": "你是一个项目助手。",
  "messages": [
    {
      "role": "user",
      "content": "帮我列一个排查计划。"
    }
  ],
  "tools": [
    {
      "name": "write_todos",
      "description": "写入待办事项。",
      "input_schema": {
        "type": "object",
        "properties": {
          "todos": {
            "type": "array"
          }
        },
        "required": [
          "todos"
        ]
      }
    }
  ]
}
```

### 工具调用

Anthropic 的工具调用形态是 `tool_use`。

```json
{
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "我会先整理排查步骤。"
    },
    {
      "type": "tool_use",
      "id": "toolu_abc123",
      "name": "write_todos",
      "input": {
        "todos": [
          {
            "content": "检查最新日志",
            "status": "pending"
          }
        ]
      }
    }
  ],
  "stop_reason": "tool_use"
}
```

处理规则：

- `type: "tool_use"` 是 Anthropic 工具调用的合法形态。
- 普通 `type: "text"` 仍然只是文本。
- 即使 `text` block 中出现类似工具字段，也不能当作工具调用。

### 工具结果回填

Anthropic 的工具结果通过下一条 `user` 消息中的 `tool_result` block 回填。

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_abc123",
      "content": "{\"ok\":true}"
    }
  ]
}
```

处理规则：

- `tool_use_id` 必须对应 assistant `tool_use.id`。
- 工具结果属于 `user` 消息的 `content[]` block，不是 OpenAI 风格的 `role: "tool"`。

### 流式事件

Anthropic 流式常见事件包括：

- `message_start`
- `content_block_start`
- `content_block_delta`
- `content_block_stop`
- `message_delta`
- `message_stop`

工具调用相关内容会围绕 `tool_use` block 分片输出。最终以 Anthropic SDK / LangChain 标准化后的工具调用为准。

## 核心差异对照

| 对比项 | OpenAI Chat Completions | OpenAI Responses | Anthropic Messages / Tool Use |
| --- | --- | --- | --- |
| 主结构 | `choices[].message` | `output[]` | 顶层 message，内容在 `content[]` |
| 系统提示 | `messages[]` 中的 `system` / `developer` | input / instructions 体系 | 顶层 `system` |
| 用户消息 | `role: "user"` | input item | `role: "user"` |
| 助手文本 | `message.content` | `output_text` 等 content item | `content[]` 中的 `type: "text"` |
| 工具定义 | `tools[].function.parameters` | tools item | `tools[].input_schema` |
| 工具调用 | `message.tool_calls[]` | output item / block | `content[]` 中的 `type: "tool_use"` |
| 流式工具调用 | `delta.tool_calls[]` | response output delta 事件 | `content_block_*` 事件 |
| 工具结果回填 | `role: "tool"` + `tool_call_id` | 对应 Responses item | `role: "user"` + `tool_result` block |
| 停止原因 | `finish_reason: "tool_calls"` | response status / item 状态 | `stop_reason: "tool_use"` |
| 本项目推荐 | OpenAI 兼容供应商主路径 | 暂不作为主路径 | Anthropic 供应商主路径 |

## 本次 Deep Agents 工具调用问题复盘

### 现象

Deep Agents / OpenAI 兼容模型曾出现普通 `text` block 夹带工具调用字段的畸形输出。

```json
{
  "type": "text",
  "text": "我会先打开 GitHub Trending 并控制窗口数量，再筛选今天 AI 相关项目。",
  "id": "call_vOs2kx9TGc79ZR10UuarGyqu",
  "name": "write_todos",
  "args": "{\"todos\":[...]}"
}
```

这个结构不是合法 OpenAI Chat Completions 工具调用。

合法形态应该是：

- OpenAI Chat Completions：`message.tool_calls[]`
- OpenAI Chat Completions 流式：`delta.tool_calls[]`
- LangChain 标准化后：`AIMessage.tool_calls`
- Anthropic：`content[]` 中的 `type: "tool_use"`

### 排查结论

本次问题的核心结论：

- 旧配置下，OpenAI 兼容模型输出曾出现工具协议形态漂移。
- 漂移形态是把工具调用字段塞进普通 `type: "text"` block。
- 这不是 Deep Agents 内置 `write_todos` 独有的业务问题，而是工具协议结构问题。
- 旧失败链路中，中心服务正确识别了 `hasMalformedTextToolCallBlock: true`，并按 `MALFORMED_TEXT_TOOL_CALL_BLOCK` 续跑预算处理。
- 预算耗尽后进入 `waiting_user:MALFORMED_TEXT_TOOL_CALL_BLOCK_BUDGET_EXHAUSTED`，不是中心服务卡死。
- 用户更新供应商配置并重启服务后，功能恢复正常，说明新配置生效后真实链路已经回到标准 Chat Completions 工具调用形态。

当前推荐配置：

```json
{
  "protocolPluginId": "openai-langchain",
  "protocolMode": "chat-completions",
  "supportsToolCalling": true,
  "supportsStreaming": true
}
```

### 为什么不能恢复 text 里的工具调用

中心服务不能把普通文本里的 `id`、`name`、`args` 反解析成工具调用，原因是：

- 这不是 OpenAI Chat Completions 的合法工具调用字段。
- 普通文本属于模型可生成内容，不能作为可信执行指令来源。
- 反解析会把协议错误变成隐式执行能力，扩大工具调用安全风险。
- 一旦按文本猜测工具名或参数，就会破坏 LangChain / Deep Agents 的标准工具循环。
- 后续任何供应商漂移都应该通过供应商配置、协议适配或模型侧修复处理，而不是在中心服务里猜。

## 代码规范依据

当前中心服务相关处理边界如下：

- `services/center/src/OpenAiCompatibleChatCompletionsModel.ts`
  - 负责 OpenAI 兼容 Chat Completions 模型适配。
  - 只允许修正流式 `delta.tool_calls` 同一 `index` / `id` 下后续空 `function.name` 覆盖首段非空工具名的问题。
  - 不允许按参数、用户提示词、工具列表或文本内容推断工具名。
- `services/center/src/AgentMiddleware/CenterToolChoiceMiddleware.ts`
  - 负责识别 `text content block + id/name/args + 无 tool_calls` 的畸形结构。
  - 只记录诊断，不恢复工具调用。
- `services/center/src/agent-runtime/AgentCompletionGate.ts`
  - 对 `hasMalformedTextToolCallBlock` 返回 `MALFORMED_TEXT_TOOL_CALL_BLOCK`，触发受控续跑。
  - 续跑预算耗尽后进入等待用户状态。
- `services/center/src/deepagents-agent.ts`
  - Deep Agents 主入口通过 `createDeepAgent({ model, tools, systemPrompt, middleware })` 创建。
  - Deep Agents 内置 planning 工具由 Deep Agents 自身注入，不一定出现在中心服务业务工具快照中。
- `services/center/src/model-gateway-runtime.ts`
  - OpenAI 兼容供应商应通过 `OpenAiCompatibleChatCompletionsModel` 创建 Chat Completions 模型。

## 后续开发规范

1. OpenAI 兼容供应商默认使用 `openai-langchain` + `chat-completions`。
2. Anthropic 供应商使用 Anthropic Messages / Tool Use 原生协议。
3. 工具执行只认协议规定的结构化工具字段。
4. OpenAI Chat Completions 工具调用只认 `message.tool_calls` 和流式拼接后的 `delta.tool_calls`。
5. Anthropic 工具调用只认 `content[]` 中的 `type: "tool_use"`。
6. 普通 `type: "text"` block 中出现 `id`、`name`、`args` 时，只记录诊断，不执行工具。
7. 供应商配置变更后必须重启服务，确保运行时模型实例重新读取配置。
8. 诊断日志应记录原始模型消息摘要、协议模式、供应商 ID、模型名、是否存在标准工具调用、是否存在畸形 text 工具字段。
9. 不允许通过用户提示词、工具名列表、参数形状、历史工具调用来猜测当前工具调用。
10. 如果未来要支持 OpenAI Responses，必须作为独立协议适配层实现，并完成非流式、流式、工具调用、工具结果回填、Deep Agents 工具循环的端到端验收。

## 最终结论

本次问题可以归因为旧供应商配置下的协议形态不匹配或兼容网关输出漂移。

重启服务后功能正常，说明当前新配置已经生效，并且 `openai-langchain` + `chat-completions` 是当前项目接入 OpenAI 兼容模型的推荐方案。

后续开发必须坚持一个边界：模型要执行工具，必须输出协议合法的结构化工具调用；中心服务不从普通文本中恢复工具调用。

## 参考入口

- OpenAI Chat API Reference：https://platform.openai.com/docs/api-reference/chat/create
- OpenAI Responses API Reference：https://platform.openai.com/docs/api-reference/responses/create
- Anthropic Messages API Reference：https://docs.anthropic.com/en/api/messages
- Anthropic Streaming Messages：https://docs.anthropic.com/en/api/messages-streaming
