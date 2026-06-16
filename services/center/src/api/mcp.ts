import {isRecord} from "@zhixin/shared";
import {createErrorResponse, createSuccessResponse} from "../helpers.js";
import {
    listMcpConfigs,
    saveExtensionJson,
} from "../domain/extension-domain.js";
import {listMcpToolViewsForServerConfig} from "../StructuredTool/index.js";
import type {CenterApiRouteContext} from "./route-context.js";

/**
 * registerMcpRoutes：注册 mcp 资源路由。
 *
 * @param context 中心服务 API 注册共享上下文。
 * @returns 路由注册完成后没有返回值。
 */
export function registerMcpRoutes(context: CenterApiRouteContext): void {
    const {
        app,
        config,
    } = context;

    app.post("/api/mcp/save", async (request) => {
            const body = request.body as {
                mcpServers?: Record<string, unknown>;
                projectId?: string | null;
                serverConfig?: unknown;
                serverId?: string;
            };
            const relativePath = body.projectId
                ? `mcp/project-${body.projectId}.json`
                : "mcp/global.json";
    
            if (body.serverId) {
                if (!isRecord(body.serverConfig)) {
                    return createErrorResponse(
                        "MCP_SERVER_CONFIG_INVALID",
                        "MCP 单服务配置必须是 JSON 对象",
                        "请填写当前 MCP 服务的 JSON 对象配置。",
                    );
                }
                const currentConfig = listMcpConfigs(config.centerDirectory).find((item) => {
                    return item.relativePath === relativePath;
                });
                const currentServers = currentConfig?.mcpServers ?? {};
                // mcpServers: 单服务保存必须合并既有全局配置，避免编辑当前 Server 时覆盖其他 Server。
                return createSuccessResponse(saveExtensionJson(config.centerDirectory, relativePath, {
                    mcpServers: {
                        ...currentServers,
                        [body.serverId]: body.serverConfig,
                    },
                }));
            }
    
            if (!body.mcpServers) {
                return createErrorResponse("MCP_CONFIG_INVALID", "MCP 配置缺少 mcpServers", "MCP 配置不完整。");
            }
    
            return createSuccessResponse(saveExtensionJson(config.centerDirectory, relativePath, {
                mcpServers: body.mcpServers,
            }));
        });

    app.post("/api/mcp/list", async () => {
            return createSuccessResponse({
                configs: listMcpConfigs(config.centerDirectory).flatMap((mcpConfig) => {
                    // serverRows: 管理页按单个 MCP Server 成行展示，避免同一配置文件多个 Server 和大量工具挤在一行。
                    const serverRows = Object.entries(mcpConfig.mcpServers).map(([
                        serverId,
                        serverConfig,
                    ]) => ({
                        ...mcpConfig,
                        serverId,
                        serverConfig,
                        transportType: typeof serverConfig === "object"
                        && serverConfig !== null
                        && "type" in serverConfig
                        && typeof serverConfig.type === "string"
                            ? serverConfig.type
                            : "unknown",
                    }));
                    if (serverRows.length > 0) {
                        return serverRows;
                    }
                    return [
                        {
                            ...mcpConfig,
                            serverId: "",
                            serverConfig: null,
                            transportType: "unknown",
                        },
                    ];
                }),
            });
        });

    app.post("/api/mcp/tools", async (request) => {
            const body = request.body as {
                relativePath?: string;
                serverId?: string;
            };
    
            if (!body.relativePath || !body.serverId) {
                return createErrorResponse(
                    "MCP_SERVER_REQUIRED",
                    "查看 MCP 工具缺少 relativePath 或 serverId",
                    "请选择一个 MCP 服务后再查看工具。",
                );
            }
    
            const mcpConfig = listMcpConfigs(config.centerDirectory).find((item) => {
                return item.relativePath === body.relativePath;
            });
            if (!mcpConfig) {
                return createErrorResponse(
                    "MCP_CONFIG_NOT_FOUND",
                    `MCP 配置不存在：${body.relativePath}`,
                    "MCP 配置文件不存在。",
                );
            }
    
            return createSuccessResponse({
                tools: await listMcpToolViewsForServerConfig(
                    body.serverId,
                    mcpConfig.mcpServers[body.serverId],
                ),
            });
        });
}
