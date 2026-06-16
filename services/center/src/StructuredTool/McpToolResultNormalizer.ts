/** McpToolNormalizedResult：MCP 工具结果规范化后的三类输出。 */
export interface McpToolNormalizedResult {
    /** modelText: 回填给模型的文本。 */
    modelText: string;
    /** uiSummary: 写入过程卡片的短摘要。 */
    uiSummary: string;
    /** auditArtifact: 只进入审计 payload 的原始结构。 */
    auditArtifact: unknown;
}

/**
 * normalizeMcpToolResult：把官方 MCP adapter 返回值规范化为模型文本、UI 摘要和审计 artifact。
 *
 * @param output 官方 adapter tool 返回值。
 * @returns 规范化后的结果对象。
 */
export function normalizeMcpToolResult(output: unknown): McpToolNormalizedResult {
    const modelText = normalizeMcpModelText(output);
    return {
        modelText,
        uiSummary: modelText.slice(
            0,
            240,
        ),
        auditArtifact: output,
    };
}

/**
 * normalizeMcpModelText：优先提取官方 adapter content 文本。
 *
 * @param output 官方 adapter tool 返回值。
 * @returns 可回填模型的文本。
 */
function normalizeMcpModelText(output: unknown): string {
    if (typeof output === "string") {
        return output;
    }
    if (isContentAndArtifactOutput(output)) {
        return normalizeMcpModelText(output[0]);
    }
    if (isMcpTextContentBlock(output)) {
        return output.text;
    }
    if (Array.isArray(output)) {
        return output.map((item) => normalizeMcpModelText(item)).join("\n");
    }
    if (output && typeof output === "object") {
        return JSON.stringify(
            output,
            null,
            2,
        );
    }
    return String(output ?? "");
}

/**
 * isContentAndArtifactOutput：识别 LangChain content_and_artifact 二元返回值。
 *
 * @param output 官方 adapter tool 返回值。
 * @returns 是 `[content, artifact]` 结构时返回 true。
 */
function isContentAndArtifactOutput(output: unknown): output is [unknown, unknown] {
    return Array.isArray(output)
        && output.length === 2
        && Array.isArray(output[0])
        && Array.isArray(output[1]);
}

/**
 * isMcpTextContentBlock：识别 MCP 文本 content block。
 *
 * @param output 单个输出片段。
 * @returns 是文本片段时返回 true。
 */
function isMcpTextContentBlock(output: unknown): output is {
    /** text: MCP 文本片段正文。 */
    text: string;
} {
    return Boolean(output)
        && typeof output === "object"
        && "type" in output
        && (output as {type?: unknown}).type === "text"
        && typeof (output as {text?: unknown}).text === "string";
}
