import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import type {FastifyInstance} from "fastify";
import type {
    AgentSubConversationDetail,
    AgentSubConversationMessage,
    PendingEditDiff,
    PendingEditRecord,
} from "@zhixin/shared";
import {
    EVENT_SCOPE_TYPES,
    EVENT_TYPES,
    TASK_STATUSES,
} from "@zhixin/shared";

import type {CenterDatabase} from "../database.js";
import type {CenterEventStore} from "../events.js";
import {
    createErrorResponse,
    createSuccessResponse,
} from "../helpers.js";
import {
    findSession,
    listEvents,
    listTaskStepsByAgent,
    listTasksByAgent,
} from "../domain/session-domain.js";
import {AgentEditRepository} from "../data-access/agent-edit-repository.js";
export {
    recordPendingFileEdit,
    writeFileAndRecordPendingEdit,
} from "../agent-edit-domain.js";

/**
 * AgentEditRoutesContext：智能体子对话与待确认编辑路由上下文。
 *
 * 来源：中心服务 API 注册入口。
 * 含义：承载路由需要的数据库、事件源和 Fastify 实例。
 * 约束：中心服务仍是唯一事实源，前端和 IDE 不直接改核心表。
 */
export interface AgentEditRoutesContext {
    /** app: Fastify 路由实例。 */
    app: FastifyInstance;
    /** database: 中心服务 SQLite 连接包装。 */
    database: CenterDatabase;
    /** events: 中心服务事件日志。 */
    events: CenterEventStore;
}

/**
 * registerAgentEditRoutes：注册智能体子对话和编辑确认接口。
 *
 * @param context 路由注册上下文。
 * @returns 没有返回值。
 */
