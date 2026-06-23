/**
 * AI SDK 工具 JSON Schema 兼容检查。
 *
 * 用途：验证 MCP adapter 这类直接提供 JSON Schema 的 LangChain 工具可以被 AI SDK 适配层转换。
 * 参数：无。
 * 返回值：检查通过时正常退出；转换抛错或 schema 不符合预期时抛错。
 */
import type {StructuredToolInterface} from "@langchain/core/tools";

import {convertStructuredToolsForAiSdkTest} from "../services/center/src/model-provider/AiSdkChatModelAdapter";

/** assert：统一抛出检查失败。 */
function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

/** main：执行 JSON Schema 工具转换回归检查。 */
async function main(): Promise<void> {
    const tool = {
        name: "mcp__chrome-devtools__take_snapshot",
        description: "读取当前页面快照。",
        schema: {
            type: "object",
            properties: {
                verbose: {
                    type: "boolean",
                    description: "是否读取完整可访问性树。",
                },
            },
            additionalProperties: false,
        },
    } as unknown as StructuredToolInterface;

    const tools = convertStructuredToolsForAiSdkTest([tool]);
    const convertedTool = tools?.["mcp__chrome-devtools__take_snapshot"];
    assert(Boolean(convertedTool), "AI SDK 工具转换结果缺少 MCP 工具");
    assert(Boolean(convertedTool?.inputSchema), "AI SDK 工具转换结果缺少 inputSchema");

    const schema = await convertedTool.inputSchema.jsonSchema;
    assert(typeof schema === "object" && schema !== null, "AI SDK 工具 inputSchema 未返回 JSON Schema 对象");
    assert((schema as {type?: unknown}).type === "object", "AI SDK 工具 inputSchema 类型不是 object");
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
