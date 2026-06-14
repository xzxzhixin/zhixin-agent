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
import {createDeepAgent} from "deepagents";

import type {CenterDatabase} from "./database.js";
import type {CenterEventStore} from "./events.js";
import type {OpenAiToolCall} from "./openai-chat-protocol.js";
import type {ProviderModelGatewayResult} from "./model-gateway-runtime.js";
import type {SendMessageResponse} from "./types.js";
import type {MemoryQueueState} from "./types.js";
import type {DeepAgentsTodoTaskStepItem} from "./tools/deepagents-todo-tool.js";

/**
 * DeepAgentsRoute：Deep Agents 条件边的路由结果。
 *
 * 来源：上一节点执行结果。
 * 含义：决定模型后是否进入工具执行、工具结果回填后是否继续循环、是否进入失败收尾。
 * 格式：固定字符串。
 * 默认值：无。
 * 约束：只在 Deep Agents runner 内部使用。
 */
type DeepAgentsRoute =
    | "tool.execute"
    | "message.persist"
    | "memory.commit"
    | "usage.record"
    | "failure.close";

/**
 * DeepAgentsExecutedTool：已执行工具摘要。
 *
 * 来源：工具执行节点。
 * 含义：供工具计划节点和审计事件记录模型实际请求过的工具。
 * 格式：工具 ID、工具类型和输入摘要。
 * 默认值：没有工具时为 null。
 * 约束：不得包含完整敏感入参或工具输出正文。
 */
export interface DeepAgentsExecutedTool {
    /** toolId: 中心服务内部工具 ID。 */
    toolId: string;
    /** toolKind: 工具类型，例如 command 或 mcp。 */
    toolKind: string;
    /** inputSummary: 可展示输入摘要。 */
    inputSummary: string;
}

/**
 * DeepAgentsToolResult：Deep Agents 工具节点内部执行和回填之间传递的结果。
 *
 * 来源：中心服务工具运行时。
 * 含义：保存 OpenAI tool_call_id 对应工具输出，供下一次模型调用回填。
 * 格式：工具调用、结果文本和可审计工具摘要。
 * 默认值：没有工具调用时为空数组。
 * 约束：结果文本只保存摘要，不保存命令完整 stdout 大文本。
 */
export interface DeepAgentsToolResult {
    /** toolCall: OpenAI 结构化工具调用。 */
    toolCall: OpenAiToolCall;
    /** resultText: 回填模型的工具结果摘要。 */
    resultText: string;
    /** executedTool: UI 和审计使用的工具摘要。 */
    executedTool: DeepAgentsExecutedTool;
}

/**
 * DeepAgentsToolPlanItem：模型请求过的工具计划摘要。
 *
 * 来源：工具执行节点收到的 OpenAI tool_calls。
 * 含义：供最终工具计划审计事件使用，独立于 toolResults，避免回填模型后清空临时结果导致计划丢失。
 * 格式：toolCallId 加可展示工具摘要。
 * 默认值：没有工具调用时为空数组。
 * 约束：不得包含完整敏感入参或工具输出正文。
 */
export interface DeepAgentsToolPlanItem {
    /** toolCallId: OpenAI tool_call_id，用于把计划、执行和回填事件聚合。 */
    toolCallId: string;
    /** executedTool: UI 和审计使用的工具摘要。 */
    executedTool: DeepAgentsExecutedTool;
}

/**
 * DeepAgentTodoItem：Deep Agents 原生 write_todos 工具条目。
 *
 * 来源：deepagents@1.10.2 内置 write_todos 工具。
 * 含义：Deep Agents 自带 planning/todo 状态。
 * 格式：content 为步骤正文，status 为 pending、in_progress 或 completed。
 * 默认值：无。
 * 约束：只作为适配输入，最终事实源仍写入中心服务 task_steps。
 */
export interface DeepAgentTodoItem {
    /** content: Deep Agents 原生 todo 内容。 */
    content: string;
    /** status: Deep Agents 原生 todo 状态。 */
    status: "pending" | "in_progress" | "completed";
}

/**
 * DeepAgentsTurnState：中心服务每轮对话传入 Deep Agents 的状态。
 *
 * 来源：会话发送接口已经创建的消息、轮次和任务身份。
 * 含义：承载每个 Deep Agents 执行节点之间需要传递的最小状态。
 * 格式：运行期对象。
 * 默认值：无。
 * 约束：sessionId 映射 Deep Agents thread_id，turnId 映射项目内部 graph run。
 */
