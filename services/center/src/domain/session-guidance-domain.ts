import {
    FINAL_TASK_STATUSES,
    TASK_STATUSES,
} from "@zhixin/shared";

import type {CenterDatabase} from "../database.js";
import type {CenterEventStore} from "../events.js";
import {SessionRepository} from "../data-access/session-repository.js";
import {
    createTaskStep,
    recordTaskPlanRevised,
    updateTaskStep,
} from "./session-domain.js";

/**
 * submitGuidanceForActiveTask：把用户中途补充或修改需求合并到当前任务。
 *
 * @param database 中心服务数据库。
 * @param events 事件追加器。
 * @param input 用户补充引导上下文。
 * @returns 合并后的任务和新增步骤身份。
 */
export function submitGuidanceForActiveTask(
    database: CenterDatabase,
    events: CenterEventStore,
    input: {
        /** sessionId: 当前会话 ID。 */
        sessionId: string;
        /** contentMarkdown: 用户补充或修改的需求文本。 */
        contentMarkdown: string;
    },
): {
    taskId: string;
    turnId: string;
    stepId: string;
    status: "merged";
} {
    const repository = new SessionRepository(database);
    const tasks = repository.listTasks(input.sessionId).filter((task) => {
        return task.status === TASK_STATUSES.RUNNING
            || task.status === TASK_STATUSES.QUEUED
            || task.status === TASK_STATUSES.WAITING_USER;
    });
    const activeTask = tasks[tasks.length - 1];
    if (!activeTask) {
        throw new Error("ACTIVE_TASK_NOT_FOUND");
    }
    const existingSteps = repository.listTaskSteps(input.sessionId).filter((step) => {
        return step.taskId === activeTask.taskId
            && !FINAL_TASK_STATUSES.some((status) => {
                return status === step.status;
            });
    });
    const maxPlanVersion = Math.max(
        1,
        ...repository.listTaskStepsByTaskForAgent({
            sessionId: input.sessionId,
            taskId: activeTask.taskId,
            agentId: activeTask.agentId,
        }).map((step) => {
            return step.planVersion;
        }),
    );
    const nextPlanVersion = maxPlanVersion + 1;
    for (const step of existingSteps) {
        updateTaskStep(
            database,
            events,
            step.stepId,
            TASK_STATUSES.SUPERSEDED,
            "用户中途补充或修改需求后，该步骤由新计划替换。",
            undefined,
            {
                supersededReason: "用户中途补充或修改需求后，该步骤由新计划替换。",
            },
        );
    }
    recordTaskPlanRevised(
        events,
        {
            sessionId: input.sessionId,
            turnId: activeTask.turnId,
            taskId: activeTask.taskId,
            planVersion: nextPlanVersion,
            reason: input.contentMarkdown,
            supersededStepIds: existingSteps.map((step) => {
                return step.stepId;
            }),
        },
    );
    const guidanceStep = createTaskStep(
        database,
        events,
        {
            taskId: activeTask.taskId,
            sessionId: input.sessionId,
            turnId: activeTask.turnId,
        },
        "用户补充引导",
        {
            planVersion: nextPlanVersion,
            source: "user",
            acceptance: "按用户补充引导调整当前任务计划。",
        },
    );
    updateTaskStep(
        database,
        events,
        guidanceStep.stepId,
        TASK_STATUSES.RUNNING,
        input.contentMarkdown,
    );
    return {
        taskId: activeTask.taskId,
        turnId: activeTask.turnId,
        stepId: guidanceStep.stepId,
        status: "merged",
    };
}
