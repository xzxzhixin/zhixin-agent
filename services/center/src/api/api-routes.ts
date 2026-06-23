import {registerCoreRoutes} from "./core.js";
import {registerAuthRoutes} from "./auth.js";
import {registerProjectRoutes} from "./project.js";
import {registerSessionRoutes} from "./session.js";
import {registerTaskRoutes} from "./task.js";
import {registerAgentRoutes} from "./agent.js";
import {registerMemoryRoutes} from "./memory.js";
import {registerTokenizerRoutes} from "./tokenizer.js";
import {registerExtensionRoutes} from "./extension.js";
import {registerMcpRoutes} from "./mcp.js";
import {registerSkillRoutes} from "./skill.js";
import {registerCapabilityRoutes} from "./capability.js";
import {registerPersonalRoutes} from "./personal.js";
import {registerNotificationRoutes} from "./notification.js";
import {registerExecutionModeRoutes} from "./execution-mode.js";
import {registerWorkerRoutes} from "./worker.js";
import {registerEngineRoutes} from "./engine.js";
import {registerApprovalRoutes} from "./approval.js";
import {registerAttachmentRoutes} from "./attachment.js";
import {registerAuditRoutes} from "./audit.js";
import {registerModelProviderRoutes} from "./model-provider.js";
import {registerProviderRoutes} from "./provider-routes.js";
import {registerUsageRoutes} from "./usage-routes.js";
import {registerCenterSyncRoute} from "./sync-route.js";
import {registerCenterConfigRoutes} from "./center-config-routes.js";
import type {CenterApiRouteContext} from "./route-context.js";

/**
 * registerCenterApiRoutes：注册中心服务 API 聚合入口。
 *
 * @param context 中心服务路由注册上下文。
 * @returns 路由注册完成后没有返回值。
 */
export function registerCenterApiRoutes(context: CenterApiRouteContext): void {
    registerCoreRoutes(context);
    registerAuthRoutes(context);
    registerProjectRoutes(context);
    registerSessionRoutes(context);
    registerTaskRoutes(context);
    registerAgentRoutes(context);
    registerMemoryRoutes(context);
    registerTokenizerRoutes(context);
    registerExtensionRoutes(context);
    registerMcpRoutes(context);
    registerSkillRoutes(context);
    registerCapabilityRoutes(context);
    registerPersonalRoutes(context);
    registerNotificationRoutes(context);
    registerExecutionModeRoutes(context);
    registerWorkerRoutes(context);
    registerEngineRoutes(context);
    registerApprovalRoutes(context);
    registerAttachmentRoutes(context);
    registerAuditRoutes(context);
    registerCenterConfigRoutes(context);
    registerModelProviderRoutes(context);
    registerProviderRoutes(
        context.app,
        context.database,
        context.events,
        context.config,
    );
    registerUsageRoutes(
        context.app,
        context.database,
        context.config.centerDirectory,
        context.events,
    );
    registerCenterSyncRoute({
        app: context.app,
        database: context.database,
        events: context.events,
        logger: context.logger,
        realtimeClients: context.realtimeClients,
        centerDirectory: context.config.centerDirectory,
        memoryQueues: context.memoryQueues,
    });
}

export type {CenterApiRouteContext} from "./route-context.js";
