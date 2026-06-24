import type {
    ModelProviderCapabilityRecord,
    ModelProtocol,
} from "../data-access/ModelProviderRepository.js";

/** ModelProtocolOption：模型协议下拉展示项。 */
export interface ModelProtocolOption {
    /** modelProtocol: 数据库保存的内部模型协议枚举。 */
    modelProtocol: ModelProtocol;
    /** label: UI 展示名称。 */
    label: string;
    /** description: 协议说明。 */
    description: string;
    /** defaultBaseUrl: 推荐 Base URL；官方 SDK 默认地址为空，自定义兼容服务由用户填写。 */
    defaultBaseUrl: string | null;
    /** defaultCapabilities: 该协议推荐的默认能力声明。 */
    defaultCapabilities: Omit<ModelProviderCapabilityRecord, "providerId" | "updatedAt">;
}

/** ModelProtocolDefinition：中心服务代码侧协议定义，不写入数据库。 */
export interface ModelProtocolDefinition extends ModelProtocolOption {
    /** requiresBaseUrl: 是否必须由用户配置 Base URL。 */
    requiresBaseUrl: boolean;
    /** requiresApiKey: 是否必须配置 API Key。 */
    requiresApiKey: boolean;
}

const OPENAI_PROTOCOL_CAPABILITIES: Omit<ModelProviderCapabilityRecord, "providerId" | "updatedAt"> = {
    supportsVision: false,
    supportsToolCalling: true,
    supportsJsonOutput: true,
    supportsReasoningEffort: true,
    supportsModelList: true,
    supportsStreaming: true,
    providesCacheUsage: true,
    responsesSupported: false,
    chatCompletionsSupported: false,
    responsesStreamSupported: false,
    chatCompletionsStreamSupported: false,
    streamToolCallsSupported: false,
    selectedRuntimeMode: null,
    lastTestStatus: null,
    lastTestMessage: null,
    lastTestedAt: null,
};

const ANTHROPIC_PROTOCOL_CAPABILITIES: Omit<ModelProviderCapabilityRecord, "providerId" | "updatedAt"> = {
    supportsVision: true,
    supportsToolCalling: true,
    supportsJsonOutput: true,
    supportsReasoningEffort: false,
    supportsModelList: true,
    supportsStreaming: true,
    providesCacheUsage: false,
    responsesSupported: false,
    chatCompletionsSupported: false,
    responsesStreamSupported: false,
    chatCompletionsStreamSupported: false,
    streamToolCallsSupported: false,
    selectedRuntimeMode: null,
    lastTestStatus: null,
    lastTestMessage: null,
    lastTestedAt: null,
};

/**
 * ModelProtocolRegistry：模型协议注册表。
 *
 * 用途：集中维护 model_protocol 的展示、默认地址和默认能力。
 * 关键逻辑：这里只保存内部协议映射，不保存厂商来源、第三方 provider 包名或 wire API 选择。
 */
export class ModelProtocolRegistry {
    /** definitions: 所有允许的模型协议定义。 */
    private readonly definitions: ModelProtocolDefinition[];

    /**
     * constructor：初始化固定协议定义。
     */
    public constructor() {
        this.definitions = [
            {
                modelProtocol: "openai",
                label: "OpenAI",
                description: "OpenAI 协议，兼容 Chat Completions 与内部 Responses-like 事件模型。",
                defaultBaseUrl: null,
                defaultCapabilities: OPENAI_PROTOCOL_CAPABILITIES,
                requiresBaseUrl: false,
                requiresApiKey: true,
            },
            {
                modelProtocol: "anthropic",
                label: "Anthropic",
                description: "Anthropic Messages 协议，直接使用 LangChain Anthropic 模型。",
                defaultBaseUrl: null,
                defaultCapabilities: ANTHROPIC_PROTOCOL_CAPABILITIES,
                requiresBaseUrl: false,
                requiresApiKey: true,
            },
        ];
    }

    /**
     * listProtocolOptions：返回前端可展示的协议选项。
     *
     * @returns 协议选项数组。
     */
    public listProtocolOptions(): ModelProtocolOption[] {
        return this.definitions.map((definition) => {
            return {
                modelProtocol: definition.modelProtocol,
                label: definition.label,
                description: definition.description,
                defaultBaseUrl: definition.defaultBaseUrl,
                defaultCapabilities: definition.defaultCapabilities,
            };
        });
    }

    /**
     * getProtocolDefinition：读取指定协议定义。
     *
     * @param modelProtocol 模型协议枚举。
     * @returns 协议定义。
     */
    public getProtocolDefinition(modelProtocol: ModelProtocol): ModelProtocolDefinition {
        const definition = this.definitions.find((item) => {
            return item.modelProtocol === modelProtocol;
        });

        if (!definition) {
            throw new Error(`不支持的模型协议：${modelProtocol}`);
        }

        return definition;
    }

    /**
     * isSupportedProtocol：判断协议是否允许保存。
     *
     * @param modelProtocol 外部传入协议字符串。
     * @returns 支持时返回 true。
     */
    public isSupportedProtocol(modelProtocol: string): modelProtocol is ModelProtocol {
        return this.definitions.some((definition) => {
            return definition.modelProtocol === modelProtocol;
        });
    }
}

