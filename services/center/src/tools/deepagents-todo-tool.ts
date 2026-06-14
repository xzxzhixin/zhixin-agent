import type {CenterDatabase} from "../database.js";
import type {CenterEventStore} from "../events.js";
import {SessionRepository} from "../data-access/session-repository.js";
import type {TaskRecord} from "@zhixin/shared";
import type {TaskStepRecord} from "../types.js";
import {
    createTaskStep,
    updateTaskStep,
} from "../domain/session-domain.js";

/**
 * DeepAgentsTodoTaskStepItem：Deep Agents todo 同步后的拆解步骤条目。
 *
 * 来源：Deep Agents 原生 write_todos 工具参数 todos。
 * 含义：描述当前智能体希望同步到中心服务事实源的长任务拆解步骤。
 * 格式：JSON 对象。
 * 默认值：status 缺省时按 queued 保存。
 * 约束：只能写入当前 sessionId/taskId/agentId 范围。
 */
export interface DeepAgentsTodoTaskStepItem {
    /** id: 可选步骤 ID，存在时只允许更新当前范围内已有步骤。 */
    id?: string;
    /** title: 步骤标题，必须是非空字符串。 */
    title: string;
    /** status: 步骤状态，缺省时按 queued 保存。 */
    status?: TaskRecord["status"];
    /** dependsOn: 依赖步骤 ID 列表，缺省为空数组。 */
    dependsOn?: string[];
    /** acceptance: 步骤完成验收口径，缺省为 null。 */
    acceptance?: string | null;
}

/**
 * DeepAgentsTodoToolResult：Deep Agents todo 同步结果。
 *
 * 来源：中心服务同步 Deep Agents 原生 write_todos 后生成。
 * 含义：供工具事件和模型回填使用的结构化摘要。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：createdStepIds 和 updatedStepIds 都只属于当前任务。
 */
export interface DeepAgentsTodoToolResult {
    /** status: 工具执行状态。 */
    status: "completed" | "failed";
    /** outputSummary: 可回填给模型的中文摘要。 */
    outputSummary: string;
    /** failureReason: 失败原因，成功时为 null。 */
    failureReason: string | null;
    /** createdStepIds: 本次新建步骤 ID 列表。 */
    createdStepIds: string[];
    /** updatedStepIds: 本次更新步骤 ID 列表。 */
    updatedStepIds: string[];
}

/**
 * executeDeepAgentsTodoTool：把 Deep Agents 原生 todo 同步为当前智能体自己的长任务拆解步骤。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param input 当前工具调用上下文和 Deep Agents todo 条目。
 * @returns 工具执行摘要，用于回填模型。
 */
export function executeDeepAgentsTodoTool(
    database: CenterDatabase,
    events: CenterEventStore,
    input: {
        /** sessionId: 当前会话 ID，限制工具只能写当前会话。 */
        sessionId: string;
        /** turnId: 当前轮次 ID，用于事件归属。 */
        turnId: string;
        /** taskId: 当前任务 ID，限制工具只能写当前任务。 */
        taskId: string;
        /** agentId: 当前执行智能体 ID，限制工具只能写当前智能体任务。 */
        agentId: string;
        /** toolCallId: 模型工具调用 ID，用于审计关联。 */
        toolCallId: string;
        /** items: Deep Agents todo 映射后的拆解步骤列表。 */
        items: DeepAgentsTodoTaskStepItem[];
    },
): DeepAgentsTodoToolResult {
    const repository = new SessionRepository(database);
    const task = repository.findTask(input.taskId);
    if (!task || task.sessionId !== input.sessionId || task.agentId !== input.agentId) {
        return {
            status: "failed",
            outputSummary: "",
            failureReason: "TODO_LIST_SCOPE_MISMATCH",
            createdStepIds: [],
            updatedStepIds: [],
        };
    }

    const normalizedItems = normalizeDeepAgentsTodoItems(input.items);
    if (normalizedItems.length <= 1) {
        events.append({
            eventType: "tool.todo.list.skipped",
            scopeType: "tool",
            scopeId: input.taskId,
            sessionId: input.sessionId,
            turnId: input.turnId,
            taskId: input.taskId,
            agentId: input.agentId,
            status: "completed",
            title: "Deep Agents todo 未生成可见拆解",
            summary: "Deep Agents todo 步骤数量不超过 1，按产品口径不制造可见拆解列表。",
            payload: {
                toolCallId: input.toolCallId,
                itemCount: normalizedItems.length,
            },
        });
        return {
            status: "completed",
            outputSummary: "Deep Agents todo 已收到；步骤数量不超过 1，未生成可见拆解列表。",
            failureReason: null,
            createdStepIds: [],
            updatedStepIds: [],
        };
    }

    const currentSteps = repository.listTaskStepsByTaskForAgent({
        sessionId: input.sessionId,
        taskId: input.taskId,
        agentId: input.agentId,
    });
    const currentStepMap = new Map(currentSteps.map((step) => {
        return [
            step.stepId,
            step,
        ];
    }));
    const maxPlanVersion = Math.max(
        1,
        ...currentSteps.map((step) => {
            return step.planVersion;
        }),
    );
    const nextPlanVersion = maxPlanVersion + 1;
    const createdStepIds: string[] = [];
    const updatedStepIds: string[] = [];

    normalizedItems.forEach((item, index) => {
        const existing = item.id ? currentStepMap.get(item.id) : null;
        const stepOrder = index + 1;
        if (existing) {
            updateExistingTodoStep(
                database,
                events,
                existing,
                item,
                nextPlanVersion,
                stepOrder,
            );
            updatedStepIds.push(existing.stepId);
            return;
        }

        const createdStep = createTaskStep(
            database,
            events,
            {
                taskId: input.taskId,
                sessionId: input.sessionId,
                turnId: input.turnId,
            },
            item.title,
            {
                planVersion: nextPlanVersion,
                stepOrder,
                source: "todoList",
                dependsOn: item.dependsOn,
                acceptance: item.acceptance,
                initialStatus: item.status,
            },
        );
        createdStepIds.push(createdStep.stepId);
    });

    events.append({
        eventType: "tool.todo.list.updated",
        scopeType: "tool",
        scopeId: input.taskId,
        sessionId: input.sessionId,
        turnId: input.turnId,
        taskId: input.taskId,
        agentId: input.agentId,
        status: "completed",
        title: "Deep Agents todo 已更新",
        summary: `已维护 ${normalizedItems.length} 个拆解步骤。`,
        payload: {
            toolCallId: input.toolCallId,
            planVersion: nextPlanVersion,
            createdStepIds,
            updatedStepIds,
        },
    });

    return {
        status: "completed",
        outputSummary: `Deep Agents todo 已更新：新增 ${createdStepIds.length} 个步骤，更新 ${updatedStepIds.length} 个步骤。`,
        failureReason: null,
        createdStepIds,
        updatedStepIds,
    };
}

