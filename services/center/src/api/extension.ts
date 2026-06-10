import {createErrorResponse, createSuccessResponse} from "../helpers.js";
import {createDataAccess} from "../data-access/index.js";
import {
    configurePlugin,
    deletePlugin,
    installPlugin,
    listPlugins,
    recordExtensionCall,
    setPluginEnabled,
} from "../domain/extension-domain.js";
import type {CenterApiRouteContext} from "./route-context.js";

/**
 * registerExtensionRoutes：注册 extension 资源路由。
 *
 * @param context 中心服务 API 注册共享上下文。
 * @returns 路由注册完成后没有返回值。
 */
export function registerExtensionRoutes(context: CenterApiRouteContext): void {
    const {
        app,
        database,
        events,
    } = context;

    app.post("/api/plugin/install", async (request) => {
            const body = request.body as {
                manifest?: Record<string, unknown>;
            };
    
            if (!body.manifest) {
                return createErrorResponse(
                    "PLUGIN_MANIFEST_REQUIRED",
                    "插件安装缺少 manifest",
                    "插件清单不能为空。",
                );
            }
    
            return createSuccessResponse(installPlugin(database, events, body.manifest));
        });

    app.post("/api/plugin/enable", async (request) => {
            const body = request.body as {
                pluginId?: string;
            };
    
            if (!body.pluginId) {
                return createErrorResponse("PLUGIN_ID_REQUIRED", "插件启用缺少 pluginId", "插件 ID 不能为空。");
            }
    
            return createSuccessResponse(setPluginEnabled(database, events, body.pluginId, true));
        });

    app.post("/api/plugin/disable", async (request) => {
            const body = request.body as {
                pluginId?: string;
            };
    
            if (!body.pluginId) {
                return createErrorResponse("PLUGIN_ID_REQUIRED", "插件停用缺少 pluginId", "插件 ID 不能为空。");
            }
    
            return createSuccessResponse(setPluginEnabled(database, events, body.pluginId, false));
        });

    app.post("/api/plugin/configure", async (request) => {
            const body = request.body as {
                pluginId?: string;
                config?: Record<string, unknown>;
            };
    
            if (!body.pluginId || !body.config) {
                return createErrorResponse("PLUGIN_CONFIG_INVALID", "插件配置缺少 pluginId 或 config", "插件配置信息不完整。");
            }
    
            return createSuccessResponse(configurePlugin(database, events, body.pluginId, body.config));
        });

    app.post("/api/plugin/delete", async (request) => {
            const body = request.body as {
                pluginId?: string;
            };
    
            if (!body.pluginId) {
                return createErrorResponse("PLUGIN_ID_REQUIRED", "插件删除缺少 pluginId", "插件 ID 不能为空。");
            }
    
            return createSuccessResponse(deletePlugin(database, events, body.pluginId));
        });

    app.post("/api/plugin/list", async () => createSuccessResponse({
            plugins: listPlugins(database),
        }));

    app.post("/api/extension/call-record", async (request) => {
            const body = request.body as {
                extensionId?: string;
                sessionId?: string | null;
                taskId?: string | null;
                status?: string;
                inputSummary?: string;
                outputSummary?: string | null;
            };
    
            if (!body.extensionId || !body.status || !body.inputSummary) {
                return createErrorResponse("EXTENSION_CALL_INVALID", "扩展调用记录缺少必要字段", "扩展调用记录不完整。");
            }
    
            return createSuccessResponse(recordExtensionCall(database, events, body));
        });

    app.post("/api/extension/call-list", async () => createSuccessResponse({
            records: createDataAccess(database).extensions.listExtensionCallRecords(),
        }));
}
