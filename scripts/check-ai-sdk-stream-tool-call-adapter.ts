import {strict as assert} from "node:assert";

import {convertAiSdkStreamPartForLangChainTest} from "../services/center/src/model-provider/AiSdkChatModelAdapter.js";

/**
 * main：验证 AI SDK 流式工具调用能被转换为 LangChain 结构化工具调用 chunk。
 *
 * 约束：该脚本只验证适配器边界，不启动中心服务，不调用真实供应商。
 */
async function main(): Promise<void> {
    const textChunk = convertAiSdkStreamPartForLangChainTest(
        {
            type: "text-delta",
            id: "text-0",
            text: "我会复用后台页面。",
        },
        0,
    );
    assert.ok(textChunk, "文本片段应该转换为 LangChain chunk");
    assert.equal(textChunk.text, "我会复用后台页面。");

    const toolChunk = convertAiSdkStreamPartForLangChainTest(
        {
            type: "tool-call",
            toolCallId: "call_stream_tool_1",
            toolName: "mcp__chrome-devtools__select_page",
            input: {
                pageId: 1,
                bringToFront: false,
            },
        },
        0,
    );
    assert.ok(toolChunk, "工具调用片段应该转换为 LangChain chunk");
    assert.equal(toolChunk.text, "");
    assert.equal(toolChunk.message.content, "");
    assert.equal(toolChunk.message.tool_call_chunks?.length, 1);

    const toolCallChunk = toolChunk.message.tool_call_chunks?.[0];
    assert.equal(toolCallChunk?.type, "tool_call_chunk");
    assert.equal(toolCallChunk?.id, "call_stream_tool_1");
    assert.equal(toolCallChunk?.name, "mcp__chrome-devtools__select_page");
    assert.equal(toolCallChunk?.args, "{\"pageId\":1,\"bringToFront\":false}");
    assert.equal(toolCallChunk?.index, 0);

    assert.deepEqual(
        toolChunk.message.additional_kwargs,
        {},
        "工具调用不应再通过 additional_kwargs 重复注入，避免 LangChain 合并时污染 content block",
    );
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
