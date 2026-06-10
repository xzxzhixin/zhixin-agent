import {createErrorResponse, createSuccessResponse} from "../helpers.js";
import {countComposerContextTokens} from "../domain/tokenizer-domain.js";
import type {CenterApiRouteContext} from "./route-context.js";

/**
 * registerTokenizerRoutes：注册 tokenizer 资源路由。
 *
 * @param context 中心服务 API 注册共享上下文。
 * @returns 路由注册完成后没有返回值。
 */
export function registerTokenizerRoutes(context: CenterApiRouteContext): void {
    const {
        app,
        database,
    } = context;

    app.post("/api/tokenizer/count", async (request) => {
            const body = request.body as {
                sessionId?: string | null;
                draftText?: string;
                referenceSummaries?: string[];
                attachmentSummaries?: string[];
                modelId?: string;
                windowLimitTokens?: number;
            };
    
            if (!Array.isArray(body.referenceSummaries) || !Array.isArray(body.attachmentSummaries)) {
                return createErrorResponse(
                    "TOKENIZER_COUNT_INVALID",
                    "tokenizer 统计缺少引用或附件摘要数组",
                    "上下文统计信息不完整。",
                );
            }
    
            return createSuccessResponse(countComposerContextTokens(
                database,
                {
                    sessionId: body.sessionId ?? null,
                    draftText: body.draftText ?? "",
                    referenceSummaries: body.referenceSummaries,
                    attachmentSummaries: body.attachmentSummaries,
                    modelId: body.modelId ?? "",
                    windowLimitTokens: body.windowLimitTokens ?? 0,
                },
            ));
        });
}
