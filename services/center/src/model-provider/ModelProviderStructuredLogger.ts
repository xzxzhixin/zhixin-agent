import {CenterLogger} from "../logger.js";
import type {ProviderModelGatewayUsage} from "./ModelProviderRuntimeTypes.js";

/** ModelProviderStructuredLoggerInput：模型运行时结构化日志基础字段。 */
interface ModelProviderStructuredLoggerInput {
    /** centerDirectory: 中心目录。 */
    centerDirectory: string;
    /** sessionId: 会话 ID。 */
    sessionId: string;
    /** turnId: 轮次 ID。 */
    turnId: string;
    /** taskId: 任务 ID。 */
    taskId: string;
    /** providerId: 供应商 ID。 */
    providerId: string;
    /** modelProtocol: 模型协议。 */
    modelProtocol: string;
    /** modelName: 模型名。 */
    modelName: string;
    /** requestUrl: 请求地址摘要。 */
    requestUrl: string;
}

/**
 * ModelProviderStructuredLogger：LangChain 模型调用结构化日志。
 *
 * 用途：记录新供应商运行时的模型协议、工具调用、用量和错误摘要。
 */
export class ModelProviderStructuredLogger {
    /** base: 当前模型调用公共日志字段。 */
    private readonly base: ModelProviderStructuredLoggerInput;
    /** logger: 中心服务统一日志管线。 */
    private readonly logger: CenterLogger;

    /**
     * constructor：创建模型供应商日志器。
     *
     * @param input 公共日志字段。
     */
    public constructor(input: ModelProviderStructuredLoggerInput) {
        this.base = input;
        this.logger = new CenterLogger(input.centerDirectory);
    }

    /**
     * logCompleted：记录模型调用完成。
     *
     * @param payload 响应、工具调用和用量摘要。
     */
    public async logCompleted(payload: {
        /** providerResponseSummary: 供应商响应摘要。 */
        providerResponseSummary: unknown;
        /** rawToolCallSummary: 工具调用摘要。 */
        rawToolCallSummary: unknown;
        /** usage: 用量摘要。 */
        usage: ProviderModelGatewayUsage | null;
    }): Promise<void> {
        await this.logger.info(
            "LangChain 模型调用完成",
            {
                ...this.base,
                eventType: "model.provider.langchain.completed",
                status: "completed",
                ...payload,
            },
        );
    }

    /**
     * logFailed：记录模型调用失败。
     *
     * @param error 调用异常。
     */
    public async logFailed(error: unknown): Promise<void> {
        await this.logger.error(
            "LangChain 模型调用失败",
            {
                ...this.base,
                eventType: "model.provider.langchain.failed",
                status: "failed",
                errorKind: error instanceof Error ? error.name : typeof error,
                errorMessage: error instanceof Error ? error.message : String(error),
            },
        );
    }
}
