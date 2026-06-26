import {randomUUID} from "node:crypto";

import {
    EVENT_SCOPE_TYPES,
    TASK_STATUSES,
} from "@zhixin/shared";

import type {CenterDatabase} from "../database.js";
import type {CenterEventStore} from "../events.js";
import {createDataAccess} from "../data-access/index.js";

/**
 * AgentTeamToolScope：会话级 team 工具公共上下文。
 *
 * 来源：模型工具调用闭环和当前会话任务身份。
 * 含义：四个 team 工具写入 team 数据和事件时需要的事实源。
 * 格式：数据库、事件和会话/轮次/任务 ID。
 * 默认值：无。
 * 约束：creatorAgentId 必须由调用方明确传入，不能在工具里猜测。
 */
export interface AgentTeamToolScope {
    /** database: 中心服务数据库事实源。 */
    database: CenterDatabase;
    /** events: 中心服务事件事实源。 */
    events: CenterEventStore;
    /** sessionId: team 归属会话 ID。 */
    sessionId: string;
    /** turnId: 当前轮次 ID，用于事件排序。 */
    turnId: string;
    /** taskId: 当前任务 ID，用于工具过程卡片聚合。 */
    taskId: string;
    /** creatorAgentId: 调用 team 管理工具的智能体 ID。 */
    creatorAgentId: string;
    /** toolCallId: 模型工具调用 ID；非模型触发时可为空。 */
    toolCallId?: string | null;
}

/**
 * assertMainAgentCreator：校验 team 管理工具只能由主智能体调用。
 *
 * @param creatorAgentId 创建者智能体 ID。
 * @returns 校验通过没有返回值。
 */
export function assertMainAgentCreator(creatorAgentId: string): void {
    if (creatorAgentId !== "main") {
        throw new Error("AGENT_TEAM_TOOL_ONLY_MAIN");
    }
}

/**
 * assertEnabledLongTermAgent：校验成员必须是启用长期智能体。
 *
 * @param database 中心服务数据库事实源。
 * @param agentId 候选长期智能体 ID。
 * @returns 智能体名称。
 */
export function assertEnabledLongTermAgent(
    database: CenterDatabase,
    agentId: string,
): string {
    const agent = createDataAccess(database).agents.findAgentById(agentId);
    if (!agent || agent.agentId === "main" || agent.enabled !== 1) {
        throw new Error("AGENT_TEAM_MEMBER_MUST_BE_ENABLED_LONG_TERM_AGENT");
    }
    return agent.name;
}

/**
 * appendAgentTeamToolEvent：写入会话级 team 工具过程事件。
 *
 * @param scope team 工具公共上下文。
 * @param input 事件内容。
 * @returns 没有返回值。
 */
export function appendAgentTeamToolEvent(
    scope: AgentTeamToolScope,
    input: {
        /** eventType: team 工具事件类型。 */
        eventType: string;
        /** title: 过程卡片标题。 */
        title: string;
        /** summary: 过程摘要。 */
        summary: string;
        /** payload: 事件载荷。 */
        payload: Record<string, unknown>;
    },
): void {
    scope.events.append({
        eventType: input.eventType,
        scopeType: EVENT_SCOPE_TYPES.AGENT_TEAM,
        scopeId: typeof input.payload.teamId === "string"
            ? input.payload.teamId
            : scope.taskId,
        sessionId: scope.sessionId,
        turnId: scope.turnId,
        taskId: scope.taskId,
        agentId: scope.creatorAgentId,
        status: TASK_STATUSES.COMPLETED,
        title: input.title,
        summary: input.summary,
        payload: {
            ...input.payload,
            toolCallId: scope.toolCallId ?? null,
        },
    });
}

/**
 * createTeamId：生成会话级 team ID。
 *
 * @returns team ID。
 */
export function createTeamId(): string {
    return `team-${randomUUID()}`;
}

/**
 * createTeamMemberId：生成 team 成员关系 ID。
 *
 * @returns 成员关系 ID。
 */
export function createTeamMemberId(): string {
    return `team-member-${randomUUID()}`;
}
