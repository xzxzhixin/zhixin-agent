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
        return task.status === "running"
            || task.status === "queued"
            || task.status === "waiting_user";
    });
    const activeTask = tasks[tasks.length - 1];
    if (!activeTask) {
        throw new Error("ACTIVE_TASK_NOT_FOUND");
    }
    const existingSteps = repository.listTaskSteps(input.sessionId).filter((step) => {
        return step.taskId === activeTask.taskId
            && step.status !== "completed"
            && step.status !== "failed"
            && step.status !== "cancelled"
            && step.status !== "superseded";
    });
    for (const step of existingSteps) {
        updateTaskStep(
            database,
            events,
            step.stepId,
            "superseded",
            "用户中途补充或修改需求后，该步骤由新计划替换。",
        );
    }
    recordTaskPlanRevised(
        events,
        {
            sessionId: input.sessionId,
            turnId: activeTask.turnId,
            taskId: activeTask.taskId,
            planVersion: Date.now(),
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
    );
    updateTaskStep(
        database,
        events,
        guidanceStep.stepId,
        "running",
        input.contentMarkdown,
    );
    return {
        taskId: activeTask.taskId,
        turnId: activeTask.turnId,
        stepId: guidanceStep.stepId,
        status: "merged",
    };
}