export function registerAgentEditRoutes(context: AgentEditRoutesContext): void {
    const {
        app,
        database,
        events,
    } = context;
    const agentEditRepository = new AgentEditRepository(database);

    app.post("/api/agent-sub-conversation/detail", async (request) => {
        const body = request.body as {
            parentSessionId?: string;
            agentId?: string;
            agentName?: string;
        };
        const validation = validateAgentSubConversationInput(
            database,
            body.parentSessionId,
            body.agentId,
        );
        if (validation) {
            return validation;
        }

        const parentSessionId = body.parentSessionId ?? "";
        const agentId = body.agentId ?? "";
        return createSuccessResponse<AgentSubConversationDetail>({
            parentSessionId,
            agentId,
            agentName: body.agentName ?? agentId,
            messages: listAgentSubConversationMessages(
                agentEditRepository,
                parentSessionId,
                agentId,
            ),
            tasks: listTasksByAgent(
                database,
                parentSessionId,
                agentId,
            ),
            taskSteps: listTaskStepsByAgent(
                database,
                parentSessionId,
                agentId,
            ),
            events: listEvents(
                database,
                {
                    sessionId: parentSessionId,
                    turnId: null,
                    agentId,
                    afterSequence: 0,
                },
            ),
        });
    });

    app.post("/api/agent-sub-conversation/message/send", async (request) => {
        const body = request.body as {
            parentSessionId?: string;
            agentId?: string;
            agentName?: string;
            contentMarkdown?: string;
        };
        const validation = validateAgentSubConversationInput(
            database,
            body.parentSessionId,
            body.agentId,
        );
        if (validation) {
            return validation;
        }
        if (!body.contentMarkdown?.trim()) {
            return createErrorResponse(
                "AGENT_SUB_MESSAGE_REQUIRED",
                "智能体子对话消息不能为空",
                "请输入要发送给该智能体的内容。",
            );
        }

        const message = insertAgentSubConversationMessage(
            agentEditRepository,
            {
                parentSessionId: body.parentSessionId ?? "",
                agentId: body.agentId ?? "",
                agentName: body.agentName ?? body.agentId ?? "",
                contentMarkdown: body.contentMarkdown,
            },
        );
        events.append({
            eventType: EVENT_TYPES.AGENT_SUB_CONVERSATION_MESSAGE_CREATED,
            scopeType: EVENT_SCOPE_TYPES.AGENT,
            scopeId: message.agentId,
            sessionId: message.parentSessionId,
            turnId: null,
            taskId: null,
            agentId: message.agentId,
            projectId: null,
            status: TASK_STATUSES.COMPLETED,
            title: "智能体子对话消息",
            summary: message.contentMarkdown.slice(
                0,
                120,
            ),
            payload: {
                messageId: message.messageId,
                parentSessionId: message.parentSessionId,
                agentId: message.agentId,
            },
        });

        return createSuccessResponse<AgentSubConversationDetail>({
            parentSessionId: message.parentSessionId,
            agentId: message.agentId,
            agentName: body.agentName ?? message.agentId,
            messages: listAgentSubConversationMessages(
                agentEditRepository,
                message.parentSessionId,
                message.agentId,
            ),
            tasks: listTasksByAgent(
                database,
                message.parentSessionId,
                message.agentId,
            ),
            taskSteps: listTaskStepsByAgent(
                database,
                message.parentSessionId,
                message.agentId,
            ),
            events: listEvents(
                database,
                {
                    sessionId: message.parentSessionId,
                    turnId: null,
                    agentId: message.agentId,
                    afterSequence: 0,
                },
            ),
        });
    });

    app.post("/api/edit-pending/list", async (request) => {
        const body = request.body as {
            sessionId?: string;
        };
        if (!body.sessionId || !findSession(database, body.sessionId)) {
            return createErrorResponse(
                "SESSION_NOT_FOUND",
                "查询待确认编辑时会话不存在",
                "没有找到当前对话的编辑记录。",
            );
        }

        return createSuccessResponse({
            edits: listPendingEditRecords(
                agentEditRepository,
                body.sessionId,
            ),
        });
    });

    app.post("/api/edit-pending/save", async (request) => {
        const body = request.body as {
            editId?: string;
        };
        const record = findPendingEditRecord(
            agentEditRepository,
            body.editId ?? "",
        );
        if (!record) {
            return createErrorResponse(
                "PENDING_EDIT_NOT_FOUND",
                "保存编辑时记录不存在",
                "没有找到要保存的编辑记录。",
            );
        }

        const saved = updatePendingEditStatus(
            agentEditRepository,
            record,
            "accepted",
        );
        appendPendingEditEvent(
            events,
            saved,
            "edit.pending.accepted",
            "编辑已保存",
        );
        return createSuccessResponse({
            edit: saved,
        });
    });

    app.post("/api/edit-pending/save-all", async (request) => {
        const body = request.body as {
            sessionId?: string;
        };
        const records = listPendingEditRecords(
            agentEditRepository,
            body.sessionId ?? "",
        ).filter((record) => {
            return record.status === "pending";
        });
        const edits: PendingEditRecord[] = records.map((record) => {
            const saved = updatePendingEditStatus(
                agentEditRepository,
                record,
                "accepted",
            );
            appendPendingEditEvent(
                events,
                saved,
                "edit.pending.accepted",
                "编辑已保存",
            );
            return saved;
        });
        return createSuccessResponse({
            edits,
        });
    });

    app.post("/api/edit-pending/revert", async (request) => {
        const body = request.body as {
            editId?: string;
        };
        const result = revertPendingEdit(
            agentEditRepository,
            body.editId ?? "",
        );
        if (!result.ok) {
            return createErrorResponse(
                result.code,
                result.message,
                result.displayMessage,
            );
        }
        appendPendingEditEvent(
            events,
            result.edit,
            "edit.pending.reverted",
            "编辑已撤回",
        );
        return createSuccessResponse({
            edit: result.edit,
        });
    });

    app.post("/api/edit-pending/revert-all", async (request) => {
        const body = request.body as {
            sessionId?: string;
        };
        const records = listPendingEditRecords(
            agentEditRepository,
            body.sessionId ?? "",
        ).filter((record) => {
            return record.status === "pending";
        });
        const edits: PendingEditRecord[] = [];
        for (const record of records) {
            const result = revertPendingEdit(
                agentEditRepository,
                record.editId,
            );
            if (result.ok) {
                appendPendingEditEvent(
                    events,
                    result.edit,
                    "edit.pending.reverted",
                    "编辑已撤回",
                );
                edits.push(result.edit);
            }
        }
        return createSuccessResponse({
            edits,
        });
    });

    app.post("/api/edit-pending/diff", async (request) => {
        const body = request.body as {
            editId?: string;
        };
        const record = findPendingEditRecord(
            agentEditRepository,
            body.editId ?? "",
        );
        if (!record) {
            return createErrorResponse(
                "PENDING_EDIT_NOT_FOUND",
                "读取编辑对比时记录不存在",
                "没有找到要查看对比的编辑记录。",
            );
        }

        return createSuccessResponse<PendingEditDiff>({
            editId: record.editId,
            filePath: record.filePath,
            beforeContent: record.beforeContent,
            afterContent: record.afterContent,
            diffText: createUnifiedDiff(record),
        });
    });
}

