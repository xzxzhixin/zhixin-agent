import {
    mkdirSync,
} from "node:fs";
import {
    dirname,
    join,
} from "node:path";

import {
    END,
    START,
    StateGraph,
} from "@langchain/langgraph";
import {SqliteSaver} from "@langchain/langgraph-checkpoint-sqlite";

import type {CenterDatabase} from "./database.js";
import type {CenterEventStore} from "./events.js";
import type {OpenAiToolCall} from "./openai-chat-protocol.js";
import type {ProviderModelGatewayResult} from "./model-gateway-runtime.js";
import type {SendMessageResponse} from "./types.js";
import type {MemoryQueueState} from "./types.js";

/**
 * TurnGraphRoute：LangGraph 条件边的路由结果。
 *
 * 来源：上一节点执行结果。
 * 含义：决定模型后是否进入工具执行、工具结果回填后是否继续循环、是否进入失败收尾。
 * 格式：固定字符串。
 * 默认值：无。
 * 约束：只在 LangGraph runner 内部使用。
 */
type TurnGraphRoute =
    | "tool.execute"
    | "message.persist"
    | "memory.commit"
    | "usage.record"
    | "failure.close";

/**
 * TurnGraphExecutedTool：已执行工具摘要。
 *
 * 来源：工具执行节点。
 * 含义：供工具计划节点和审计事件记录模型实际请求过的工具。
 * 格式：工具 ID、工具类型和输入摘要。
 * 默认值：没有工具时为 null。
 * 约束：不得包含完整敏感入参或工具输出正文。
 */
export interface TurnGraphExecutedTool {
    /** toolId: 中心服务内部工具 ID。 */
    toolId: string;
    /** toolKind: 工具类型，例如 command 或 mcp。 */
    toolKind: string;
    /** inputSummary: 可展示输入摘要。 */
    inputSummary: string;
}

/**
 * TurnGraphToolResult：工具执行节点和工具结果回填节点之间传递的结果。
 *
 * 来源：中心服务工具运行时。
 * 含义：保存 OpenAI tool_call_id 对应工具输出，供下一次模型调用回填。
 * 格式：工具调用、结果文本和可审计工具摘要。
 * 默认值：没有工具调用时为空数组。
 * 约束：结果文本只保存摘要，不保存命令完整 stdout 大文本。
 */
export interface TurnGraphToolResult {
    /** toolCall: OpenAI 结构化工具调用。 */
    toolCall: OpenAiToolCall;
    /** resultText: 回填模型的工具结果摘要。 */
    resultText: string;
    /** executedTool: UI 和审计使用的工具摘要。 */
    executedTool: TurnGraphExecutedTool;
}

/**
 * LangGraphTurnState：中心服务每轮对话传入 LangGraphJS 的状态。
 *
 * 来源：会话发送接口已经创建的消息、轮次和任务身份。
 * 含义：承载每个 LangGraph 节点之间需要传递的最小状态。
 * 格式：运行期对象。
 * 默认值：无。
 * 约束：sessionId 映射 LangGraph configurable.thread_id，turnId 映射项目内部 graph run。
 */
export interface LangGraphTurnState {
    /** sessionId: 会话 ID，同时作为 LangGraph thread_id。 */
    sessionId: string;
    /** turnId: 当前轮次 ID，同时作为项目内部 graphRunId。 */
    turnId: string;
    /** taskId: 当前轮次默认任务 ID。 */
    taskId: string;
    /** sent: 发送接口创建的身份集合。 */
    sent: SendMessageResponse;
    /** userText: 用户原始输入文本。 */
    userText: string;
    /** centerDirectory: 中心目录绝对路径；为空时跳过长期记忆提交。 */
    centerDirectory?: string;
    /** modelResult: 最近一次模型调用结果。 */
    modelResult: ProviderModelGatewayResult | null;
    /** finalModelResult: 本轮最终模型结果。 */
    finalModelResult: ProviderModelGatewayResult | null;
    /** executedTool: 已执行工具摘要，没有工具时为 null。 */
    executedTool: TurnGraphExecutedTool | null;
    /** toolResults: 最近一轮工具执行结果，供 tool.result 节点回填。 */
    toolResults: TurnGraphToolResult[];
    /** toolRound: OpenAI 工具调用循环轮次，避免模型无限请求工具。 */
    toolRound: number;
    /** assistantText: 待固化助手回复正文。 */
    assistantText: string | null;
    /** assistantMessageId: 已固化助手消息 ID。 */
    assistantMessageId: string | null;
    /** incompleteToolIntent: 是否因半截工具意图失败。 */
    incompleteToolIntent: boolean;
    /** failed: 节点执行是否已进入失败收尾。 */
    failed: boolean;
    /** errorMessage: 失败摘要。 */
    errorMessage: string | null;
}

