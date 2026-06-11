import type {CenterDatabase} from "../database.js";

/**
 * AgentTeamRow：会话级 team 当前状态行。
 *
 * 来源：SQLite `agent_teams` 表。
 * 含义：保存一个会话内由主智能体创建的协作 team。
 * 格式：数据库字段映射为中心服务内部驼峰字段。
 * 默认值：无。
 * 约束：team 跟随会话生命周期，不作为全局长期对象复用。
 */
export interface AgentTeamRow {
    /** teamId: team ID，中心服务生成的 UUID。 */
    teamId: string;
    /** sessionId: team 归属会话 ID。 */
    sessionId: string;
    /** name: team 展示名称。 */
    name: string;
    /** description: team 说明，可为空。 */
    description: string | null;
    /** createdByAgentId: 创建者智能体 ID，本轮固定要求为 main。 */
    createdByAgentId: string;
    /** createdAt: 创建时间，中心服务本机 `YYYY-MM-DD HH:mm:ss` 字符串。 */
    createdAt: string;
    /** updatedAt: 更新时间，中心服务本机 `YYYY-MM-DD HH:mm:ss` 字符串。 */
    updatedAt: string;
}

/**
 * AgentTeamMemberRow：会话级 team 成员关系行。
 *
 * 来源：SQLite `agent_team_members` 表。
 * 含义：保存 team 和长期智能体的成员关系。
 * 格式：成员只能引用启用状态的长期智能体。
 * 默认值：role 由领域层明确传入。
 * 约束：移除成员只删除关系，不删除长期智能体和记忆。
 */
export interface AgentTeamMemberRow {
    /** memberId: 成员关系 ID。 */
    memberId: string;
    /** teamId: 归属 team ID。 */
    teamId: string;
    /** agentId: 长期智能体 ID。 */
    agentId: string;
    /** role: 成员在 team 中的角色。 */
    role: string;
    /** addedAt: 加入时间，中心服务本机 `YYYY-MM-DD HH:mm:ss` 字符串。 */
    addedAt: string;
}

/**
 * AgentTeamRepository：会话级 team 数据访问层。
 *
 * 用途：集中处理 agent_teams 和 agent_team_members 的 SQLite 读写。
 * 关键逻辑：只做明确字段写入，不猜测成员来源和审批规则。
 */
export class AgentTeamRepository {
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
     * createTeam：创建会话级 team。
     *
     * @param input 已校验的 team 字段。
     * @returns 没有返回值。
     */
    createTeam(input: AgentTeamRow): void {
        this.database.connection()
            .prepare(`
                INSERT INTO agent_teams (id,
                                         session_id,
                                         name,
                                         description,
                                         created_by_agent_id,
                                         created_at,
                                         updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `)
            .run(
                input.teamId,
                input.sessionId,
                input.name,
                input.description,
                input.createdByAgentId,
                input.createdAt,
                input.updatedAt,
            );
    }

    /**
     * findMember：按 team 和智能体查询成员关系。
     *
     * @param teamId team ID。
     * @param agentId 长期智能体 ID。
     * @returns 找到时返回成员关系，否则返回 undefined。
     */
    findMember(
        teamId: string,
        agentId: string,
    ): AgentTeamMemberRow | undefined {
        return this.database.connection()
            .prepare(`
                SELECT id       AS memberId,
                       team_id  AS teamId,
                       agent_id AS agentId,
                       role,
                       added_at AS addedAt
                FROM agent_team_members
                WHERE team_id = ?
                  AND agent_id = ?
            `)
            .get(
                teamId,
                agentId,
            ) as AgentTeamMemberRow | undefined;
    }

    /**
     * addMember：添加 team 成员关系。
     *
     * @param input 已校验成员关系字段。
     * @returns 没有返回值。
     */
    addMember(input: AgentTeamMemberRow): void {
        this.database.connection()
            .prepare(`
                INSERT INTO agent_team_members (id,
                                                team_id,
                                                agent_id,
                                                role,
                                                added_at)
                VALUES (?, ?, ?, ?, ?)
            `)
            .run(
                input.memberId,
                input.teamId,
                input.agentId,
                input.role,
                input.addedAt,
            );
    }

    /**
     * deleteTeam：物理删除 team 和成员关系。
     *
     * @param teamId team ID。
     * @returns 删除的 team 数量。
     */
    deleteTeam(teamId: string): number {
        const transaction = this.database.connection().transaction(() => {
            this.database.connection()
                .prepare("DELETE FROM agent_team_members WHERE team_id = ?")
                .run(teamId);
            const result = this.database.connection()
                .prepare("DELETE FROM agent_teams WHERE id = ?")
                .run(teamId);
            return Number(result.changes);
        });
        return transaction() as number;
    }

    /**
     * removeMember：移除 team 成员关系。
     *
     * @param teamId team ID。
     * @param agentId 长期智能体 ID。
     * @returns 删除的成员关系数量。
     */
    removeMember(
        teamId: string,
        agentId: string,
    ): number {
        const result = this.database.connection()
            .prepare("DELETE FROM agent_team_members WHERE team_id = ? AND agent_id = ?")
            .run(
                teamId,
                agentId,
            );
        return Number(result.changes);
    }
}
