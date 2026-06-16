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
const deepAgentsToolFactoryPath = join(
    rootDirectory,
    "services",
    "center",
    "src",
    "StructuredTool",
    "DeepAgentsToolFactory.ts",
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
const mcpToolProviderPath = join(
    rootDirectory,
    "services",
    "center",
    "src",
    "StructuredTool",
    "McpToolProvider.ts",
);
const mcpToolWrapperPath = join(
    rootDirectory,
    "services",
    "center",
    "src",
    "StructuredTool",
    "McpToolWrapperStructuredTool.ts",
);
const mcpToolResultNormalizerPath = join(
    rootDirectory,
    "services",
    "center",
    "src",
    "StructuredTool",
    "McpToolResultNormalizer.ts",
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
const deepAgentsToolFactorySource = readFileSync(
    deepAgentsToolFactoryPath,
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
const mcpToolProviderSource = readFileSync(
    mcpToolProviderPath,
    "utf8",
);
const mcpToolWrapperSource = readFileSync(
    mcpToolWrapperPath,
    "utf8",
);
const mcpToolResultNormalizerSource = readFileSync(
    mcpToolResultNormalizerPath,
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
assertNotContains(
    toolChoiceMiddlewareSource,
    /resolveEmptyToolNameByArguments|toolSchemaMatchesArgumentKeys|readToolSchemaPropertyNames|latestModelTools/u,
    "CenterToolChoiceMiddleware.ts 不得继续保留按参数或 schema 恢复空工具名的链路。",
);
assertNotContains(
    toolChoiceMiddlewareSource,
    /model\.tool_call\.name_restored|model\.tool_call\.name_restore_failed/u,
    "CenterToolChoiceMiddleware.ts 不得继续记录空工具名恢复事件。",
);
assertNotContains(
    toolChoiceMiddlewareSource,
    /resolveProjectPathOnlyIdeaContextTool|mcp__idea__get_all_open_file_paths/u,
    "CenterToolChoiceMiddleware.ts 不得在逻辑代码硬编码具体 MCP 工具名。",
);
assert(
    /model\.tool_call\.name_missing/u.test(toolChoiceMiddlewareSource)
    && /MODEL_TOOL_NAME_MISSING/u.test(toolChoiceMiddlewareSource)
    && /lastModelMessage/u.test(toolChoiceMiddlewareSource)
    && /buildModelMessageDiagnostics/u.test(toolChoiceMiddlewareSource),
    "CenterToolChoiceMiddleware.ts 必须把模型空工具名作为协议错误记录并带上最后模型输出诊断。",
);
assertNotContains(
    mcpToolWrapperSource,
    /normalizeMcpToolArguments|resolveCurrentProjectPath|toolSchemaHasProjectPath|projectPath:\s*currentProjectPath/u,
    "McpToolWrapperStructuredTool.ts 不得继续做 MCP 工具参数补参，参数必须按官方 adapter tool 原样执行。",
);
assertNotContains(
    mcpToolWrapperSource,
    /mcp__idea__get_all_open_file_paths/u,
    "McpToolWrapperStructuredTool.ts 不得硬编码具体 MCP 工具名处理参数或描述。",
);
assert(
    /isContentAndArtifactOutput/u.test(mcpToolResultNormalizerSource)
    && /isMcpTextContentBlock/u.test(mcpToolResultNormalizerSource),
    "McpToolResultNormalizer.ts 必须优先提取官方 adapter content 文本，避免 MCP content/artifact 重复回填模型和前端卡片。",
);
assert(
    /toolNames: tools\.map/u.test(deepAgentsSource)
    && /description: tool\.description/u.test(deepAgentsSource),
    "deepagents-agent.ts 必须在工具快照中记录当前模型真实可见的工具名和描述，便于排查 MCP 管理页与模型注入差异。",
);
assert(
    !/excludedTools/u.test(deepAgentsSource)
    && !/DEEPAGENTS_BUILTIN_TOOL_NAMES/u.test(deepAgentsSource),
    "deepagents-agent.ts 不得在回归脚本要求下恢复 Deep Agents 默认工具排除；工具选择应以当前实际注入工具快照为准。",
);
assert(
    /buildMcpToolsForDeepAgents/u.test(deepAgentsToolFactorySource),
    "DeepAgentsToolFactory.ts 必须通过 McpToolProvider 提供 MCP tools。",
);
assertNotContains(
    deepAgentsToolFactorySource,
    /MultiServerMCPClient|createMcpAdapterClient|getTools\(\)|invoke\(normalizedArg\)|normalizeMcpToolArguments|normalizeMcpAdapterOutput/u,
    "DeepAgentsToolFactory.ts 只能做工具装配，不得承载 MCP client、getTools、参数补全或结果规范化细节。",
);
assert(
    /createMcpAdapterClient/u.test(mcpToolProviderSource)
    && /getTools\(\)/u.test(mcpToolProviderSource)
    && /McpToolWrapperStructuredTool/u.test(mcpToolProviderSource),
    "McpToolProvider.ts 必须通过官方 MCP adapter client getTools() 并返回中心服务包装后的 MCP tools。",
);
assert(
    /class McpToolWrapperStructuredTool/u.test(mcpToolWrapperSource)
    && /extends CenterStructuredToolBase/u.test(mcpToolWrapperSource)
    && /this\.adapterTool\.invoke\(arg\)/u.test(mcpToolWrapperSource),
    "McpToolWrapperStructuredTool.ts 必须继承中心服务 StructuredTool 基类，并由官方 adapter tool 原样执行 MCP tools/call。",
);
assert(
    /normalizeMcpToolResult/u.test(mcpToolResultNormalizerSource)
    && /modelText/u.test(mcpToolResultNormalizerSource)
    && /auditArtifact/u.test(mcpToolResultNormalizerSource),
    "McpToolResultNormalizer.ts 必须输出模型文本、UI 摘要和审计 artifact。",
);
assertNotContains(
    deepAgentsToolFactorySource,
    /DynamicMcpStructuredTool|listConfiguredMcpModelToolSpecs|readMcpDynamicToolName/u,
    "DeepAgentsToolFactory.ts 不得继续使用自建动态 MCP 结构化工具主路径。",
);
assert(
    /@langchain\/mcp-adapters/u.test(mcpAdapterConfigSource)
    && /MultiServerMCPClient/u.test(mcpAdapterConfigSource),
    "mcp-adapter-config.ts 必须以官方 @langchain/mcp-adapters 的 MultiServerMCPClient 作为 MCP client 配置目标。",
);

console.log("Deep Agents 官方 MCP adapter 回归检查通过。");
