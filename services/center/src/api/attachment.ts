import {createErrorResponse, createSuccessResponse} from "../helpers.js";
import {createTemporaryAttachment} from "../domain/usage-domain.js";
import type {CenterApiRouteContext} from "./route-context.js";

/**
 * registerAttachmentRoutes：注册 attachment 资源路由。
 *
 * @param context 中心服务 API 注册共享上下文。
 * @returns 路由注册完成后没有返回值。
 */
export function registerAttachmentRoutes(context: CenterApiRouteContext): void {
    const {
        app,
        config,
    } = context;

    app.post("/api/file/temp/create", async (request) => {
            const body = request.body as {
                fileName?: string;
                mimeType?: string;
                sizeBytes?: number;
            };
    
            if (!body.fileName || !body.mimeType || typeof body.sizeBytes !== "number") {
                return createErrorResponse("TEMP_FILE_CREATE_INVALID", "临时附件缺少必要字段", "临时附件信息不完整。");
            }
    
            return createSuccessResponse(createTemporaryAttachment(config.centerDirectory, body.fileName, body.mimeType, body.sizeBytes));
        });
}
