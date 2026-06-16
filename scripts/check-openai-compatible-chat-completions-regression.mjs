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

assertIncludes(
    modelGatewayRuntime,
    "ChatOpenAICompletions",
    "OpenAI 兼容供应商必须使用 ChatOpenAICompletions，避免 ChatOpenAI 因 gpt-5 系列模型名自动切换 Responses API。",
);
assertIncludes(
    modelGatewayRuntime,
    "new ChatOpenAICompletions",
    "模型网关必须实例化强制 Chat Completions 的 LangChain 模型。",
);
assertIncludes(
    modelGatewayRuntime,
    "普通 ChatOpenAI 会因 gpt-5 系列模型名自动切到 Responses API",
    "模型网关必须用中文注释说明不能继续依赖 ChatOpenAI 自动路由。",
);

console.log("OpenAI 兼容供应商 Chat Completions 路径静态回归检查通过。");