/**
 * TurnGraphNodeExecutors：会话域提供给 LangGraph runner 的节点执行器。
 *
 * 来源：session-domain 中心服务事实源操作。
 * 含义：让 runner 只负责编排，副作用仍收敛在会话域。
 * 格式：每个字段对应一个 LangGraph 节点。
 * 默认值：无。
 * 约束：执行器需要自己写入 events、task_steps 和 payload.graph。
 */
export interface TurnGraphNodeExecutors {
    /** thinkingContext: 整理上下文和公开思考摘要。 */
    thinkingContext: (state: LangGraphTurnState) => Promise<Partial<LangGraphTurnState>>;
    /** modelStream: 调用模型并接收 OpenAI 流式回复。 */
    modelStream: (state: LangGraphTurnState) => Promise<Partial<LangGraphTurnState>>;
    /** toolExecute: 执行模型请求的 OpenAI tool_calls。 */
    toolExecute: (state: LangGraphTurnState) => Promise<Partial<LangGraphTurnState>>;
    /** toolResult: 把工具结果按 OpenAI tool_call_id 回填给模型。 */
    toolResult: (state: LangGraphTurnState) => Promise<Partial<LangGraphTurnState>>;
    /** toolPlan: 记录工具计划和可见能力状态。 */
    toolPlan: (state: LangGraphTurnState) => Promise<Partial<LangGraphTurnState>>;
    /** messagePersist: 固化最终助手消息或处理不完整工具意图。 */
    messagePersist: (state: LangGraphTurnState) => Promise<Partial<LangGraphTurnState>>;
    /** memoryCommit: 写入长期记忆和语义索引。 */
    memoryCommit: (state: LangGraphTurnState) => Promise<Partial<LangGraphTurnState>>;
    /** usageRecord: 写入模型用量并更新会话标题和轮次状态。 */
    usageRecord: (state: LangGraphTurnState) => Promise<Partial<LangGraphTurnState>>;
    /** failureClose: 统一失败收尾。 */
    failureClose: (state: LangGraphTurnState) => Promise<Partial<LangGraphTurnState>>;
}

/**
 * RunLangGraphTurnInput：运行 LangGraphJS 对话图所需输入。
 */
interface RunLangGraphTurnInput {
    /** database: 中心服务 SQLite 连接封装，来源于中心服务主进程。 */
    database: CenterDatabase;
    /** events: 中心服务事件事实源，LangGraph 节点仍必须写 payload.graph 相关事件。 */
    events: CenterEventStore;
    /** sent: 发送接口创建的消息、轮次和任务身份。 */
    sent: SendMessageResponse;
    /** userText: 用户原始输入。 */
    userText: string;
    /** centerDirectory: 中心目录绝对路径，用于 LangGraph checkpointer 和记忆迁移边界。 */
    centerDirectory?: string;
    /** memoryQueues: 智能体记忆单写队列，继续由中心服务事实源控制。 */
    memoryQueues?: Map<string, MemoryQueueState>;
    /** executors: 会话域提供的真实节点执行器。 */
    executors: TurnGraphNodeExecutors;
}

/**
 * createLangGraphCheckpointer：创建 LangGraphJS 本地 SQLite checkpointer。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @returns SQLite checkpointer；未提供中心目录时返回 undefined。
 */
function createLangGraphCheckpointer(centerDirectory?: string): SqliteSaver | undefined {
    if (!centerDirectory) {
        return undefined;
    }

    // checkpointPath: 运行中图状态放入中心目录，随中心目录迁移；长期事实仍由 events、task_steps、Markdown 和 SQLite 主库承载。
    const checkpointPath = join(
        centerDirectory,
        "db",
        "langgraph-checkpoints.sqlite",
    );
    mkdirSync(dirname(checkpointPath), {
        recursive: true,
    });
    return SqliteSaver.fromConnString(checkpointPath);
}

/**
 * runLangGraphTurn：用 LangGraphJS 多节点图驱动当前轮次执行。
 *
 * @param input LangGraph 运行输入。
 * @returns 没有返回值。
 */
