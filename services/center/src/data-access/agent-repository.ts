import type {CenterDatabase} from "../database.js";

/**
 * AgentIndexRow：agents_index 表的领域行结构。
 *
 * 来源：中心服务 SQLite `agents_index` 表。
 * 含义：保存主智能体和长期智能体的固化定义索引。
 * 格式：数据库列已映射为前端/API 使用的驼峰字段。
 * 默认值：无；调用方必须按业务规则补齐。
 * 约束：只在中心服务主进程通过 CenterDatabase 读取，Worker 不直接访问数据库。
 */
export interface AgentIndexRow {
    /** agentId: 智能体 ID，主智能体固定为 main。 */
    agentId: string;
    /** name: 智能体名称。 */
    name: string;
    /** enabled: SQLite 0/1 启用状态。 */
    enabled: number;
    /** roleDescription: Markdown 角色说明。 */
    roleDescription: string | null;
    /** capabilityBoundary: 兼容旧定义的动态能力说明。 */
    capabilityBoundary: string | null;
    /** defaultProviderId: 默认供应商 ID。 */
    defaultProviderId: string | null;
    /** defaultModel: 默认模型名。 */
    defaultModel: string | null;
    /** reasoningEffort: 默认推理深度。 */
    reasoningEffort: string | null;
    /** memoryIndexPath: 记忆索引目录。 */
    memoryIndexPath: string | null;
    /** createdBy: 创建来源。 */
    createdBy: string | null;
    /** definitionPath: 智能体定义 Markdown 相对路径。 */
    definitionPath: string;
    /** updatedAt: 更新时间 ISO 字符串。 */
    updatedAt: string;
}

/**
 * AgentInsertInput：新增智能体索引入参。
 *
 * 来源：agent-domain 创建流程。
 * 含义：把已校验的智能体定义写入 SQLite。
 * 格式：所有必要字段展开为独立属性。
 * 默认值：无。
 * 约束：不要在 repository 内猜测业务默认值，默认值由领域层明确提供。
 */
export interface AgentInsertInput {
    /** agentId: 智能体 ID。 */
    agentId: string;
    /** name: 智能体名称。 */
    name: string;
    /** enabled: 是否启用，写入 SQLite 0/1。 */
    enabled: boolean;
    /** roleDescription: Markdown 角色说明。 */
    roleDescription: string;
    /** capabilityBoundary: 兼容旧定义的动态能力说明。 */
    capabilityBoundary: string;
    /** defaultProviderId: 默认供应商 ID。 */
    defaultProviderId: string | null;
    /** defaultModel: 默认模型名。 */
    defaultModel: string | null;
    /** reasoningEffort: 默认推理深度。 */
    reasoningEffort: string | null;
    /** memoryIndexPath: 记忆索引目录。 */
    memoryIndexPath: string;
    /** createdBy: 创建来源。 */
    createdBy: string;
    /** definitionPath: 智能体定义 Markdown 相对路径。 */
    definitionPath: string;
    /** updatedAt: 更新时间 ISO 字符串。 */
    updatedAt: string;
}

/**
 * AgentUpdateInput：更新智能体索引入参。
 *
 * 来源：agent-domain 更新流程。
 * 含义：只更新已存在智能体的可编辑字段。
 * 格式：字段完整传入，避免 repository 内自行兜底。
 * 默认值：无。
 * 约束：主智能体是否可更新由领域层判断。
 */
export interface AgentUpdateInput {
    /** agentId: 智能体 ID。 */
    agentId: string;
    /** name: 智能体名称。 */
    name: string;
    /** roleDescription: Markdown 角色说明。 */
    roleDescription: string;
    /** capabilityBoundary: 兼容旧定义的动态能力说明。 */
    capabilityBoundary: string;
    /** defaultProviderId: 默认供应商 ID。 */
    defaultProviderId: string | null;
    /** defaultModel: 默认模型名。 */
    defaultModel: string | null;
    /** reasoningEffort: 默认推理深度。 */
    reasoningEffort: string | null;
    /** updatedAt: 更新时间 ISO 字符串。 */
    updatedAt: string;
}

/**
 * AgentRepository：智能体 SQLite 访问层。
 *
 * 用途：作为 Node 端轻量数据访问边界，平替把 SQL 散落在领域代码中的写法。
 * 关键逻辑：只持有 CenterDatabase 引用，不创建新 SQLite 连接，保持中心服务唯一连接规则。
 */
export class AgentRepository {
    /**
     * database: 中心服务主进程持有的数据库连接包装。
     */
    private readonly database: CenterDatabase;

