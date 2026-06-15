import type {OpenAiChatMessage, OpenAiToolSpec} from "../openai-chat-protocol.js";

/** COMMAND_TOOL_INTERNAL_ID：中心服务内部命令工具 ID，用于权限和执行映射。 */
export const COMMAND_TOOL_INTERNAL_ID = "builtin.command.run";

/** COMMAND_TOOL_MODEL_NAME：模型可见命令工具名，必须符合供应商函数工具命名约束。 */
export const COMMAND_TOOL_MODEL_NAME = "builtin_command_run";

/**
 * LangChainToolChoiceCallOptions：LangChain 模型调用工具选择参数。
 */
export interface LangChainToolChoiceCallOptions {
    /** tool_choice: LangChain 透传给供应商的工具选择配置。 */
    tool_choice?: string | Record<string, unknown>;
}

/**
 * LangChainAgentToolChoice：LangChain Agent 中间件使用的工具选择字段。
 */
export type LangChainAgentToolChoice = "auto" | "none" | "required" | {
    /** type: OpenAI 兼容函数工具选择类型。 */
    type: "function";
    /** function: 指定必须调用的函数工具。 */
    function: {
        /** name: 模型可见工具名。 */
        name: string;
    };
};

/**
 * ModelVisibleToolSummary：工具选择策略只需要模型可见名和来源定位。
 */
export interface ModelVisibleToolSummary {
    /** name: 模型可见工具名，必须符合供应商函数工具命名约束。 */
    name: string;
    /** sourceToolId: 中心服务内部工具 ID；Deep Agents 原生工具流里可能不存在。 */
    sourceToolId?: string;
    /** mcpServerId: 动态 MCP 工具所属 Server ID，来源于已解码的模型安全名。 */
    mcpServerId?: string;
    /** mcpToolName: 动态 MCP 工具真实工具名，来源于已解码的模型安全名。 */
    mcpToolName?: string;
}

/**
 * buildForcedToolChoice：生成指定模型可见工具的强制选择配置。
 *
 * @param modelToolName 模型可见工具名。
 * @returns 供应商兼容的指定函数工具配置。
 */
export function buildForcedToolChoice(modelToolName: string): Extract<LangChainAgentToolChoice, Record<string, unknown>> {
    return {
        type: "function",
        function: {
            name: modelToolName,
        },
    };
}

/**
 * buildForcedCommandToolChoice：生成强制命令工具选择配置。
 *
 * @returns 供应商兼容的指定函数工具配置。
 */
export function buildForcedCommandToolChoice(): Extract<LangChainAgentToolChoice, Record<string, unknown>> {
    return buildForcedToolChoice(COMMAND_TOOL_MODEL_NAME);
}

/**
 * buildLangChainToolChoiceCallOptions：按本轮用户意图构造 LangChain 工具选择选项。
 *
 * @param tools 当前模型可见工具定义。
 * @param messages 当前模型请求消息。
 * @param userText 用户原始输入。
 * @returns LangChain 调用选项；无需强制工具时返回空对象。
 */
export function buildLangChainToolChoiceCallOptions(
    tools: OpenAiToolSpec[],
    messages: OpenAiChatMessage[],
    userText: string,
): LangChainToolChoiceCallOptions {
    if (
        !hasCommandToolAvailable(tools)
        || hasToolResultMessage(messages)
        || !shouldForceCommandToolChoice(userText)
    ) {
        return {};
    }
    // tool_choice: 对供应商必须使用模型可见安全名，内部工具 ID 只留在中心服务权限和执行映射层。
    return {
        tool_choice: buildForcedCommandToolChoice(),
    };
}

/**
 * shouldForceCommandToolChoice：判断用户本轮是否明确要求实际命令执行。
 *
 * @param userText 用户原始输入。
 * @returns 需要强制命令工具时返回 true。
 */
export function shouldForceCommandToolChoice(userText: string): boolean {
    const normalizedText = userText.toLowerCase();
    return [
        "命令工具",
        "执行命令",
        "运行命令",
        "查看我环境",
        "看一下我环境",
        "本机node",
        "本机 node",
        "node环境",
        "node 环境",
        "node版本",
        "node 版本",
        "pnpm版本",
        "pnpm 版本",
        "npm版本",
        "npm 版本",
        "git版本",
        "git 版本",
        "node -v",
        "pnpm -v",
        "npm -v",
        "git --version",
    ].some((keyword) => {
        return normalizedText.includes(keyword);
    });
}

/**
 * resolveForcedMcpToolChoice：把明确 MCP/IDEA 用户意图解析为唯一动态 MCP 工具。
 *
 * @param userText 用户原始输入。
 * @param tools 当前模型可见工具摘要。
 * @returns 需要强制选择的模型工具名；没有明确匹配时返回 null。
 */
export function resolveForcedMcpToolChoice(
    userText: string,
    tools: ModelVisibleToolSummary[],
): string | null {
    if (!shouldForceIdeaOpenFilePathsToolChoice(userText)) {
        return null;
    }
    const matchedTool = tools.find((tool) => {
        return tool.mcpServerId === "idea"
            && tool.mcpToolName === "get_all_open_file_paths";
    });
    return matchedTool?.name ?? null;
}

/**
 * shouldForceIdeaOpenFilePathsToolChoice：判断用户是否明确要求读取 IDEA 当前打开项目路径。
 *
 * @param userText 用户原始输入。
 * @returns 需要强制选择 IDEA MCP 项目路径工具时返回 true。
 */
function shouldForceIdeaOpenFilePathsToolChoice(userText: string): boolean {
    const normalizedText = userText.toLowerCase();
    const hasIdeaKeyword = normalizedText.includes("idea");
    const hasOpenKeyword = [
        "打开",
        "open",
    ].some((keyword) => {
        return normalizedText.includes(keyword);
    });
    const hasProjectPathKeyword = [
        "项目路径",
        "项目目录",
        "project path",
        "project paths",
    ].some((keyword) => {
        return normalizedText.includes(keyword);
    });
    return hasIdeaKeyword
        && hasOpenKeyword
        && hasProjectPathKeyword;
}

/**
 * hasCommandToolAvailable：判断当前工具列表是否包含命令工具。
 *
 * @param tools 当前模型可见工具定义。
 * @returns 可用命令工具存在时返回 true。
 */
export function hasCommandToolAvailable(tools: ModelVisibleToolSummary[]): boolean {
    return tools.some((tool) => {
        return tool.sourceToolId === COMMAND_TOOL_INTERNAL_ID || tool.name === COMMAND_TOOL_MODEL_NAME;
    });
}

/**
 * hasToolResultMessage：判断当前模型请求是否已经包含工具回填结果。
 *
 * @param messages 当前模型请求消息。
 * @returns 已经进入工具结果回填阶段时返回 true。
 */
function hasToolResultMessage(messages: OpenAiChatMessage[]): boolean {
    return messages.some((message) => {
        return message.role === "tool";
    });
}