/**
 * validateAgentSubConversationInput：校验智能体子对话作用域。
 *
 * @param database 中心服务数据库。
 * @param parentSessionId 主会话 ID。
 * @param agentId 智能体 ID。
 * @returns 错误响应或 null。
 */
export function validateAgentSubConversationInput(
    database: CenterDatabase,
    parentSessionId: string | undefined,
    agentId: string | undefined,
) {
    if (!parentSessionId || !findSession(database, parentSessionId)) {
        return createErrorResponse(
            "SESSION_NOT_FOUND",
            "智能体子对话所属主会话不存在",
            "没有找到当前主对话。",
        );
    }
    if (!agentId) {
        return createErrorResponse(
            "AGENT_ID_REQUIRED",
            "智能体子对话缺少 agentId",
            "请选择要打开的智能体。",
        );
    }
    return null;
}

/**
 * listAgentSubConversationMessages：读取指定智能体子对话消息。
 *
 * @param database 中心服务数据库。
 * @param parentSessionId 主会话 ID。
 * @param agentId 智能体 ID。
 * @returns 子对话消息数组。
 */
export function listAgentSubConversationMessages(
    repository: AgentEditRepository,
    parentSessionId: string,
    agentId: string,
): AgentSubConversationMessage[] {
    return repository.listAgentSubConversationMessages(
        parentSessionId,
        agentId,
    );
}

/**
 * insertAgentSubConversationMessage：写入智能体子对话用户消息。
 *
 * @param database 中心服务数据库。
 * @param input 子对话写入字段。
 * @returns 已创建消息。
 */
export function insertAgentSubConversationMessage(
    repository: AgentEditRepository,
    input: {
        parentSessionId: string;
        agentId: string;
        agentName: string;
        contentMarkdown: string;
    },
): AgentSubConversationMessage {
    const messageId = randomUUID();
    const now = new Date().toISOString();
    repository.insertAgentSubConversationMessage({
        messageId,
        parentSessionId: input.parentSessionId,
        agentId: input.agentId,
        agentName: input.agentName,
        contentMarkdown: input.contentMarkdown,
        createdAt: now,
    });
    return {
        messageId,
        parentSessionId: input.parentSessionId,
        agentId: input.agentId,
        role: "user",
        contentMarkdown: input.contentMarkdown,
        createdAt: now,
    };
}

/**
 * listPendingEditRecords：读取会话待确认编辑。
 *
 * @param database 中心服务数据库。
 * @param sessionId 会话 ID。
 * @returns 编辑记录数组。
 */
export function listPendingEditRecords(
    repository: AgentEditRepository,
    sessionId: string,
): PendingEditRecord[] {
    return repository.listPendingEditRecords(sessionId);
}

/**
 * findPendingEditRecord：按 ID 查询编辑记录。
 *
 * @param database 中心服务数据库。
 * @param editId 编辑记录 ID。
 * @returns 编辑记录或 null。
 */
export function findPendingEditRecord(
    repository: AgentEditRepository,
    editId: string,
): PendingEditRecord | null {
    return repository.findPendingEditRecord(editId);
}

/**
 * updatePendingEditStatus：更新编辑确认状态。
 *
 * @param database 中心服务数据库。
 * @param record 原编辑记录。
 * @param status 新状态。
 * @returns 更新后的编辑记录。
 */
