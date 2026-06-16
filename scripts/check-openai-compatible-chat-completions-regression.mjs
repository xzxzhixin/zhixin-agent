/**
 * OpenAI 兼容供应商 Chat Completions 路径静态回归检查。
 *
 * 用途：防止 LangChain 因 gpt-5 系列模型名自动切到 Responses API，
 * 导致兼容供应商返回的工具调用被解析成空工具名。
 * 关键逻辑：只读取模型网关源码，不启动中心服务，不执行 TypeScript 编译。
 */
import fs from "node:fs";
import path from "node:path";

/**
 * readText：读取项目内 UTF-8 文本。
 *
 * @param {string} relativePath 项目相对路径。
 * @returns {string} 文件内容。
 */
function readText(relativePath) {
    return fs.readFileSync(
        path.join(
            process.cwd(),
            relativePath,
        ),
        "utf8",
    );
}

/**
 * assertIncludes：检查文本包含稳定实现信号。
 *
 * @param {string} source 被检查文本。
 * @param {string} needle 必须存在的片段。
 * @param {string} message 失败说明。
 * @returns {void} 没有返回值。
 */
function assertIncludes(
    source,
    needle,
    message,
) {
    if (!source.includes(needle)) {
        console.error(message);
        console.error(`缺少片段：${needle}`);
        process.exit(1);
    }
}

// modelGatewayRuntime: 中心服务供应商模型调用网关。
const modelGatewayRuntime = readText("services/center/src/model-gateway-runtime.ts");
// compatibleChatModel: OpenAI 兼容供应商专用 Chat Completions 模型包装。
const compatibleChatModel = readText("services/center/src/OpenAiCompatibleChatCompletionsModel.ts");

assertIncludes(
    modelGatewayRuntime,
    "OpenAiCompatibleChatCompletionsModel",
    "OpenAI 兼容供应商必须使用 ChatOpenAICompletions，避免 ChatOpenAI 因 gpt-5 系列模型名自动切换 Responses API。",
);
assertIncludes(
    modelGatewayRuntime,
    "new OpenAiCompatibleChatCompletionsModel",
    "模型网关必须实例化强制 Chat Completions 的 LangChain 模型。",
);
assertIncludes(
    modelGatewayRuntime,
    "普通 ChatOpenAI 会因 gpt-5 系列模型名自动切到 Responses API",
    "模型网关必须用中文注释说明不能继续依赖 ChatOpenAI 自动路由。",
);
assertIncludes(
    compatibleChatModel,
    "extends ChatOpenAICompletions",
    "OpenAI 兼容供应商模型包装必须继承 ChatOpenAICompletions。",
);
assertIncludes(
    compatibleChatModel,
    "lastToolCallNames",
    "OpenAI 兼容供应商流式工具调用必须缓存同一工具调用的非空名称。",
);
assertIncludes(
    compatibleChatModel,
    "rawResponse.id",
    "OpenAI 兼容供应商流式工具调用缓存键必须包含当前响应 ID，避免跨轮次串用同一 index。",
);
assertIncludes(
    compatibleChatModel,
    "functionDelta.name.length === 0",
    "OpenAI 兼容供应商流式工具调用必须识别后续空工具名片段。",
);
assertIncludes(
    compatibleChatModel,
    "name: previousToolCallName",
    "OpenAI 兼容供应商流式工具调用必须避免后续空名称覆盖首段真实工具名。",
);
assertIncludes(
    compatibleChatModel,
    "return null",
    "OpenAI 兼容供应商流式工具调用缺少 index 和 id 时不能猜测补齐工具名。",
);

console.log("OpenAI 兼容供应商 Chat Completions 路径静态回归检查通过。");
