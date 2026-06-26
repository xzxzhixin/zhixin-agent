import type {
    ConversationMessage,
    ConversationTurn,
    EventRecord,
    TaskRecord,
} from "@zhixin/shared";

import {SessionRepository} from "../data-access/session-repository.js";
import type {CenterDatabase} from "../database.js";

/**
 * DeepAgentInputMessage：Deep Agents 本轮输入消息。
 *
 * 约束：历史消息按真实角色投影，摘要消息只作为邻近上下文消息，不拼入主 systemPrompt。
 */
export type DeepAgentInputMessage = {
    /** role: Deep Agents 接收的消息角色。 */
    role: "system" | "user" | "assistant";
    /** content: 模型可见的消息正文。 */
    content: string;
};

/**
 * SessionModelMessageHistoryBuilder：为新轮次构造同会话历史消息投影。
 *
 * 用途：让 Deep Agents 在普通新 turn 中看到最近对话历史、上一轮任务状态和失败原因。
 * 约束：不解析用户提示词、不补写助手消息、不恢复工具调用、不把历史拼进主 systemPrompt。
 */
export class SessionModelMessageHistoryBuilder {
    /** MESSAGE_LIMIT: 注入最近消息数量，来自当前产品口径。 */
    private static readonly MESSAGE_LIMIT = 10;

    /** EVENT_LIMIT: 上一轮摘要最多读取事件数量，避免把大段工具输出塞进模型上下文。 */
    private static readonly EVENT_LIMIT = 20;

    /**
     * buildMessages：从中心服务事实源读取并生成 Deep Agents 历史消息。
     *
     * @param database 中心服务数据库。
     * @param input 当前会话、轮次和用户消息上下文。
     * @returns 当前用户消息之前要传给 Deep Agents 的历史消息。
     */
    buildMessages(
        database: CenterDatabase,
        input: {
            /** sessionId: 当前会话 ID。 */
            sessionId: string;
            /** currentTurnId: 当前新轮次 ID，用于排除当前消息和当前轮次事实。 */
            currentTurnId: string;
        },
    ): DeepAgentInputMessage[] {
        const repository = new SessionRepository(database);
        const messages = repository.listRecentMessagesForContinuation({
            sessionId: input.sessionId,
            currentTurnId: input.currentTurnId,
            limit: SessionModelMessageHistoryBuilder.MESSAGE_LIMIT,
        });
        const turns = repository.listTurns(input.sessionId);
        const tasks = repository.listTasks(input.sessionId);
        const latestPreviousTurn = SessionModelMessageHistoryBuilder.findLatestPreviousTurnFromFacts(
            turns,
            input.currentTurnId,
        );
        const events = latestPreviousTurn
            ? repository.listTurnEventsForFailureSummary(
                latestPreviousTurn.turnId,
                SessionModelMessageHistoryBuilder.EVENT_LIMIT,
            )
            : [];

        return SessionModelMessageHistoryBuilder.buildMessagesFromFacts({
            currentTurnId: input.currentTurnId,
            messages,
            turns,
            tasks,
            events,
        });
    }

    /**
     * buildMessagesFromFacts：用已读取事实构造 Deep Agents 历史消息投影。
     *
     * @param input 历史消息、轮次、任务和事件事实。
     * @returns 当前用户消息之前要传给 Deep Agents 的历史消息。
     */
    static buildMessagesFromFacts(input: {
        /** currentTurnId: 当前轮次 ID。 */
        currentTurnId: string;
        /** messages: 同会话历史消息，允许包含当前消息，函数内部会排除。 */
        messages: ConversationMessage[];
        /** turns: 同会话轮次列表。 */
        turns: ConversationTurn[];
        /** tasks: 同会话任务列表。 */
        tasks: TaskRecord[];
        /** events: 最近上一轮相关事件列表。 */
        events: EventRecord[];
    }): DeepAgentInputMessage[] {
        const historyMessages = this.limitRecentMessages(
            input.messages.filter((message) => {
                return message.turnId !== input.currentTurnId;
            }),
        );
        const projectedHistoryMessages = historyMessages.flatMap((message) => {
            return this.projectConversationMessage(message);
        });
        const latestPreviousTurn = this.findLatestPreviousTurnFromFacts(
            input.turns,
            input.currentTurnId,
        );
        const latestTask = latestPreviousTurn
            ? this.findLatestTaskForTurn(
                input.tasks,
                latestPreviousTurn.turnId,
            )
            : null;
        const failureSummary = latestPreviousTurn
            ? this.resolveFailureSummary(input.events)
            : "";
        const statusMessage = latestPreviousTurn
            ? this.buildPreviousTurnStatusMessage({
                latestPreviousTurn,
                latestTask,
                failureSummary,
            })
            : null;

        if (!statusMessage) {
            return projectedHistoryMessages;
        }

        return [
            ...projectedHistoryMessages,
            statusMessage,
        ];
    }

