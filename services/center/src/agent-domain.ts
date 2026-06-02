import {randomUUID} from "node:crypto";
import {appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync} from "node:fs";
import {dirname, join} from "node:path";

import type {CenterDatabase} from "./database.js";
import type {CenterEventStore} from "./events.js";
import type {MemoryQueueState} from "./types.js";
import {writeFileSyncUtf8, writeFileSyncUtf8IfMissing, writeJsonFile} from "./helpers.js";

export function ensureMainAgent(
    database: CenterDatabase,
    events: CenterEventStore,
    centerDirectory: string,
): {
    agentId: string;
    name: string;
} {
    const agentId = "main";
    const definitionPath = join(centerDirectory, "agents", "main.md");
    mkdirSync(dirname(definitionPath), {
        recursive: true,
    });
    writeFileSyncUtf8IfMissing(definitionPath, [
        "---",
        "id: main",
        "name: 致心",
        "enabled: true",
        "createdBy: system-builtin",
        "---",
        "",
        "# 致心",
        "",
        "系统内置主智能体，不可删除。",
        "",
    ].join("\n"));
    database.connection()
        .prepare(`
            INSERT INTO agents_index (id,
                                      name,
                                      enabled,
                                      role_description,
                                      capability_boundary,
                                      default_provider_id,
                                      default_model,
                                      reasoning_effort,
                                      memory_index_path,
                                      created_by,
                                      definition_path,
                                      updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO
            UPDATE SET
                name = excluded.name,
                enabled = excluded.enabled,
                role_description = excluded.role_description,
                capability_boundary = excluded.capability_boundary,
                default_provider_id = excluded.default_provider_id,
                default_model = excluded.default_model,
                reasoning_effort = excluded.reasoning_effort,
                memory_index_path = excluded.memory_index_path,
                created_by = excluded.created_by,
                definition_path = excluded.definition_path,
                updated_at = excluded.updated_at
        `)
        .run(
            agentId,
            "致心",
            1,
            "系统内置主智能体，直接与用户对话并调度其他智能体。",
            "遵守中心服务权限、执行模式和当前会话能力边界。",
            null,
            null,
            null,
            "memory/agents/main",
            "system-builtin",
            "agents/main.md",
            new Date().toISOString(),
        );
    events.append({
        eventType: "agent.bootstrap",
        scopeType: "agent",
        scopeId: agentId,
        sessionId: null,
        turnId: null,
        taskId: null,
        status: "completed",
        title: "主智能体初始化",
        summary: "内置主智能体致心已恢复。",
        payload: {
            agentId,
        },
    });

    return {
        agentId,
        name: "致心",
    };
}

/**
 * createAgent：创建长期智能体定义。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param centerDirectory 中心目录。
 * @param input 智能体创建参数。
 * @returns 智能体身份。
 */
