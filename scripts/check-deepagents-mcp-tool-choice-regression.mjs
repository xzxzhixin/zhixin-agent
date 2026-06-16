import {readFileSync} from "node:fs";
import {join} from "node:path";

const rootDirectory = process.cwd();
const policyPath = join(
    rootDirectory,
    "services",
    "center",
    "src",
    "StructuredTool",
    "tool-choice-policy.ts",
);
const deepAgentsPath = join(
    rootDirectory,
    "services",
    "center",
    "src",
    "deepagents-agent.ts",
);
const mcpToolSpecsPath = join(
    rootDirectory,
    "services",
    "center",
    "src",
    "StructuredTool",
    "mcp-tool-specs.ts",
);
const deepAgentsToolMiddlewarePath = join(
    rootDirectory,
    "services",
    "center",
    "src",
    "StructuredTool",
    "deepagents-tool-middleware.ts",
);
const mcpAdapterConfigPath = join(
    rootDirectory,
    "services",
    "center",
    "src",
    "StructuredTool",
    "mcp-adapter-config.ts",
);
const toolChoiceMiddlewarePath = join(
    rootDirectory,
    "services",
    "center",
    "src",
    "AgentMiddleware",
    "CenterToolChoiceMiddleware.ts",
);

const policySource = readFileSync(
    policyPath,
    "utf8",
);
const deepAgentsSource = readFileSync(
    deepAgentsPath,
    "utf8",
);
const mcpToolSpecsSource = readFileSync(
    mcpToolSpecsPath,
    "utf8",
);
const deepAgentsToolMiddlewareSource = readFileSync(
    deepAgentsToolMiddlewarePath,
    "utf8",
);
const mcpAdapterConfigSource = readFileSync(
    mcpAdapterConfigPath,
    "utf8",
);
const toolChoiceMiddlewareSource = readFileSync(
    toolChoiceMiddlewarePath,
    "utf8",
);

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function assertNotContains(source, pattern, message) {
    assert(
        !pattern.test(source),
        message,
    );
}

assertNotContains(
    policySource,
    /shouldForceCommandToolChoice|resolveForcedMcpToolChoice|buildForcedToolChoice|tool_choice/u,
    "tool-choice-policy.ts 不得继续保留按用户文本固定解析并强制工具选择的入口。",
);
assertNotContains(
    deepAgentsSource,
    /shouldForceCommandToolChoice|resolveForcedMcpToolChoice|buildForcedCommandToolChoice|buildForcedToolChoice/u,
    "deepagents-agent.ts 不得继续通过用户文本固定解析强制命令或 MCP 工具。",
);
assertNotContains(
    deepAgentsSource,
    /shouldRepairForcedMcpToolName/u,
    "deepagents-agent.ts 不得把模型返回的空工具名修正为固定工具。",
);
assertNotContains(
    deepAgentsSource,
    /toolChoice:\s*["{]/u,
    "deepagents-agent.ts 不得在中心服务侧强制指定工具选择。",
);
assertNotContains(
    mcpToolSpecsSource,
    /registerDynamicMcpModelToolName|createMcpModelToolNameRegistry|readMcpDynamicToolName|toDynamicMcpModelToolName|MCP_MODEL_TOOL_NAME_MAX_LENGTH/u,
    "mcp-tool-specs.ts 不得继续维护自建 MCP 短名注册表，Deep Agents MCP 主路径必须使用官方 @langchain/mcp-adapters。",
);
assert(
    /resolveEmptyToolNameByArguments/u.test(toolChoiceMiddlewareSource),
    "CenterToolChoiceMiddleware.ts 必须在结构化参数唯一匹配工具 schema 时恢复空工具名。",
);
assert(
    /toolSchemaMatchesArgumentKeys/u.test(toolChoiceMiddlewareSource)
    && /latestModelTools/u.test(toolChoiceMiddlewareSource)
    && /readToolSchemaPropertyNames/u.test(toolChoiceMiddlewareSource),
    "CenterToolChoiceMiddleware.ts 必须基于当前可见工具 schema 做通用空工具名恢复，不能只识别命令工具参数。",
);
assert(
    /model\.tool_call\.name_restored/u.test(toolChoiceMiddlewareSource),
    "CenterToolChoiceMiddleware.ts 必须记录空工具名恢复诊断事件。",
);
assert(
    /registerHarnessProfile/u.test(deepAgentsSource)
    && /DEEPAGENTS_BUILTIN_TOOL_NAMES/u.test(deepAgentsSource)
    && /providerName of \["openai", "anthropic"\]/u.test(deepAgentsSource)
    && /excludedTools/u.test(deepAgentsSource),
    "deepagents-agent.ts 必须注册中心服务专用 Deep Agents profile，排除默认内置工具，避免模型工具表被非中心工具污染。",
);
assert(
    /"write_todos"/u.test(deepAgentsSource)
    && /"read_file"/u.test(deepAgentsSource)
    && /"task"/u.test(deepAgentsSource),
    "deepagents-agent.ts 必须明确排除 Deep Agents 默认 todo、文件和 task 工具。",
);
assert(
    /MultiServerMCPClient/u.test(deepAgentsToolMiddlewareSource)
    || /createMcpAdapterClient/u.test(deepAgentsToolMiddlewareSource),
    "deepagents-tool-middleware.ts 必须通过官方 @langchain/mcp-adapters 注入 MCP tools。",
);
assert(
    /getTools\(\)/u.test(deepAgentsToolMiddlewareSource),
    "deepagents-tool-middleware.ts 必须使用 MultiServerMCPClient.getTools() 获取官方 LangChain MCP tools。",
);
assert(
    /wrapMcpAdapterToolsForCenter/u.test(deepAgentsToolMiddlewareSource),
    "deepagents-tool-middleware.ts 必须包装官方 MCP tools，以保留中心服务审计、结果回填和失败收尾。",
);
assertNotContains(
    deepAgentsToolMiddlewareSource,
    /DynamicMcpStructuredTool|listConfiguredMcpModelToolSpecs|readMcpDynamicToolName/u,
    "deepagents-tool-middleware.ts 不得继续使用自建动态 MCP 结构化工具主路径。",
);
assert(
    /@langchain\/mcp-adapters/u.test(mcpAdapterConfigSource)
    && /MultiServerMCPClient/u.test(mcpAdapterConfigSource),
    "mcp-adapter-config.ts 必须以官方 @langchain/mcp-adapters 的 MultiServerMCPClient 作为 MCP client 配置目标。",
);

console.log("Deep Agents 官方 MCP adapter 回归检查通过。");