export function updatePendingEditStatus(
    repository: AgentEditRepository,
    record: PendingEditRecord,
    status: PendingEditRecord["status"],
): PendingEditRecord {
    const now = new Date().toISOString();
    repository.updatePendingEditStatus(
        record.editId,
        status,
        now,
    );
    return {
        ...record,
        status,
        updatedAt: now,
    };
}

/**
 * revertPendingEdit：按编辑前内容撤回文件。
 *
 * @param database 中心服务数据库。
 * @param editId 编辑记录 ID。
 * @returns 撤回结果。
 */
export function revertPendingEdit(
    repository: AgentEditRepository,
    editId: string,
): {
    ok: true;
    edit: PendingEditRecord;
} | {
    ok: false;
    code: string;
    message: string;
    displayMessage: string;
} {
    const record = findPendingEditRecord(repository, editId);
    if (!record) {
        return {
            ok: false,
            code: "PENDING_EDIT_NOT_FOUND",
            message: "撤回编辑时记录不存在",
            displayMessage: "没有找到要撤回的编辑记录。",
        };
    }
    if (record.status !== "pending") {
        return {
            ok: false,
            code: "PENDING_EDIT_CLOSED",
            message: "编辑记录已结束，不能撤回",
            displayMessage: "该编辑已经保存或撤回，不能再次撤回。",
        };
    }
    if (!existsSync(record.filePath)) {
        updatePendingEditStatus(
            repository,
            record,
            "conflicted",
        );
        return {
            ok: false,
            code: "PENDING_EDIT_FILE_MISSING",
            message: `文件已不存在：${record.filePath}`,
            displayMessage: "文件已经不存在，已标记冲突，不能撤回到编辑前状态。",
        };
    }

    const currentContent = readFileSync(
        record.filePath,
        "utf8",
    );
    if (currentContent !== record.afterContent) {
        const conflicted = updatePendingEditStatus(
            repository,
            record,
            "conflicted",
        );
        return {
            ok: false,
            code: "PENDING_EDIT_CONFLICT",
            message: `文件已被再次修改：${conflicted.filePath}`,
            displayMessage: "文件当前内容与本次编辑结果不一致，已标记冲突，不能盲目覆盖。",
        };
    }

    writeFileSync(
        record.filePath,
        record.beforeContent,
        "utf8",
    );
    return {
        ok: true,
        edit: updatePendingEditStatus(
            repository,
            record,
            "reverted",
        ),
    };
}

/**
 * createUnifiedDiff：创建轻量统一 diff 文本。
 *
 * @param record 编辑记录。
 * @returns diff 文本。
 */
export function createUnifiedDiff(record: PendingEditRecord): string {
    const beforeLines = record.beforeContent.split(/\r?\n/u);
    const afterLines = record.afterContent.split(/\r?\n/u);
    return [
        `--- ${record.filePath}`,
        `+++ ${record.filePath}`,
        ...beforeLines.map((line) => {
            return `- ${line}`;
        }),
        ...afterLines.map((line) => {
            return `+ ${line}`;
        }),
    ].join("\n");
}

/**
 * appendPendingEditEvent：追加编辑确认事件。
 *
 * @param events 中心服务事件日志。
 * @param edit 编辑记录。
 * @param eventType 事件类型。
 * @param title 事件标题。
 * @returns 没有返回值。
 */
export function appendPendingEditEvent(
    events: CenterEventStore,
    edit: PendingEditRecord,
    eventType: string,
    title: string,
): void {
    events.append({
        eventType,
        scopeType: EVENT_SCOPE_TYPES.FILE,
        scopeId: edit.filePath,
        sessionId: edit.sessionId,
        turnId: null,
        taskId: null,
        agentId: edit.agentId,
        projectId: null,
        status: edit.status === "conflicted"
            ? TASK_STATUSES.FAILED
            : TASK_STATUSES.COMPLETED,
        title,
        summary: edit.filePath,
        payload: {
            editId: edit.editId,
            filePath: edit.filePath,
            status: edit.status,
        },
    });
}
