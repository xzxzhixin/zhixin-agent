/**
 * 跨窗口长期记忆召回静态回归检查。
 *
 * 用途：验证模型上下文构建使用 Mem0、SQLite memory_index 和 Markdown 来源。
 * 关键逻辑：只检查源码结构，避免依赖模型供应商、中心服务启动或具体用户提示词。
 * 参数：无。
 * 返回值：检查通过时正常退出；任一断言失败时抛错并返回非零退出码。
 */
import {
    readFileSync,
} from "node:fs";

/**
 * readText：读取 UTF-8 源码文件。
 *
 * @param {string} path 源码文件路径。
 * @returns {string} 文件文本。
 */
function readText(path) {
    return readFileSync(
        path,
        "utf-8",
    );
}

/**
 * assert：简单断言。
 *
 * @param {boolean} condition 条件。
 * @param {string} message 失败说明。
 * @returns {void}
 */
function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

const runtime = readText("services/center/src/model-gateway-runtime.ts");
const workflowRepository = readText("services/center/src/data-access/workflow-repository.ts");

assert(
    runtime.includes("searchSemanticMemories"),
    "召回必须继续使用 Mem0 检索。",
);
assert(
    runtime.includes("searchAgentMemorySummaries"),
    "召回必须继续使用 SQLite memory_index 检索。",
);
assert(
    workflowRepository.includes("attachment_refs_json AS attachmentRefsJson"),
    "SQLite 召回必须读取附件来源 JSON。",
);
assert(
    runtime.includes("sourceMemoryPath") && runtime.includes("Markdown："),
    "召回结果必须包含 Markdown 来源路径。",
);
assert(
    runtime.includes("来源会话") && runtime.includes("轮次"),
    "召回注入上下文必须包含来源会话和来源轮次。",
);
assert(
    runtime.includes("附件来源") && runtime.includes("parseAgentMemoryAttachments"),
    "召回上下文必须包含附件来源。",
);
assert(
    runtime.includes("tryParseJsonArray") && runtime.includes("catch") && runtime.includes("return [];"),
    "附件来源 JSON 解析必须容忍坏 JSON 或非数组。",
);
assert(
    runtime.includes("formatMemoryAttachmentForPrompt") && runtime.includes("limitMemoryPromptField"),
    "附件字段注入长期记忆提示前必须逐项限长。",
);
assert(
    runtime.includes("MAIN_AGENT_MEMORY_PROMPT_MAX_CHARS") && runtime.includes("[长期记忆已截断]"),
    "长期记忆提示必须保留总长度上限。",
);
assert(
    !runtime.includes("memory.keywords ||") && !runtime.includes("memory.summary ||"),
    "长期记忆提示不能对必填 keywords/summary 使用默认值兜底。",
);
assert(
    runtime.includes("buildGenericMemorySearchTerms"),
    "召回必须使用通用检索词构造。",
);

const requiredGenericTerms = [
    "\"用户长期事实\"",
    "\"用户偏好\"",
    "\"当天事实\"",
    "\"附件来源\"",
    "\"附件摘要\"",
];

for (const term of requiredGenericTerms) {
    assert(
        runtime.includes(term),
        `通用检索词缺少 ${term}`,
    );
}

assert(
    !runtime.includes("looksLikeIdentityQuestion"),
    "召回逻辑不能保留身份问题专项分支。",
);

const forbiddenHardcodedTerms = [
    "\"徐志翔\"",
    "\"龙虾\"",
    "\"我是谁\"",
    "\"你叫什么\"",
    "\"我叫什么\"",
    "\"请只回复\"",
    "\"回归验证\"",
];

for (const term of forbiddenHardcodedTerms) {
    assert(
        !runtime.includes(term),
        `召回逻辑不能硬编码 ${term}`,
    );
}

console.log("check-memory-recall-cross-window: ok");
