import type {
    ClientConfig,
    Connection,
} from "@langchain/mcp-adapters";
import {
    MultiServerMCPClient,
} from "@langchain/mcp-adapters";

import {
    readAllMcpServerConfigs,
    type McpServerConfig,
} from "./mcp-tool-specs.js";

/** MCP_ADAPTER_TOOL_NAME_PREFIX：官方 adapter 工具名前缀，避免与内置工具重名。 */
export const MCP_ADAPTER_TOOL_NAME_PREFIX = "mcp";

/**
 * createMcpAdapterClient：按当前会话 MCP 配置创建官方 MCP adapter client。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @param projectId 当前会话绑定项目 ID；为空时只使用全局 MCP 配置。
 * @returns 官方 MultiServerMCPClient；无 MCP Server 时仍返回空配置 client。
 */
export function createMcpAdapterClient(
    centerDirectory: string,
    projectId: string | null = null,
): MultiServerMCPClient {
    return new MultiServerMCPClient(createMcpAdapterClientConfig(
        centerDirectory,
        projectId,
    ));
}

/**
 * createMcpAdapterClientConfig：把当前会话可用 MCP 配置转换成官方 adapter 配置。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @param projectId 当前会话绑定项目 ID；项目配置同名 Server 覆盖全局配置。
 * @returns MultiServerMCPClient 配置。
 */
export function createMcpAdapterClientConfig(
    centerDirectory: string,
    projectId: string | null = null,
): ClientConfig {
    const mcpServers: Record<string, Connection> = {};
    for (const serverConfig of readAllMcpServerConfigs(
        centerDirectory,
        projectId,
    )) {
        mcpServers[serverConfig.serverId] = toMcpAdapterConnection(serverConfig);
    }
    return {
        mcpServers,
        prefixToolNameWithServerName: true,
        additionalToolNamePrefix: MCP_ADAPTER_TOOL_NAME_PREFIX,
        useStandardContentBlocks: true,
        throwOnLoadError: false,
        onConnectionError: "ignore",
    };
}

/**
 * toMcpAdapterConnection：转换单个 MCP Server transport 配置。
 *
 * @param serverConfig 中心服务 MCP Server 配置。
 * @returns 官方 adapter 可识别的连接配置。
 */
function toMcpAdapterConnection(serverConfig: McpServerConfig): Connection {
    if (serverConfig.type === "stdio") {
        return {
            transport: "stdio",
            command: serverConfig.command,
            args: serverConfig.args,
            env: serverConfig.env,
            cwd: serverConfig.cwd ?? undefined,
            stderr: "pipe",
        };
    }
    return {
        transport: "http",
        url: serverConfig.url,
        automaticSSEFallback: true,
    };
}
