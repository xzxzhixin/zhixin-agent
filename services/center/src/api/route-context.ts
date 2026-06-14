import type {FastifyInstance} from "fastify";

import type {CenterDatabase} from "../database.js";
import type {CenterEventStore} from "../events.js";
import type {
    CenterServiceConfig,
    MemoryQueueState,
    RealtimeClientConnection,
    SubAgentRuntimeRecord,
} from "../types.js";

/**
 * CenterApiRouteContext：中心服务 API 注册共享上下文。
 *
 * 来源：service.ts 创建路由时注入。
 * 含义：所有资源路由通过同一上下文访问数据库、事件、实时连接和启动配置。
 * 约束：子路由不能反向导入 api-routes.ts，避免形成聚合入口循环依赖。
 */
export interface CenterApiRouteContext {
    /** config: 中心服务启动配置，API 路由读取端口、目录和前端资源边界。 */
    config: CenterServiceConfig;
    /** app: Fastify 实例，路由注册唯一入口。 */
    app: FastifyInstance;
    /** database: 中心服务数据库事实源。 */
    database: CenterDatabase;
    /** events: 中心服务事件事实源。 */
    events: CenterEventStore;
    /** realtimeClients: WebSocket 在线客户端表，只保存运行期连接。 */
    realtimeClients: Map<string, RealtimeClientConnection>;
    /** memoryQueues: 智能体记忆写入队列，按 agentId 隔离串行写入。 */
    memoryQueues: Map<string, MemoryQueueState>;
    /** subAgents: 当前进程的一次性子智能体运行记录。 */
    subAgents: Map<string, SubAgentRuntimeRecord>;
    /** isInitialized: 读取启动初始化状态，避免路由模块持有可变布尔副本。 */
    isInitialized: () => boolean;
    /** getProcessStartedAt: 读取当前中心服务进程启动时间。 */
    getProcessStartedAt: () => string;
}