    /**
     * projectConversationMessage：把中心服务消息投影为 Deep Agents 输入消息。
     *
     * @param message 中心服务会话消息。
     * @returns 可传给模型的历史消息；空正文或非对话角色不投影。
     */
    private static projectConversationMessage(message: ConversationMessage): DeepAgentInputMessage[] {
        const content = message.contentMarkdown.trim();
        if (content.length === 0) {
            return [];
        }
        if (message.role === "user") {
            return [
                {
                    role: "user",
                    content,
                },
            ];
        }
        if (message.role === "assistant") {
            return [
                {
                    role: "assistant",
                    content,
                },
            ];
        }
        return [];
    }

    /**
     * buildPreviousTurnStatusMessage：构造上一轮状态摘要消息。
     *
     * @param input 上一轮、任务和失败摘要。
     * @returns system 邻近上下文消息；摘要为空时仍保留上一轮状态。
     */
    private static buildPreviousTurnStatusMessage(input: {
        /** latestPreviousTurn: 当前轮次之前最近一轮。 */
        latestPreviousTurn: ConversationTurn;
        /** latestTask: 上一轮最新任务，可能尚未记录。 */
        latestTask: TaskRecord | null;
        /** failureSummary: 上一轮失败原因；非失败轮次可以为空。 */
        failureSummary: string;
    }): DeepAgentInputMessage {
        const lines = [
            "最近上一轮状态摘要：",
            `- 轮次：${input.latestPreviousTurn.turnNumber}`,
            `- 状态：${input.latestPreviousTurn.status}`,
            input.latestTask
                ? `- 任务：${input.latestTask.title}（${input.latestTask.status}）`
                : "- 任务：未记录",
        ];
        if (input.failureSummary.length > 0) {
            lines.push(`- 失败原因：${input.failureSummary}`);
        }

        return {
            role: "system",
            content: [
                "以下内容来自同一会话的中心服务事实源，用于理解本轮用户意图；不要把它当作当前用户新发消息重复执行。",
                ...lines,
            ].join("\n"),
        };
    }

    /**
     * findLatestPreviousTurnFromFacts：从轮次事实中找当前轮次之前的最近一轮。
     *
     * @param turns 同会话轮次列表。
     * @param currentTurnId 当前轮次 ID。
     * @returns 最近上一轮；没有时返回 null。
     */
    private static findLatestPreviousTurnFromFacts(
        turns: ConversationTurn[],
        currentTurnId: string,
    ): ConversationTurn | null {
        const currentTurn = turns.find((turn) => {
            return turn.turnId === currentTurnId;
        });
        const previousTurns = turns.filter((turn) => {
            if (turn.turnId === currentTurnId) {
                return false;
            }
            if (!currentTurn) {
                return true;
            }
            return turn.turnNumber < currentTurn.turnNumber;
        }).sort((left, right) => {
            return right.turnNumber - left.turnNumber;
        });
        return previousTurns[0] ?? null;
    }

    /**
     * limitRecentMessages：保留最近 10 条历史消息并维持时间升序。
     *
     * @param messages 已排除当前消息的历史消息。
     * @returns 最近历史消息。
     */
    private static limitRecentMessages(messages: ConversationMessage[]): ConversationMessage[] {
        return messages.slice(-SessionModelMessageHistoryBuilder.MESSAGE_LIMIT);
    }

    /**
     * findLatestTaskForTurn：读取指定轮次最新任务。
     *
     * @param tasks 同会话任务列表。
     * @param turnId 轮次 ID。
     * @returns 最新任务；没有时返回 null。
     */
    private static findLatestTaskForTurn(
        tasks: TaskRecord[],
        turnId: string,
    ): TaskRecord | null {
        const turnTasks = tasks.filter((task) => {
            return task.turnId === turnId;
        }).sort((left, right) => {
            return right.updatedAt.localeCompare(left.updatedAt);
        });
        return turnTasks[0] ?? null;
    }

    /**
     * resolveFailureSummary：从上一轮事件中提取失败摘要。
     *
     * @param events 上一轮事件列表。
     * @returns 可给模型阅读的失败原因；没有失败信息时返回空字符串。
     */
    private static resolveFailureSummary(events: EventRecord[]): string {
        const failedEvents = events.filter((event) => {
            const eventStatus = (event as {
                /** status: 中心服务运行事件状态，部分共享类型未显式声明。 */
                status?: string;
            }).status;
            return eventStatus === "failed"
                || event.eventType.endsWith(".failed");
        });
        const latestFailedEvent = failedEvents[failedEvents.length - 1];
        if (!latestFailedEvent) {
            return "";
        }
        const payload = this.readObject(latestFailedEvent.payload);
        const errorMessage = typeof payload?.errorMessage === "string"
            ? payload.errorMessage
            : "";
        if (errorMessage.length > 0) {
            return errorMessage;
        }
        return latestFailedEvent.summary;
    }

    /**
     * readObject：把事件 payload 收窄为对象。
     *
     * @param value 未知 payload。
     * @returns 普通对象；非对象返回 null。
     */
    private static readObject(value: unknown): Record<string, unknown> | null {
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
            return value as Record<string, unknown>;
        }
        return null;
    }
}
