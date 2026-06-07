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
import type {SendMessageResponse} from "./types.js";
import type {MemoryQueueState} from "./types.js";

/**
 * LangGraphTurnState：中心服务每轮对话传入 LangGraphJS 的状态。
 *
 * 来源：会话发送接口已经创建的消息、轮次和任务身份。
 * 含义：把项目内部 sessionId、turnId 和中心目录传入 LangGraph 节点。
 * 格式：运行期对象。
 * 默认值：无。
 * 约束：sessionId 映射 LangGraph configurable.thread_id，turnId 映射项目内部 graph run。
 */
interface LangGraphTurnState {
    /**
     * sessionId: 会话 ID，同时作为 LangGraph thread_id。
     */
    sessionId: string;

    /**
     * turnId: 当前轮次 ID，同时作为项目内部 graphRunId。
     */
    turnId: string;

    /**
     * taskId: 当前轮次默认任务 ID。
     */
    taskId: string;

    /**
     * sent: 发送接口创建的身份集合，供现有执行闭环复用。
     */
    sent: SendMessageResponse;

    /**
     * userText: 用户原始输入文本。
     */
    userText: string;

    /**
     * centerDirectory: 中心目录绝对路径；为空时跳过长期记忆提交。
     */
    centerDirectory?: string;

    /**
     * completed: LangGraph 节点是否已调用 completeCreatedTurn 回调。
     */
    completed: boolean;
}

/**
 * CompleteCreatedTurnExecutor：LangGraph 节点调用的现有轮次执行主体。
 *
 * @param sent 发送接口创建的身份集合。
 * @param userText 用户原始输入。
 * @returns 执行完成后没有返回值。
 */
type CompleteCreatedTurnExecutor = (
    sent: SendMessageResponse,
    userText: string,
) => Promise<void>;

/**
 * RunLangGraphTurnInput：运行 LangGraphJS 对话图所需输入。
 */
interface RunLangGraphTurnInput {
    /**
     * database: 中心服务 SQLite 连接封装，来源于中心服务主进程。
     */
    database: CenterDatabase;

    /**
     * events: 中心服务事件事实源，LangGraph 节点仍必须写 payload.graph 相关事件。
     */
    events: CenterEventStore;

    /**
     * sent: 发送接口创建的消息、轮次和任务身份。
     */
    sent: SendMessageResponse;

    /**
     * userText: 用户原始输入。
     */
    userText: string;

    /**
     * centerDirectory: 中心目录绝对路径，用于 LangGraph checkpointer 和记忆迁移边界。
     */
    centerDirectory?: string;

    /**
     * memoryQueues: 智能体记忆单写队列，继续由中心服务事实源控制。
     */
    memoryQueues?: Map<string, MemoryQueueState>;

    /**
     * completeCreatedTurn: 现有执行主体回调，避免 runner 反向导入 session-domain 形成循环依赖。
     */
    completeCreatedTurn: CompleteCreatedTurnExecutor;
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
 * runLangGraphTurn：用 LangGraphJS 驱动当前轮次执行。
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
            completed: null,
        },
    })
        .addNode("completeCreatedTurn", async (state) => {
            // payload.graph: 真实 UI 和迁移事实仍由现有执行主体在节点边界写入，LangGraph checkpoint 只负责运行态恢复。
            await input.completeCreatedTurn(
                state.sent,
                state.userText,
            );

            return {
                ...state,
                completed: true,
            };
        })
        .addEdge(START, "completeCreatedTurn")
        .addEdge("completeCreatedTurn", END);

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
                completed: false,
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
