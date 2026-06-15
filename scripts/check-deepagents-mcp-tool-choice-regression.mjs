import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";

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

const policySource = readFileSync(
    policyPath,
    "utf8",
);
const deepAgentsSource = readFileSync(
    deepAgentsPath,
    "utf8",
);

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function assertContains(source, pattern, message) {
    assert(
        pattern.test(source),
        message,
    );
}

function createPolicyRuntimeModule(source) {
    const temporaryDirectory = mkdtempSync(join(
        tmpdir(),
        "zhixin-mcp-tool-choice-",
    ));
    const modulePath = join(
        temporaryDirectory,
        "tool-choice-policy-runtime.mjs",
    );
    const moduleSource = source
        .replace(/import type .*?;\r?\n/u, "")
        .replace(/export interface LangChainToolChoiceCallOptions \{[\s\S]*?\n\}\r?\n/u, "")
        .replace(/export interface ModelVisibleToolSummary \{[\s\S]*?\n\}\r?\n/u, "")
        .replace(/export type LangChainAgentToolChoice =[\s\S]*?\n\};\r?\n/u, "")
        .replace(/: Extract<LangChainAgentToolChoice, Record<string, unknown>>/gu, "")
        .replace(/: ModelVisibleToolSummary\[\]/gu, "")
        .replace(/: string \| null/gu, "")
        .replace(/: string/g, "")
        .replace(/: boolean/g, "")
        .replace(/: LangChainToolChoiceCallOptions/g, "")
        .replace(/: OpenAiToolSpec\[\]/g, "")
        .replace(/: OpenAiChatMessage\[\]/g, "")
        .replace(/const tools: OpenAiToolSpec\[\] =/g, "const tools =");
    writeFileSync(
        modulePath,
        moduleSource,
        "utf8",
    );
    return {
        modulePath,
        temporaryDirectory,
    };
}

const {
    modulePath,
    temporaryDirectory,
} = createPolicyRuntimeModule(policySource);

try {
    const policy = await import(pathToFileURL(modulePath).href);
    const ideaOpenPathsToolName = "mcp_69646561_6765745f616c6c5f6f70656e5f66696c655f7061746873";
    const forcedChoice = policy.buildForcedToolChoice(ideaOpenPathsToolName);
    assert(
        forcedChoice.function.name === ideaOpenPathsToolName,
        "buildForcedToolChoice 必须使用传入的模型可见工具名。",
    );
    assert(
        policy.resolveForcedMcpToolChoice(
            "查看idea打开的所有项目路径",
            [
                {
                    name: ideaOpenPathsToolName,
                    mcpServerId: "idea",
                    mcpToolName: "get_all_open_file_paths",
                },
            ],
        ) === ideaOpenPathsToolName,
        "resolveForcedMcpToolChoice 必须把明确 IDEA 项目路径意图解析到 get_all_open_file_paths。",
    );
    assert(
        policy.resolveForcedMcpToolChoice(
            "查看idea打开的所有项目路径",
            [
                {
                    name: "mcp_69646561_726561645f66696c65",
                    mcpServerId: "idea",
                    mcpToolName: "read_file",
                },
            ],
        ) === null,
        "resolveForcedMcpToolChoice 不得在目标 MCP 工具不可用时猜测其他工具。",
    );
    assert(
        policy.hasCommandToolAvailable([
            {
                name: "builtin_command_run",
            },
        ]),
        "hasCommandToolAvailable 必须继续识别命令工具模型安全名。",
    );
} finally {
    rmSync(
        temporaryDirectory,
        {
            recursive: true,
            force: true,
        },
    );
}

assertContains(
    deepAgentsSource,
    /readMcpDynamicToolName/u,
    "deepagents-agent.ts 必须解码动态 MCP 工具名并传给工具选择策略。",
);
assertContains(
    deepAgentsSource,
    /shouldRepairForcedMcpToolName/u,
    "deepagents-agent.ts 必须把 MCP 空工具名修正限制在本批强制工具选择内。",
);
assertContains(
    deepAgentsSource,
    /hasRepairedForcedMcpToolName/u,
    "deepagents-agent.ts 必须保证一次强制 MCP 工具选择只修正一次空工具名。",
);
assertContains(
    deepAgentsSource,
    /toolChoice:\s*"none"/u,
    "deepagents-agent.ts 必须在 MCP 工具结果回填后禁用后续工具调用，避免模型继续返回空工具名导致轮次卡住。",
);
assertContains(
    deepAgentsSource,
    /MCP 意图下模型返回空工具名/u,
    "deepagents-agent.ts 必须在明确 MCP 意图下修正空工具名。",
);

console.log("Deep Agents MCP 工具选择回归检查通过。");
