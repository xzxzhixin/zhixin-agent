import type {CenterDatabase} from "../database.js";

/**
 * ExtensionCallInput：扩展调用记录入参。
 *
 * 来源：插件、MCP、skill 或其他扩展能力调用流程。
 * 含义：写入 extension_call_records 追加审计表。
 * 格式：可选上下文允许 null。
 * 默认值：无。
 * 约束：调用状态由调用方按执行结果明确传入。
 */
export interface ExtensionCallInput {
    /** callId: 扩展调用记录 ID。 */
    callId: string;
    /** extensionId: 扩展能力 ID。 */
    extensionId?: string;
    /** sessionId: 所属会话 ID；无会话上下文为 null。 */
    sessionId?: string | null;
    /** taskId: 所属任务 ID；无任务上下文为 null。 */
    taskId?: string | null;
    /** status: 调用状态。 */
    status?: string;
    /** inputSummary: 输入摘要。 */
    inputSummary?: string;
    /** outputSummary: 输出摘要。 */
    outputSummary?: string | null;
    /** createdAt: 创建时间 ISO 字符串。 */
    createdAt: string;
}

/**
 * ExtensionRepository：插件安装和扩展调用数据访问层。
 *
 * 用途：收敛 plugin_installs 与 extension_call_records 的 SQLite 访问。
 * 关键逻辑：插件清单 JSON 原文作为 manifest_json 保存，业务层负责解释协议字段。
 */
export class ExtensionRepository {
    /** database: 中心服务主进程持有的数据库连接包装。 */
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
     * upsertPlugin：写入或替换插件安装记录。
     *
     * @param input 插件安装字段。
     * @returns 没有返回值。
     */
    upsertPlugin(input: {
        pluginInstallId: string;
        source: string;
        scope: string;
        enabled: boolean;
        manifestJson: string;
        updatedAt: string;
    }): void {
        this.database.connection()
            .prepare("INSERT OR REPLACE INTO plugin_installs (id, source, scope, enabled, manifest_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
            .run(
                input.pluginInstallId,
                input.source,
                input.scope,
                input.enabled ? 1 : 0,
                input.manifestJson,
                input.updatedAt,
            );
    }

    /**
     * setPluginEnabled：更新插件启用状态。
     *
     * @param pluginId 插件 ID。
     * @param enabled 是否启用。
     * @param updatedAt 更新时间。
     * @returns 没有返回值。
     */
    setPluginEnabled(
        pluginId: string,
        enabled: boolean,
        updatedAt: string,
    ): void {
        this.database.connection()
            .prepare("UPDATE plugin_installs SET enabled = ?, updated_at = ? WHERE id = ?")
            .run(
                enabled ? 1 : 0,
                updatedAt,
                pluginId,
            );
    }

    /**
     * findPluginManifestJson：读取插件清单 JSON。
     *
     * @param pluginId 插件 ID。
     * @returns 清单 JSON；不存在时返回 null。
     */
    findPluginManifestJson(pluginId: string): string | null {
        const row = this.database.connection()
            .prepare("SELECT manifest_json AS manifestJson FROM plugin_installs WHERE id = ?")
            .get(pluginId) as {
            manifestJson: string;
        } | undefined;

        return row?.manifestJson ?? null;
    }

    /**
     * updatePluginManifestJson：更新插件清单 JSON。
     *
     * @param pluginId 插件 ID。
     * @param manifestJson 清单 JSON 字符串。
     * @param updatedAt 更新时间。
     * @returns 没有返回值。
     */
    updatePluginManifestJson(
        pluginId: string,
        manifestJson: string,
        updatedAt: string,
    ): void {
        this.database.connection()
            .prepare("UPDATE plugin_installs SET manifest_json = ?, updated_at = ? WHERE id = ?")
            .run(
                manifestJson,
                updatedAt,
                pluginId,
            );
    }

    /**
     * deleteUserPlugin：删除非系统内置插件。
     *
     * @param pluginId 插件 ID。
     * @returns 是否删除了记录。
     */
    deleteUserPlugin(pluginId: string): boolean {
        const result = this.database.connection()
            .prepare("DELETE FROM plugin_installs WHERE id = ? AND source <> 'system-builtin'")
            .run(pluginId);

        return result.changes > 0;
    }

    /**
     * listPlugins：读取插件安装列表。
     *
     * @returns 插件安装原始行数组。
     */
    listPlugins(): Array<{
        pluginId: string;
        source: string;
        scope: string;
        enabled: number;
        manifestJson: string;
        updatedAt: string;
    }> {
        return this.database.connection()
            .prepare("SELECT id AS pluginId, source, scope, enabled, manifest_json AS manifestJson, updated_at AS updatedAt FROM plugin_installs ORDER BY updated_at DESC")
            .all() as Array<{
            pluginId: string;
            source: string;
            scope: string;
            enabled: number;
            manifestJson: string;
            updatedAt: string;
        }>;
    }

    /**
     * insertExtensionCall：写入扩展能力调用记录。
     *
     * @param input 扩展调用字段。
     * @returns 没有返回值。
     */
    insertExtensionCall(input: ExtensionCallInput): void {
        this.database.connection()
            .prepare("INSERT INTO extension_call_records (id, extension_id, session_id, task_id, status, input_summary, output_summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .run(
                input.callId,
                input.extensionId,
                input.sessionId ?? null,
                input.taskId ?? null,
                input.status,
                input.inputSummary,
                input.outputSummary ?? null,
                input.createdAt,
            );
    }

    /**
     * listExtensionCallRecords：读取扩展调用审计记录。
     *
     * @returns 扩展调用记录数组。
     */
    listExtensionCallRecords(): unknown[] {
        return this.database.connection()
            .prepare("SELECT * FROM extension_call_records ORDER BY created_at ASC")
            .all();
    }
}