    /**
     * constructor：保存中心服务数据库包装。
     *
     * @param database 中心服务数据库。
     */
    constructor(database: CenterDatabase) {
        this.database = database;
    }

    /**
     * insertAgent：写入智能体索引。
     *
     * @param input 已校验的智能体索引字段。
     * @returns 没有返回值。
     */
    insertAgent(input: AgentInsertInput): void {
        this.database.connection()
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
                input.agentId,
                input.name,
                input.enabled ? 1 : 0,
                input.roleDescription,
                input.capabilityBoundary,
                input.defaultProviderId,
                input.defaultModel,
                input.reasoningEffort,
                input.memoryIndexPath,
                input.createdBy,
                input.definitionPath,
                input.updatedAt,
            );
    }

    /**
     * upsertAgent：写入或更新内置智能体索引。
     *
     * @param input 已校验的智能体索引字段。
     * @returns 没有返回值。
     */
    upsertAgent(input: AgentInsertInput): void {
        this.database.connection()
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
                input.agentId,
                input.name,
                input.enabled ? 1 : 0,
                input.roleDescription,
                input.capabilityBoundary,
                input.defaultProviderId,
                input.defaultModel,
                input.reasoningEffort,
                input.memoryIndexPath,
                input.createdBy,
                input.definitionPath,
                input.updatedAt,
            );
    }

    /**
     * findAgentById：按 ID 查询智能体索引。
     *
     * @param agentId 智能体 ID。
     * @returns 找到时返回智能体索引，否则返回 undefined。
     */
    findAgentById(agentId: string | undefined): AgentIndexRow | undefined {
        return this.database.connection()
            .prepare("SELECT id AS agentId, name, enabled, role_description AS roleDescription, capability_boundary AS capabilityBoundary, default_provider_id AS defaultProviderId, default_model AS defaultModel, reasoning_effort AS reasoningEffort, memory_index_path AS memoryIndexPath, created_by AS createdBy, definition_path AS definitionPath, updated_at AS updatedAt FROM agents_index WHERE id = ?")
            .get(agentId) as AgentIndexRow | undefined;
    }

    /**
     * updateAgent：更新智能体可编辑字段。
     *
     * @param input 已合并默认值后的更新字段。
     * @returns 没有返回值。
     */
    updateAgent(input: AgentUpdateInput): void {
        this.database.connection()
            .prepare("UPDATE agents_index SET name = ?, role_description = ?, capability_boundary = ?, default_provider_id = ?, default_model = ?, reasoning_effort = ?, updated_at = ? WHERE id = ?")
            .run(
                input.name,
                input.roleDescription,
                input.capabilityBoundary,
                input.defaultProviderId,
                input.defaultModel,
                input.reasoningEffort,
                input.updatedAt,
                input.agentId,
            );
    }

    /**
     * disableAgent：停用长期智能体。
     *
     * @param agentId 智能体 ID。
     * @param updatedAt 更新时间 ISO 字符串。
     * @returns 没有返回值。
     */
    disableAgent(
        agentId: string,
        updatedAt: string,
    ): void {
        this.database.connection()
            .prepare("UPDATE agents_index SET enabled = 0, updated_at = ? WHERE id = ? AND id <> 'main'")
            .run(
                updatedAt,
                agentId,
            );
    }

    /**
     * deleteAgentIndexes：删除长期智能体相关索引。
     *
     * @param agentId 智能体 ID。
     * @returns 没有返回值。
     */
    deleteAgentIndexes(agentId: string): void {
        const connection = this.database.connection();
        connection
            .prepare("DELETE FROM agent_runtime_states WHERE agent_id = ?")
            .run(agentId);
        connection
            .prepare("DELETE FROM memory_index WHERE agent_id = ?")
            .run(agentId);
        connection
            .prepare("DELETE FROM agents_index WHERE id = ? AND id <> 'main'")
            .run(agentId);
    }

    /**
     * listAgents：查询全部固化智能体索引。
     *
     * @returns 智能体索引数组。
     */
    listAgents(): AgentIndexRow[] {
        return this.database.connection()
            .prepare("SELECT id AS agentId, name, enabled, role_description AS roleDescription, capability_boundary AS capabilityBoundary, default_provider_id AS defaultProviderId, default_model AS defaultModel, reasoning_effort AS reasoningEffort, memory_index_path AS memoryIndexPath, created_by AS createdBy, definition_path AS definitionPath, updated_at AS updatedAt FROM agents_index ORDER BY updated_at DESC")
            .all() as AgentIndexRow[];
    }
}
