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
    /MCP_MODEL_TOOL_NAME_MAX_LENGTH\s*=\s*64/u.test(mcpToolSpecsSource),
    "mcp-tool-specs.ts 必须限制 MCP 动态工具名不超过 OpenAI 函数名长度上限。",
);
assert(
    /createMcpModelToolNameRegistry/u.test(mcpToolSpecsSource),
    "mcp-tool-specs.ts 必须通过短名注册表反查 MCP 真实 serverId 和 toolName。",
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
    /model\.tool_call\.name_restored/u.test(deepAgentsSource),
    "deepagents-agent.ts 必须记录空工具名恢复诊断事件。",
);

console.log("Deep Agents MCP 工具选择回归检查通过。");
