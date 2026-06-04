import type {
    TokenizerAdapter,
    TokenizerCountRequest,
    TokenizerCountResponse,
} from "@zhixin/shared";

import type {CenterDatabase} from "./database.js";
import {createDataAccess} from "./data-access/index.js";

/**
 * BuiltInTokenizerAdapter：中心服务内置自研 tokenizer 适配器。
 *
 * 用途：外部 tokenizer 未安装时提供协议化 token 统计能力。
 * 关键逻辑：按 UTF-8 字节和词边界生成稳定片段，不使用字符串长度或字符数作为最终口径。
 */
export class BuiltInTokenizerAdapter implements TokenizerAdapter {
    /** tokenizerId: 适配器 ID，写入统计来源。 */
    readonly tokenizerId = "builtin-byte-segment-tokenizer";

    /** tokenizerName: 用户可见适配器名称。 */
    readonly tokenizerName = "内置字节分段 tokenizer";

    /** source: 统计来源。 */
    readonly source = "built-in" as const;

    /**
     * count：统计上下文包 token。
     *
     * @param request token 统计请求。
     * @returns token 数和来源信息。
     */
    count(request: TokenizerCountRequest): TokenizerCountResponse {
        const inputText = request.segments.map((segment) => {
            return `[${segment.segmentKind}:${segment.sourceId}]\n${segment.content}`;
        }).join("\n\n");
        const usedTokens = tokenizeByUtf8Segments(inputText).length;

        return {
            tokenizerId: this.tokenizerId,
            tokenizerName: this.tokenizerName,
            source: this.source,
            modelId: request.modelId,
            inputRange: request.inputRange,
            usedTokens,
            windowLimitTokens: request.windowLimitTokens,
            includedSegmentKinds: Array.from(new Set(request.segments.map((segment) => {
                return segment.segmentKind;
            }))),
            error: null,
        };
    }
}

/**
 * tokenizeByUtf8Segments：把文本转换为内置 token 片段。
 *
 * @param input 待统计文本。
 * @returns token 片段数组。
 */
export function tokenizeByUtf8Segments(input: string): string[] {
    const tokens: string[] = [];
    let currentAscii = "";

    for (const char of input) {
        if (/[\p{Script=Han}\p{Punctuation}\p{Separator}]/u.test(char)) {
            if (currentAscii.length > 0) {
                tokens.push(currentAscii);
                currentAscii = "";
            }
            if (!/\s/u.test(char)) {
                tokens.push(char);
            }
            continue;
        }

        if (/[\p{Letter}\p{Number}_-]/u.test(char)) {
            currentAscii += char;
            if (Buffer.byteLength(currentAscii, "utf-8") >= 6) {
                tokens.push(currentAscii);
                currentAscii = "";
            }
            continue;
        }

        if (currentAscii.length > 0) {
            tokens.push(currentAscii);
            currentAscii = "";
        }
        tokens.push(char);
    }

    if (currentAscii.length > 0) {
        tokens.push(currentAscii);
    }

    return tokens;
}

/**
 * countComposerContextTokens：按当前会话实际上下文包统计 token。
 *
 * @param database 中心服务数据库。
 * @param request 当前草稿和模型窗口信息。
 * @returns token 统计响应。
 */
export function countComposerContextTokens(
    database: CenterDatabase,
    request: {
        sessionId: string | null;
        draftText: string;
        referenceSummaries: string[];
        attachmentSummaries: string[];
        modelId: string;
        windowLimitTokens: number;
    },
): TokenizerCountResponse {
    const messages = request.sessionId
        ? createDataAccess(database).tokenizer.listMessagesForContext(request.sessionId)
        : [];
    const adapter = new BuiltInTokenizerAdapter();

    return adapter.count({
        modelId: request.modelId || "未选择模型",
        inputRange: "composer-window",
        windowLimitTokens: request.windowLimitTokens,
        segments: [
            {
                segmentKind: "system",
                sourceId: "zhixin-default-system",
                content: "致心智能体对话上下文、工具说明和当前客户端运行约束。",
            },
            ...messages.map((message) => {
                return {
                    segmentKind: "history" as const,
                    sourceId: message.messageId,
                    content: `${message.role}: ${message.contentMarkdown}`,
                };
            }),
            {
                segmentKind: "current-message",
                sourceId: "composer-draft",
                content: request.draftText,
            },
            ...request.referenceSummaries.map((summary, index) => {
                return {
                    segmentKind: "reference" as const,
                    sourceId: `reference-${index + 1}`,
                    content: summary,
                };
            }),
            ...request.attachmentSummaries.map((summary, index) => {
                return {
                    segmentKind: "attachment" as const,
                    sourceId: `attachment-${index + 1}`,
                    content: summary,
                };
            }),
            {
                segmentKind: "tool-description",
                sourceId: "available-tools",
                content: "通用命令工具、插件、MCP、skill、文件引用和模型调用能力描述。",
            },
        ],
    });
}
