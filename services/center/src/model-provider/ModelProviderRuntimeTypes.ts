import type {OpenAiToolCall} from "../openai-chat-protocol.js";
import type {
    ModelProviderRuntimeRecord,
    ModelProviderSource,
} from "../data-access/ModelProviderRepository.js";

/** ProviderModelGatewayUsage：模型调用用量归一化结构。 */
export interface ProviderModelGatewayUsage {
    /** inputTokens: 输入 token 数；供应商未返回时为 null。 */
    inputTokens: number | null;
    /** outputTokens: 输出 token 数；供应商未返回时为 null。 */
    outputTokens: number | null;
    /** totalTokens: 总 token 数；供应商未返回时为 null。 */
    totalTokens: number | null;
    /** cacheHitTokens: 缓存命中 token 数；供应商未返回时为 null。 */
    cacheHitTokens: number | null;
    /** cacheMissTokens: 缓存未命中 token 数；供应商未返回时为 null。 */
    cacheMissTokens: number | null;
    /** rawUsage: AI SDK 或供应商原始用量对象。 */
    rawUsage: unknown;
}

/** ProviderModelGatewayResult：中心服务模型调用结果，供监督层、用量统计和日志使用。 */
export interface ProviderModelGatewayResult {
    /** providerId: 供应商 ID。 */
    providerId: string;
    /** providerSource: 模型来源。 */
    providerSource: ModelProviderSource;
    /** model: 实际请求模型。 */
    model: string;
    /** reasoningEffort: 推理深度。 */
    reasoningEffort: string | null;
    /** assistantText: 助手文本。 */
    assistantText: string;
    /** usage: 用量；供应商未提供时为 null。 */
    usage: ProviderModelGatewayUsage | null;
    /** toolCall: 模型请求的首个工具调用；没有工具请求时为 null。 */
    toolCall: OpenAiToolCall | null;
    /** toolCalls: 模型请求的全部工具调用；没有工具请求时为空数组。 */
    toolCalls: OpenAiToolCall[];
}

/** ResolvedModelProviderRuntime：当前轮次模型运行时配置。 */
export interface ResolvedModelProviderRuntime {
    /** provider: 已启用的新数据库供应商配置。 */
    provider: ModelProviderRuntimeRecord;
    /** centerDirectory: 中心目录绝对路径。 */
    centerDirectory: string;
    /** modelSelection: 当前模型和推理深度选择。 */
    modelSelection: {
        /** model: 实际模型名。 */
        model: string;
        /** reasoningEffort: 推理深度。 */
        reasoningEffort: string | null;
    };
    /** apiKey: 本次调用使用的 API Key，不能进入 API 响应或普通事件。 */
    apiKey: string;
    /** requestUrl: 日志用请求地址摘要。 */
    requestUrl: string;
}
