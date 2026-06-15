import {readFileSync} from "node:fs";
import {join} from "node:path";

const rootDirectory = process.cwd();
const policyPath = join(
    rootDirectory,
    "services",
    "center",
    "src",
    "tools",
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
    "tools",
    "mcp-tool-specs.ts",
);
const dynamicMcpStructuredToolPath = join(
    rootDirectory,
    "services",
    "center",
    "src",
    "tools",
    "DynamicMcpStructuredTool.ts",
);
const deepAgentsToolMiddlewarePath = join(
    rootDirectory,
    "services",
    "center",
    "src",
    "tools",
    "deepagents-tool-middleware.ts",
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
const dynamicMcpStructuredToolSource = readFileSync(
    dynamicMcpStructuredToolPath,
    "utf8",
);
const deepAgentsToolMiddlewareSource = readFileSync(
    deepAgentsToolMiddlewarePath,
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
assert(
    /MCP_MODEL_TOOL_NAME_MAX_LENGTH\s*=\s*48/u.test(mcpToolSpecsSource),
    "mcp-tool-specs.ts 必须使用保守长度限制 MCP 动态工具名，避免兼容供应商贴近 OpenAI 上限后丢失工具名。",
);
assert(
    /createMcpModelToolNameRegistry/u.test(mcpToolSpecsSource),
    "mcp-tool-specs.ts 必须通过短名注册表反查 MCP 真实 serverId 和 toolName。",
);
assert(
    /buildReadableMcpToolNamePrefix/u.test(mcpToolSpecsSource),
    "mcp-tool-specs.ts 必须让 MCP 动态工具名保留可读 serverId 和 toolName 前缀。",
);
assertNotContains(
    mcpToolSpecsSource,
    /return `mcp_\$\{encodeHexUtf8\(serverId\)\}_\$\{encodeHexUtf8\(toolName\)\}`/u,
    "MCP 动态工具名不得继续使用超长 hex 全量编码。",
);
assert(
    /resolveEmptyToolNameByArguments/u.test(deepAgentsSource),
    "deepagents-agent.ts 必须在结构化参数唯一匹配工具 schema 时恢复空工具名。",
);
assert(
    /toolSchemaMatchesArgumentKeys/u.test(deepAgentsSource)
    && /latestModelTools/u.test(deepAgentsSource)
    && /readToolSchemaPropertyNames/u.test(deepAgentsSource),
    "deepagents-agent.ts 必须基于当前可见工具 schema 做通用空工具名恢复，不能只识别命令工具参数。",
);
assert(
    /model\.tool_call\.name_restored/u.test(deepAgentsSource),
    "deepagents-agent.ts 必须记录空工具名恢复诊断事件。",
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
    /parametersJsonSchema/u.test(deepAgentsToolMiddlewareSource)
    && /toolSpec\.parametersJsonSchema/u.test(deepAgentsToolMiddlewareSource),
    "deepagents-tool-middleware.ts 必须把 MCP tools/list 发现到的 JSON Schema 传给动态 MCP 结构化工具。",
);
assert(
    /DEEPAGENTS_MCP_TOOL_INJECTION_LIMIT\s*=\s*12/u.test(deepAgentsToolMiddlewareSource)
    && /mcpSpecs\.slice\(/u.test(deepAgentsToolMiddlewareSource),
    "deepagents-tool-middleware.ts 必须限制单轮动态 MCP 工具注入数量，避免大工具表导致兼容供应商返回空工具名。",
);
assert(
    /inputJsonSchema/u.test(dynamicMcpStructuredToolSource)
    && /createMcpToolSchema/u.test(dynamicMcpStructuredToolSource),
    "DynamicMcpStructuredTool.ts 必须基于 MCP 原始 JSON Schema 构造模型可见参数 schema，不能统一暴露任意对象。",
);
assertNotContains(
    dynamicMcpStructuredToolSource,
    /export const MCP_TOOL_SCHEMA\s*=\s*z\.record\(z\.unknown\(\)\)/u,
    "DynamicMcpStructuredTool.ts 不得继续把所有 MCP 工具统一暴露为 z.record(z.unknown())。",
);

console.log("Deep Agents MCP 工具选择回归检查通过。");
