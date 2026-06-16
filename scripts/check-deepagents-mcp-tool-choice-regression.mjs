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
    /resolveProjectPathOnlyIdeaContextTool/u.test(toolChoiceMiddlewareSource)
    && /mcp__idea__get_all_open_file_paths/u.test(toolChoiceMiddlewareSource),
    "CenterToolChoiceMiddleware.ts 必须兼容供应商返回空工具名且仅带 projectPath 的 IDEA 只读上下文工具调用。",
);
assert(
    /normalizeMcpToolArguments/u.test(mcpToolWrapperSource)
    && /resolveCurrentProjectPath/u.test(mcpToolWrapperSource)
    && /projectPath:\s*currentProjectPath/u.test(mcpToolWrapperSource),
    "McpToolWrapperStructuredTool.ts 必须把 IDEA MCP 空 projectPath 或根路径补全为当前项目会话路径，避免模型选对工具但参数为空时触发 MCP schema 异常。",
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
    && /this\.adapterTool\.invoke\(normalizedArg\)/u.test(mcpToolWrapperSource),
    "McpToolWrapperStructuredTool.ts 必须继承中心服务 StructuredTool 基类，并由官方 adapter tool 执行 MCP tools/call。",
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
