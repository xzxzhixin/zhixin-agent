import {randomUUID} from "node:crypto";
import {appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync} from "node:fs";
import {dirname, join} from "node:path";

import type {CenterDatabase} from "./database.js";
import type {CenterEventStore} from "./events.js";
import type {MemoryQueueState} from "./types.js";
import {writeFileSyncUtf8, writeFileSyncUtf8IfMissing, writeJsonFile} from "./helpers.js";
import {AgentRepository} from "./data-access/agent-repository.js";

// AGENT_DYNAMIC_CAPABILITY_BOUNDARY: 兼容旧 agents_index 字段；真实可用能力由当前会话窗口动态决定，不再由前端编辑。
const AGENT_DYNAMIC_CAPABILITY_BOUNDARY = "可用能力由当前会话、项目上下文、全局扩展和执行模式动态决定。";

/**
 * MemoryWriteInput：智能体长期记忆写入入参。
 *
 * 来源：正常会话轮次完成、手动记忆写入和执行引擎归纳。
 * 含义：描述要追加到智能体 Markdown 记忆和 SQLite 索引中的一段完整轮次记忆。
 * 格式：agentId、关键词、摘要、原始问答文本和可追踪来源。
 * 默认值：来源会话、轮次和附件引用可为空；正常会话完成时必须传入来源。
 * 约束：记忆只能追加，不能覆盖或插入已有段落。
 */
export interface MemoryWriteInput {
    /** agentId: 智能体 ID，主智能体固定为 main。 */
    agentId?: string;
    /** keywords: 关键词文本。 */
    keywords?: string;
    /** summary: 本轮对话摘要。 */
    summary?: string;
    /** userText: 用户本轮输入原文。 */
    userText?: string;
    /** assistantText: 助手本轮回复原文。 */
    assistantText?: string;
    /** sourceSessionId: 来源会话 ID，手动写入时可为空。 */
    sourceSessionId?: string | null;
    /** sourceTurnId: 来源轮次 ID，手动写入时可为空。 */
    sourceTurnId?: string | null;
    /** attachmentRefsJson: 正式附件结构化引用 JSON 字符串。 */
    attachmentRefsJson?: string;
}

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
    new AgentRepository(database).upsertAgent({
        agentId,
        name: "致心",
        enabled: true,
        roleDescription: "系统内置主智能体，直接与用户对话并调度其他智能体。",
        capabilityBoundary: AGENT_DYNAMIC_CAPABILITY_BOUNDARY,
        defaultProviderId: null,
        defaultModel: null,
        reasoningEffort: null,
        memoryIndexPath: "memory/agents/main",
        createdBy: "system-builtin",
        definitionPath: "agents/main.md",
        updatedAt: new Date().toISOString(),
    });
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
    // capabilityBoundary: 旧表和旧 Markdown frontmatter 仍有该字段；本轮固定为动态能力说明以保持迁移兼容。
    const capabilityBoundary = input.capabilityBoundary ?? AGENT_DYNAMIC_CAPABILITY_BOUNDARY;
    mkdirSync(dirname(definitionPath), {
        recursive: true,
    });
    appendFileSync(definitionPath, [
        "---",
        `id: ${agentId}`,
        `name: ${input.name}`,
        `roleDescription: ${input.roleDescription}`,
        `capabilityBoundary: ${capabilityBoundary}`,
        "availablePlugins: []",
        "availableMcp: []",
        "availableSkills: []",
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
        capabilityBoundary,
        "",
    ].join("\n"), "utf-8");
    new AgentRepository(database).insertAgent({
        agentId,
        name: input.name ?? "",
        enabled: true,
        roleDescription: input.roleDescription ?? "",
        capabilityBoundary,
        defaultProviderId: input.defaultProviderId ?? null,
        defaultModel: input.defaultModel ?? null,
        reasoningEffort: input.reasoningEffort ?? null,
        memoryIndexPath: `memory/agents/${agentId}`,
        createdBy: input.createdBy ?? "user",
        definitionPath: relativePath,
        updatedAt: new Date().toISOString(),
    });
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
    const repository = new AgentRepository(database);
    const existing = repository.findAgentById(input.agentId);

    if (!existing) {
        return {
            agentId: input.agentId,
            updated: false,
        };
    }

    const next = {
        name: input.name ?? existing.name,
        roleDescription: input.roleDescription ?? existing.roleDescription ?? "",
        capabilityBoundary: input.capabilityBoundary ?? existing.capabilityBoundary ?? AGENT_DYNAMIC_CAPABILITY_BOUNDARY,
        defaultProviderId: input.defaultProviderId ?? existing.defaultProviderId,
        defaultModel: input.defaultModel ?? existing.defaultModel,
        reasoningEffort: input.reasoningEffort ?? existing.reasoningEffort,
    };
    const now = new Date().toISOString();
    repository.updateAgent({
        agentId: input.agentId ?? "",
        name: next.name,
        roleDescription: next.roleDescription,
        capabilityBoundary: next.capabilityBoundary,
        defaultProviderId: next.defaultProviderId,
        defaultModel: next.defaultModel,
        reasoningEffort: next.reasoningEffort,
        updatedAt: now,
    });

    writeFileSyncUtf8(join(centerDirectory, existing.definitionPath), renderAgentDefinition({
        agentId: existing.agentId,
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
    if (agentId === "main") {
        throw new Error("MAIN_AGENT_DISABLE_FORBIDDEN");
    }

    const now = new Date().toISOString();
    new AgentRepository(database).disableAgent(
        agentId,
        now,
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

    const repository = new AgentRepository(database);
    const existing = repository.findAgentById(agentId);

    if (!existing) {
        return {
            agentId,
            deleted: false,
            archiveMemory,
        };
    }

    const now = new Date().toISOString();
    const archiveStamp = now.replace(/[:.]/gu, "-");
    repository.deleteAgentIndexes(agentId);

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
    return new AgentRepository(database).listAgents();
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
        "availablePlugins: []",
        "availableMcp: []",
        "availableSkills: []",
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
    input: MemoryWriteInput,
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
    new AgentRepository(database).insertMemoryIndex({
        memoryId: memoryIndexId,
        agentId: input.agentId,
        keywords: input.keywords,
        summary: input.summary,
        sourceSessionId: input.sourceSessionId ?? null,
        sourceTurnId: input.sourceTurnId ?? null,
        attachmentRefsJson: input.attachmentRefsJson ?? "[]",
        memoryPath: relativePath,
        createdAt: now.toISOString(),
    });
    events.append({
        eventType: "memory.write",
        scopeType: "agent",
        scopeId: input.agentId ?? null,
        sessionId: input.sourceSessionId ?? null,
        turnId: input.sourceTurnId ?? null,
        taskId: null,
        agentId: input.agentId,
        status: "completed",
        title: "记忆写入",
        summary: input.summary ?? "",
        payload: {
            relativePath,
            memoryIndexId,
            sourceSessionId: input.sourceSessionId ?? null,
            sourceTurnId: input.sourceTurnId ?? null,
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
