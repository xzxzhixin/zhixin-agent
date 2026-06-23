import {strict as assert} from "node:assert";

import {HumanMessage, SystemMessage} from "@langchain/core/messages";

import {convertLangChainMessagesForAiSdkTest} from "../services/center/src/model-provider/AiSdkChatModelAdapter.js";

/**
 * main：验证 LangChain system 消息会进入 AI SDK 顶层 system 字段。
 *
 * 约束：该脚本只验证消息适配边界，不启动中心服务，不调用真实供应商。
 */
async function main(): Promise<void> {
    const prompt = convertLangChainMessagesForAiSdkTest([
        new SystemMessage("你是中心服务主智能体。"),
        new HumanMessage("请总结当前任务。"),
        new SystemMessage("输出必须保持中文。"),
    ]);

    assert.equal(
        prompt.system,
        "你是中心服务主智能体。\n\n输出必须保持中文。",
        "多个 LangChain system 消息应该合并到 AI SDK 顶层 system 字段",
    );
    assert.equal(
        prompt.messages.length,
        1,
        "AI SDK messages 不应再包含 system 消息，避免触发 AI SDK 安全警告",
    );
    assert.deepEqual(
        prompt.messages[0],
        {
            role: "user",
            content: "请总结当前任务。",
        },
        "非 system 消息应该保持原有顺序和内容",
    );
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