export function createAgent(
    database: CenterDatabase,
    events: CenterEventStore,
    centerDirectory: string,
    input: {
        name?: string;
        roleDescription?: string;
        capabilityBoundary?: string;
        defaultProviderId?: string | null;
        defaultModel?: string | null;
        reasoningEffort?: string | null;
        createdBy?: string;
    },
): {
    agentId: string;
    name: string;
} {
    const agentId = randomUUID();
    const relativePath = `agents/${agentId}.md`;
    const definitionPath = join(centerDirectory, relativePath);
    mkdirSync(dirname(definitionPath), {
        recursive: true,
    });
    appendFileSync(definitionPath, [
        "---",
        `id: ${agentId}`,
        `name: ${input.name}`,
        `roleDescription: ${input.roleDescription}`,
        `capabilityBoundary: ${input.capabilityBoundary}`,
        `defaultProviderId: ${input.defaultProviderId ?? ""}`,
        `defaultModel: ${input.defaultModel ?? ""}`,
        `reasoningEffort: ${input.reasoningEffort ?? ""}`,
        `memoryIndex: memory/agents/${agentId}`,
        "enabled: true",
        `createdBy: ${input.createdBy ?? "user"}`,
        "---",
        "",
        `# ${input.name}`,
        "",
        "## 角色说明",
        "",
        input.roleDescription,
        "",
        "## 能力边界",
        "",
        input.capabilityBoundary,
        "",
    ].join("\n"), "utf-8");
    database.connection()
        .prepare(`
            INSERT INTO agents_index (id,
                                      name,
                                      enabled,
                                      role_description,
                                      capability_boundary,
                                      default_provider_id,
                                      default_model,
                                      reasoning_effort,
                                      memory_index_path,
                                      created_by,
                                      definition_path,
                                      updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
            agentId,
            input.name,
            1,
            input.roleDescription,
            input.capabilityBoundary,
            input.defaultProviderId ?? null,
            input.defaultModel ?? null,
            input.reasoningEffort ?? null,
            `memory/agents/${agentId}`,
            input.createdBy ?? "user",
            relativePath,
            new Date().toISOString(),
        );
    events.append({
        eventType: "agent.created",
        scopeType: "agent",
        scopeId: agentId,
        sessionId: null,
        turnId: null,
        taskId: null,
        status: "completed",
        title: "智能体创建",
        summary: `长期智能体 ${input.name} 已创建。`,
        payload: {
            agentId,
        },
    });

    return {
        agentId,
        name: input.name ?? "",
    };
}

/**
 * updateAgent：更新长期智能体定义和索引。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param centerDirectory 中心目录。
 * @param input 智能体更新参数。
 * @returns 更新后的智能体摘要。
 */
export function updateAgent(
    database: CenterDatabase,
    events: CenterEventStore,
    centerDirectory: string,
    input: {
        agentId?: string;
        name?: string;
        roleDescription?: string;
        capabilityBoundary?: string;
        defaultProviderId?: string | null;
        defaultModel?: string | null;
        reasoningEffort?: string | null;
    },
): {
    agentId: string | undefined;
    updated: boolean;
} {
    const existing = database.connection()
        .prepare("SELECT id, name, role_description AS roleDescription, capability_boundary AS capabilityBoundary, default_provider_id AS defaultProviderId, default_model AS defaultModel, reasoning_effort AS reasoningEffort, definition_path AS definitionPath FROM agents_index WHERE id = ?")
        .get(input.agentId) as {
        id: string;
        name: string;
        roleDescription: string | null;
        capabilityBoundary: string | null;
        defaultProviderId: string | null;
        defaultModel: string | null;
        reasoningEffort: string | null;
        definitionPath: string;
    } | undefined;

    if (!existing) {
        return {
            agentId: input.agentId,
            updated: false,
        };
    }

    const next = {
        name: input.name ?? existing.name,
        roleDescription: input.roleDescription ?? existing.roleDescription ?? "",
        capabilityBoundary: input.capabilityBoundary ?? existing.capabilityBoundary ?? "",
        defaultProviderId: input.defaultProviderId ?? existing.defaultProviderId,
        defaultModel: input.defaultModel ?? existing.defaultModel,
        reasoningEffort: input.reasoningEffort ?? existing.reasoningEffort,
    };
    const now = new Date().toISOString();
    database.connection()
        .prepare("UPDATE agents_index SET name = ?, role_description = ?, capability_boundary = ?, default_provider_id = ?, default_model = ?, reasoning_effort = ?, updated_at = ? WHERE id = ?")
        .run(
            next.name,
            next.roleDescription,
            next.capabilityBoundary,
            next.defaultProviderId,
            next.defaultModel,
            next.reasoningEffort,
            now,
            input.agentId,
        );

    writeFileSyncUtf8(join(centerDirectory, existing.definitionPath), renderAgentDefinition({
        agentId: existing.id,
        name: next.name,
        roleDescription: next.roleDescription,
        capabilityBoundary: next.capabilityBoundary,
        defaultProviderId: next.defaultProviderId,
        defaultModel: next.defaultModel,
        reasoningEffort: next.reasoningEffort,
        enabled: true,
        createdBy: "user",
    }));
    events.append({
        eventType: "agent.updated",
        scopeType: "agent",
        scopeId: input.agentId ?? null,
        sessionId: null,
        turnId: null,
        taskId: null,
        agentId: input.agentId,
        status: "completed",
        title: "智能体更新",
        summary: next.name,
        payload: {agentId: input.agentId}
    });

    return {
        agentId: input.agentId,
        updated: true,
    };
}

/**
 * disableAgent：停用长期智能体并记录删除影响确认。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param centerDirectory 中心目录。
 * @param agentId 智能体 ID。
 * @param archiveMemory 是否归档记忆。
 * @returns 停用结果。
 */
export function disableAgent(
    database: CenterDatabase,
    events: CenterEventStore,
    centerDirectory: string,
    agentId: string,
    archiveMemory: boolean,
): {
    agentId: string;
    enabled: boolean;
    archiveMemory: boolean;
} {
    const now = new Date().toISOString();
    database.connection()
        .prepare("UPDATE agents_index SET enabled = 0, updated_at = ? WHERE id = ? AND id <> 'main'")
        .run(
            now,
            agentId,
        );
    writeJsonFile(join(centerDirectory, "agents", `${agentId}.delete-impact.json`), {
        agentId,
        archiveMemory,
        impactAcceptedAt: now,
        impactSummary: "已确认记忆处理、调度入口移除和历史会话保留影响。",
    });
    events.append({
        eventType: "agent.disabled",
        scopeType: "agent",
        scopeId: agentId,
        sessionId: null,
        turnId: null,
        taskId: null,
        agentId,
        status: "completed",
        title: "智能体停用",
        summary: "长期智能体已停用，历史会话保留。",
        payload: {agentId, archiveMemory}
    });

    return {
        agentId,
        enabled: false,
        archiveMemory,
    };
}

/**
 * deleteAgent：删除长期智能体定义并按确认结果处理专属记忆。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param centerDirectory 中心目录。
 * @param agentId 智能体 ID。
 * @param archiveMemory 是否将专属记忆保留到归档目录。
 * @returns 删除结果。
 */
export function deleteAgent(
    database: CenterDatabase,
    events: CenterEventStore,
    centerDirectory: string,
    agentId: string,
    archiveMemory: boolean,
): {
    agentId: string;
    deleted: boolean;
    archiveMemory: boolean;
} {
    if (agentId === "main") {
        return {
            agentId,
            deleted: false,
            archiveMemory,
        };
    }

    const connection = database.connection();
    const existing = connection
        .prepare("SELECT id AS agentId, name, definition_path AS definitionPath FROM agents_index WHERE id = ?")
        .get(agentId) as {
        agentId: string;
        name: string;
        definitionPath: string;
    } | undefined;

    if (!existing) {
        return {
            agentId,
            deleted: false,
            archiveMemory,
        };
    }

    const now = new Date().toISOString();
    const archiveStamp = now.replace(/[:.]/gu, "-");
    connection
        .prepare("DELETE FROM agent_runtime_states WHERE agent_id = ?")
        .run(agentId);
    connection
        .prepare("DELETE FROM memory_index WHERE agent_id = ?")
        .run(agentId);
    connection
        .prepare("DELETE FROM agents_index WHERE id = ? AND id <> 'main'")
        .run(agentId);

    const definitionPath = join(centerDirectory, existing.definitionPath);
    const memoryPath = join(centerDirectory, "memory", "agents", agentId);
    if (archiveMemory && existsSync(memoryPath)) {
        const archiveRootPath = join(centerDirectory, "memory", "agents-archive");
        const archiveTargetPath = join(archiveRootPath, `${agentId}-${archiveStamp}`);
        mkdirSync(archiveRootPath, {
            recursive: true,
        });
        renameSync(
            memoryPath,
            archiveTargetPath,
        );
    } else if (existsSync(memoryPath)) {
        rmSync(memoryPath, {
            force: true,
            recursive: true,
        });
    }

    if (existsSync(definitionPath)) {
        rmSync(definitionPath, {
            force: true,
        });
    }

    const impactFilePath = join(centerDirectory, "agents", `${agentId}.delete-impact.json`);
    writeJsonFile(impactFilePath, {
        agentId,
        deletedAt: now,
        archiveMemory,
        impactAcceptedAt: now,
        impactSummary: "已确认删除长期智能体，后续任务调度入口移除，历史会话保留。",
    });
    events.append({
        eventType: "agent.deleted",
        scopeType: "agent",
        scopeId: agentId,
        sessionId: null,
        turnId: null,
        taskId: null,
        agentId,
        status: "completed",
        title: "智能体删除",
        summary: `长期智能体 ${existing.name} 已删除。`,
        payload: {
            agentId,
            archiveMemory,
        },
    });

    return {
        agentId,
        deleted: true,
        archiveMemory,
    };
}

/**
 * listAgents：查询长期智能体索引。
 *
 * @param database 中心服务数据库。
 * @returns 智能体列表。
 */
export function listAgents(database: CenterDatabase): unknown[] {
    return database.connection()
        .prepare("SELECT id AS agentId, name, enabled, role_description AS roleDescription, capability_boundary AS capabilityBoundary, default_provider_id AS defaultProviderId, default_model AS defaultModel, reasoning_effort AS reasoningEffort, memory_index_path AS memoryIndexPath, created_by AS createdBy, definition_path AS definitionPath, updated_at AS updatedAt FROM agents_index ORDER BY updated_at DESC")
        .all();
}

/**
 * renderAgentDefinition：渲染智能体 Markdown 定义。
 *
 * @param input 智能体定义字段。
 * @returns Markdown 定义文本。
 */
export function renderAgentDefinition(input: {
    agentId: string;
    name: string;
    roleDescription: string;
    capabilityBoundary: string;
    defaultProviderId: string | null;
    defaultModel: string | null;
    reasoningEffort: string | null;
    enabled: boolean;
    createdBy: string;
}): string {
    return [
        "---",
        `id: ${input.agentId}`,
        `name: ${input.name}`,
        `roleDescription: ${input.roleDescription}`,
        `capabilityBoundary: ${input.capabilityBoundary}`,
        `defaultProviderId: ${input.defaultProviderId ?? ""}`,
        `defaultModel: ${input.defaultModel ?? ""}`,
        `reasoningEffort: ${input.reasoningEffort ?? ""}`,
        `memoryIndex: memory/agents/${input.agentId}`,
        `enabled: ${input.enabled ? "true" : "false"}`,
        `createdBy: ${input.createdBy}`,
        "---",
        "",
        `# ${input.name}`,
        "",
        "## 角色说明",
        "",
        input.roleDescription,
        "",
        "## 能力边界",
        "",
        input.capabilityBoundary,
        "",
    ].join("\n");
}