/**
 * normalizeDeepAgentsTodoItems：校验并规范化 Deep Agents todo 同步条目。
 *
 * @param items Deep Agents todo 映射后的条目。
 * @returns 可写入任务步骤表的条目。
 */
function normalizeDeepAgentsTodoItems(items: DeepAgentsTodoTaskStepItem[]): Array<Required<Pick<DeepAgentsTodoTaskStepItem, "title" | "status" | "dependsOn">> & {
    /** id: 可选已有步骤 ID。 */
    id?: string;
    /** acceptance: 步骤验收口径。 */
    acceptance: string | null;
}> {
    return items
        .filter((item) => {
            return typeof item.title === "string" && item.title.trim().length > 0;
        })
        .map((item) => {
            return {
                id: item.id,
                title: item.title.trim(),
                status: normalizeTodoStatus(item.status),
                dependsOn: Array.isArray(item.dependsOn)
                    ? item.dependsOn.filter((stepId) => {
                        return typeof stepId === "string";
                    })
                    : [],
                acceptance: typeof item.acceptance === "string" && item.acceptance.trim().length > 0
                    ? item.acceptance.trim()
                    : null,
            };
        });
}

/**
 * isSupportedTaskStatus：校验模型传入的步骤状态。
 *
 * @param status 模型传入的状态。
 * @returns 是中心服务任务状态时返回 true。
 */
function isSupportedTaskStatus(status: unknown): status is TaskRecord["status"] {
    return status === "queued"
        || status === "running"
        || status === "waiting_user"
        || status === "completed"
        || status === "failed"
        || status === "cancelled"
        || status === "superseded";
}

/**
 * normalizeTodoStatus：把 Deep Agents todo 同步状态转换为中心任务状态。
 *
 * @param status 模型传入的工具状态。
 * @returns 中心服务任务状态；工具 schema 既有 pending 枚举按未开始语义映射为 queued。
 */
function normalizeTodoStatus(status: unknown): TaskRecord["status"] {
    if (status === "pending") {
        return "queued";
    }
    return isSupportedTaskStatus(status)
        ? status
        : "queued";
}

/**
 * updateExistingTodoStep：更新当前范围内已有 Deep Agents todo 步骤。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param existing 当前任务中已存在的步骤。
 * @param item 规范化后的模型条目。
 * @param planVersion 当前计划版本。
 * @param stepOrder 当前条目顺序。
 * @returns 没有返回值。
 */
function updateExistingTodoStep(
    database: CenterDatabase,
    events: CenterEventStore,
    existing: TaskStepRecord,
    item: ReturnType<typeof normalizeDeepAgentsTodoItems>[number],
    planVersion: number,
    stepOrder: number,
): void {
    updateTaskStep(
        database,
        events,
        existing.stepId,
        item.status,
        existing.summary,
        undefined,
        {
            title: item.title,
            planVersion,
            stepOrder,
            source: "todoList",
            dependsOn: item.dependsOn,
            acceptance: item.acceptance,
        },
    );
}