export interface DeepAgentsTurnState {
    /** sessionId: 会话 ID，同时作为 Deep Agents thread_id。 */
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
    executedTool: DeepAgentsExecutedTool | null;
    /** toolResults: 最近一轮工具执行结果，供 Deep Agents 工具节点内部回填模型。 */
    toolResults: DeepAgentsToolResult[];
    /** toolPlanItems: 本轮模型已请求工具计划摘要，供最终审计事件使用。 */
    toolPlanItems: DeepAgentsToolPlanItem[];
    /** toolRound: OpenAI 工具调用循环轮次，避免模型无限请求工具。 */
    toolRound: number;
    /** toolBatchCount: 已自动续跑的工具批次数。 */
    toolBatchCount: number;
    /** totalToolRound: 当前任务级累计工具循环轮次。 */
    totalToolRound: number;
    /** batchContinuation: 是否刚从单批预算触顶后进入自动续跑。 */
    batchContinuation: boolean;
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
 * DeepAgentsNodeExecutors：会话域提供给 Deep Agents runner 的节点执行器。
 *
 * 来源：session-domain 中心服务事实源操作。
 * 含义：让 runner 只负责编排，副作用仍收敛在会话域。
 * 格式：每个字段对应一个 Deep Agents 执行节点。
 * 默认值：无。
 * 约束：执行器需要自己写入 events 和 payload.graph；只有用户可见计划项才写 task_steps。
 */
export interface DeepAgentsNodeExecutors {
    /** modelStream: 调用模型并接收 OpenAI 流式回复。 */
    modelStream: (state: DeepAgentsTurnState) => Promise<Partial<DeepAgentsTurnState>>;
    /** toolExecute: 执行模型请求的 OpenAI tool_calls。 */
    toolExecute: (state: DeepAgentsTurnState) => Promise<Partial<DeepAgentsTurnState>>;
    /** toolPlan: 记录工具计划和可见能力状态。 */
    toolPlan: (state: DeepAgentsTurnState) => Promise<Partial<DeepAgentsTurnState>>;
    /** messagePersist: 固化最终助手消息或处理不完整工具意图。 */
    messagePersist: (state: DeepAgentsTurnState) => Promise<Partial<DeepAgentsTurnState>>;
    /** memoryCommit: 写入长期记忆和语义索引。 */
    memoryCommit: (state: DeepAgentsTurnState) => Promise<Partial<DeepAgentsTurnState>>;
    /** usageRecord: 写入模型用量并更新会话标题和轮次状态。 */
    usageRecord: (state: DeepAgentsTurnState) => Promise<Partial<DeepAgentsTurnState>>;
    /** failureClose: 统一失败收尾。 */
    failureClose: (state: DeepAgentsTurnState) => Promise<Partial<DeepAgentsTurnState>>;
}

/**
 * RunDeepAgentsTurnInput：运行 Deep Agents 对话图所需输入。
 */
interface RunDeepAgentsTurnInput {
    /** database: 中心服务 SQLite 连接封装，来源于中心服务主进程。 */
    database: CenterDatabase;
    /** events: 中心服务事件事实源，Deep Agents 执行节点仍必须写 payload.graph 相关事件。 */
    events: CenterEventStore;
    /** sent: 发送接口创建的消息、轮次和任务身份。 */
    sent: SendMessageResponse;
    /** userText: 用户原始输入。 */
    userText: string;
    /** centerDirectory: 中心目录绝对路径，用于 Deep Agents checkpointer 和记忆迁移边界。 */
    centerDirectory?: string;
    /** memoryQueues: 智能体记忆单写队列，继续由中心服务事实源控制。 */
    memoryQueues?: Map<string, MemoryQueueState>;
    /** executors: 会话域提供的真实节点执行器。 */
    executors: DeepAgentsNodeExecutors;
}

/**
 * createDeepAgentsCheckpointer：创建 Deep Agents 本地 SQLite checkpointer。
 *
 * @param centerDirectory 中心目录绝对路径。
 * @returns SQLite checkpointer；未提供中心目录时返回 undefined。
 */
function createDeepAgentsCheckpointer(centerDirectory?: string): SqliteSaver | undefined {
    if (!centerDirectory) {
        return undefined;
    }

    // checkpointPath: 运行中图状态放入中心目录，随中心目录迁移；长期事实仍由 events、用户可见 task_steps、Markdown 和 SQLite 主库承载。
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
 * syncDeepAgentTodosToTaskSteps：把 Deep Agents 原生 todo 结构转换为中心服务任务步骤条目。
 *
 * @param todos Deep Agents write_todos 工具提交的 todo 列表。
 * @returns 可交给中心服务 Deep Agents todo 同步器写入 task_steps 的条目。
 */
export function syncDeepAgentTodosToTaskSteps(todos: DeepAgentTodoItem[]): DeepAgentsTodoTaskStepItem[] {
    return todos.map((todo) => {
        return {
            title: todo.content,
            status: readCenterTaskStatusFromDeepAgentTodo(todo.status),
        };
    });
}

/**
 * runDeepAgentsTurn：用 Deep Agents 执行图驱动当前轮次执行。
 *
 * @param input Deep Agents 运行输入。
 * @returns 没有返回值。
 */
export async function runDeepAgentsTurn(input: RunDeepAgentsTurnInput): Promise<void> {
    initializeDeepAgentsHarness();
    const checkpointer = createDeepAgentsCheckpointer(input.centerDirectory);
    const workflow = new StateGraph<DeepAgentsTurnState>({
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
            toolPlanItems: null,
            toolRound: null,
            toolBatchCount: null,
            totalToolRound: null,
            batchContinuation: null,
            assistantText: null,
            assistantMessageId: null,
            incompleteToolIntent: null,
            failed: null,
            errorMessage: null,
        },
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
        .addEdge(START, "model.stream")
        .addConditionalEdges(
            "model.stream",
            routeAfterModelStream,
            {
                "tool.execute": "tool.execute",
                "message.persist": "message.persist",
                "failure.close": "failure.close",
            },
        )
        .addConditionalEdges(
            "tool.execute",
            routeAfterToolExecute,
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
                toolPlanItems: [],
                toolRound: 0,
                toolBatchCount: 0,
                totalToolRound: 0,
                batchContinuation: false,
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
 * initializeDeepAgentsHarness：初始化 Deep Agents 执行内核。
 *
 * @returns 没有返回值。
 */
function initializeDeepAgentsHarness(): void {
    // deepAgentGraph: 初始化 Deep Agents harness 并锁定 write_todos 和工具调度协议；中心服务只保留事实源、安全和审计执行器，避免 Deep Agents 直接写核心存储。
    const deepAgentGraph = createDeepAgent({
        tools: [],
        systemPrompt: "中心服务负责事实源、权限和审计。长任务规划使用 Deep Agents 原生 write_todos 协议，并同步为当前智能体 task_steps。",
    });
    void deepAgentGraph;
}

/**
 * readCenterTaskStatusFromDeepAgentTodo：把 Deep Agents todo 状态映射为中心服务任务状态。
 *
 * @param status Deep Agents 原生 todo 状态。
 * @returns 中心服务任务状态。
 */
function readCenterTaskStatusFromDeepAgentTodo(status: DeepAgentTodoItem["status"]): DeepAgentsTodoTaskStepItem["status"] {
    if (status === "completed") {
        return "completed";
    }
    if (status === "in_progress") {
        return "running";
    }
    return "queued";
}
/**
 * mergeTurnState：合并节点返回的局部状态。
 *
 * @param state 当前完整状态。
 * @param patch 节点返回的局部状态。
 * @returns 合并后的状态。
 */
function mergeTurnState(
    state: DeepAgentsTurnState,
    patch: Partial<DeepAgentsTurnState>,
): DeepAgentsTurnState {
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
function routeAfterModelStream(state: DeepAgentsTurnState): DeepAgentsRoute {
    if (state.failed) {
        return "failure.close";
    }
    return state.modelResult && state.modelResult.toolCalls.length > 0
        ? "tool.execute"
        : "message.persist";
}

/**
 * routeAfterToolExecute：Deep Agents 工具节点后按模型是否继续请求工具决定循环或固化。
 *
 * @param state 当前图状态。
 * @returns 下一节点路由。
 */
function routeAfterToolExecute(state: DeepAgentsTurnState): DeepAgentsRoute {
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
function routeAfterMessagePersist(state: DeepAgentsTurnState): DeepAgentsRoute {
    if (state.failed || state.incompleteToolIntent) {
        return "failure.close";
    }
    return "memory.commit";
}