/**
 * formatMemoryTimeTitle：生成永久记忆段落标题时间。
 *
 * @param value 记忆写入时间。
 * @returns 只包含 HH:mm:ss 的标题时间文本。
 */
export function formatMemoryTimeTitle(value: Date): string {
    // timeText: 永久记忆 Markdown 标题只允许写时间，日期由目录 year/month/day 表达。
    const timeText = value.toISOString()
        .slice(
            11,
            19,
        );

    return timeText;
}

/**
 * writeAgentMemory：追加写入智能体 Markdown 记忆。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param centerDirectory 中心目录。
 * @param input 记忆写入参数。
 * @returns 记忆文件相对路径。
 */
export function writeAgentMemory(
    database: CenterDatabase,
    events: CenterEventStore,
    centerDirectory: string,
    memoryQueues: Map<string, MemoryQueueState>,
    input: {
        agentId?: string;
        keywords?: string;
        summary?: string;
        userText?: string;
        assistantText?: string;
    },
): {
    relativePath: string;
} {
    const queueState = enterMemoryQueue(memoryQueues, input.agentId ?? "");
    const now = new Date();
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const day = String(now.getUTCDate()).padStart(2, "0");
    const relativePath = `memory/agents/${input.agentId}/${year}/${month}/${day}.md`;
    const filePath = join(centerDirectory, relativePath);
    const memoryTimeTitle = formatMemoryTimeTitle(now);
    mkdirSync(dirname(filePath), {
        recursive: true,
    });
    appendFileSync(filePath, [
        `# ${memoryTimeTitle}`,
        "",
        "## 关键词",
        "",
        input.keywords,
        "",
        "## 总结",
        "",
        input.summary,
        "",
        "## 使用的电脑",
        "",
        "center",
        "",
        "## 用户说的",
        "",
        input.userText,
        "",
        "## 回答的",
        "",
        input.assistantText,
        "",
    ].join("\n"), "utf-8");
    const memoryIndexId = randomUUID();
    database.connection()
        .prepare("INSERT INTO memory_index (id, agent_id, keywords, summary, source_session_id, source_turn_id, attachment_refs_json, memory_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(
            memoryIndexId,
            input.agentId,
            input.keywords,
            input.summary,
            null,
            null,
            "[]",
            relativePath,
            now.toISOString(),
        );
    events.append({
        eventType: "memory.write",
        scopeType: "agent",
        scopeId: input.agentId ?? null,
        sessionId: null,
        turnId: null,
        taskId: null,
        agentId: input.agentId,
        status: "completed",
        title: "记忆写入",
        summary: input.summary ?? "",
        payload: {
            relativePath,
            memoryIndexId,
        },
    });
    leaveMemoryQueue(queueState);

    return {
        relativePath,
    };
}