export async function runLangGraphTurn(input: RunLangGraphTurnInput): Promise<void> {
    const checkpointer = createLangGraphCheckpointer(input.centerDirectory);
    const workflow = new StateGraph<LangGraphTurnState>({
        channels: {
            sessionId: null,
            turnId: null,
            taskId: null,
            sent: null,
            userText: null,
            centerDirectory: null,
            modelResult: null,
            finalModelResult: null,
            executedTool: null,
            toolResults: null,
            toolRound: null,
            assistantText: null,
            assistantMessageId: null,
            incompleteToolIntent: null,
            failed: null,
            errorMessage: null,
        },
    })
        .addNode("thinking.context", async (state) => {
            return mergeTurnState(
                state,
                await input.executors.thinkingContext(state),
            );
        })
        .addNode("model.stream", async (state) => {
            return mergeTurnState(
                state,
                await input.executors.modelStream(state),
            );
        })
        .addNode("tool.execute", async (state) => {
            return mergeTurnState(
                state,
                await input.executors.toolExecute(state),
            );
        })
        .addNode("tool.result", async (state) => {
            return mergeTurnState(
                state,
                await input.executors.toolResult(state),
            );
        })
        .addNode("tool.plan", async (state) => {
            return mergeTurnState(
                state,
                await input.executors.toolPlan(state),
            );
        })
        .addNode("message.persist", async (state) => {
            return mergeTurnState(
                state,
                await input.executors.messagePersist(state),
            );
        })
        .addNode("memory.commit", async (state) => {
            return mergeTurnState(
                state,
                await input.executors.memoryCommit(state),
            );
        })
        .addNode("usage.record", async (state) => {
            return mergeTurnState(
                state,
                await input.executors.usageRecord(state),
            );
        })
        .addNode("failure.close", async (state) => {
            return mergeTurnState(
                state,
                await input.executors.failureClose(state),
            );
        })
        .addEdge(START, "thinking.context")
        .addEdge("thinking.context", "model.stream")
        .addConditionalEdges(
            "model.stream",
            routeAfterModelStream,
            {
                "tool.execute": "tool.execute",
                "message.persist": "message.persist",
                "failure.close": "failure.close",
            },
        )
        .addEdge("tool.execute", "tool.result")
        .addConditionalEdges(
            "tool.result",
            routeAfterToolResult,
            {
                "tool.execute": "tool.execute",
                "message.persist": "message.persist",
                "failure.close": "failure.close",
            },
        )
        .addConditionalEdges(
            "message.persist",
            routeAfterMessagePersist,
            {
                "memory.commit": "memory.commit",
                "failure.close": "failure.close",
            },
        )
        .addEdge("memory.commit", "tool.plan")
        .addEdge("tool.plan", "usage.record")
        .addEdge("usage.record", END)
        .addEdge("failure.close", END);

    try {
        const app = workflow.compile({
            checkpointer,
        });

        await app.invoke(
            {
                sessionId: input.sent.sessionId,
                turnId: input.sent.turnId,
                taskId: input.sent.taskId,
                sent: input.sent,
                userText: input.userText,
                centerDirectory: input.centerDirectory,
                modelResult: null,
                finalModelResult: null,
                executedTool: null,
                toolResults: [],
                toolRound: 0,
                assistantText: null,
                assistantMessageId: null,
                incompleteToolIntent: false,
                failed: false,
                errorMessage: null,
            },
            {
                configurable: {
                    thread_id: input.sent.sessionId,
                    sessionId: input.sent.sessionId,
                    turnId: input.sent.turnId,
                },
            },
        );
    } finally {
        // SqliteSaver 当前版本没有公开 close 方法，但公开 db 字段；每轮执行后必须释放本地 checkpoint SQLite 文件，避免 Windows 测试清理中心目录时 EBUSY。
        checkpointer?.db.close();
    }

    void input.database;
    void input.events;
    void input.memoryQueues;
}

/**
 * mergeTurnState：合并节点返回的局部状态。
 *
 * @param state 当前完整状态。
 * @param patch 节点返回的局部状态。
 * @returns 合并后的状态。
 */
function mergeTurnState(
    state: LangGraphTurnState,
    patch: Partial<LangGraphTurnState>,
): LangGraphTurnState {
    return {
        ...state,
        ...patch,
    };
}

/**
 * routeAfterModelStream：模型节点后按 OpenAI tool_calls 决定是否进入工具循环。
 *
 * @param state 当前图状态。
 * @returns 下一节点路由。
 */
function routeAfterModelStream(state: LangGraphTurnState): TurnGraphRoute {
    if (state.failed) {
        return "failure.close";
    }
    return state.modelResult && state.modelResult.toolCalls.length > 0
        ? "tool.execute"
        : "message.persist";
}

/**
 * routeAfterToolResult：工具结果节点后按模型是否继续请求工具决定循环或固化。
 *
 * @param state 当前图状态。
 * @returns 下一节点路由。
 */
function routeAfterToolResult(state: LangGraphTurnState): TurnGraphRoute {
    if (state.failed) {
        return "failure.close";
    }
    return state.modelResult && state.modelResult.toolCalls.length > 0
        ? "tool.execute"
        : "message.persist";
}

/**
 * routeAfterMessagePersist：消息固化后按失败状态进入记忆或失败收尾。
 *
 * @param state 当前图状态。
 * @returns 下一节点路由。
 */
function routeAfterMessagePersist(state: LangGraphTurnState): TurnGraphRoute {
    if (state.failed || state.incompleteToolIntent) {
        return "failure.close";
    }
    return "memory.commit";
}