/**
 * enterMemoryQueue：进入指定智能体的记忆单写队列。
 *
 * @param memoryQueues 运行期记忆队列表。
 * @param agentId 智能体 ID。
 * @returns 当前智能体的队列状态。
 */
export function enterMemoryQueue(memoryQueues: Map<string, MemoryQueueState>, agentId: string): MemoryQueueState {
    // existing: 同一 agentId 复用同一队列状态，表达单写边界。
    const existing = memoryQueues.get(agentId);
    if (existing) {
        existing.pendingWrites += existing.running ? 1 : 0;
        existing.running = true;
        return existing;
    }

    const created: MemoryQueueState = {
        agentId,
        running: true,
        pendingWrites: 0,
    };
    memoryQueues.set(agentId, created);
    return created;
}

/**
 * leaveMemoryQueue：离开指定智能体的记忆单写队列。
 *
 * @param queueState 当前智能体队列状态。
 * @returns 没有返回值。
 */
export function leaveMemoryQueue(queueState: MemoryQueueState): void {
    // pendingWrites: 当前实现同步写入，写完后没有遗留等待项。
    queueState.pendingWrites = Math.max(0, queueState.pendingWrites - 1);
    queueState.running = false;
}

/**
 * readMemoryQueueState：读取智能体记忆队列状态。
 *
 * @param memoryQueues 运行期记忆队列表。
 * @param agentId 智能体 ID。
 * @returns 可展示的单写队列状态。
 */
export function readMemoryQueueState(
    memoryQueues: Map<string, MemoryQueueState>,
    agentId: string,
): {
    agentId: string;
    queueMode: "single-writer";
    running: boolean;
    pendingWrites: number;
} {
    const state = memoryQueues.get(agentId);
    return {
        agentId,
        queueMode: "single-writer",
        running: state?.running ?? false,
        pendingWrites: state?.pendingWrites ?? 0,
    };
}
