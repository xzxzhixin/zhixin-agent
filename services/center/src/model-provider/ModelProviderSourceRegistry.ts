import type {
    ModelProviderCapabilityRecord,
    ModelProviderSource,
} from "../data-access/ModelProviderRepository.js";

/** ModelProviderSourceOption：供应商来源下拉展示项。 */
export interface ModelProviderSourceOption {
    /** providerSource: 数据库保存的模型来源枚举。 */
    providerSource: ModelProviderSource;
    /** label: UI 展示名称。 */
    label: string;
    /** description: 来源说明。 */
    description: string;
    /** defaultBaseUrl: 推荐 Base URL；官方 SDK 默认地址为空。 */
    defaultBaseUrl: string | null;
    /** defaultCapabilities: 该来源推荐的默认能力声明。 */
    defaultCapabilities: Omit<ModelProviderCapabilityRecord, "providerId" | "updatedAt">;
}

/** ModelProviderSourceDefinition：中心服务代码侧来源定义，不写入数据库。 */
export interface ModelProviderSourceDefinition extends ModelProviderSourceOption {
    /** requiresBaseUrl: 是否必须由用户配置 Base URL。 */
    requiresBaseUrl: boolean;
    /** requiresApiKey: 是否必须配置 API Key。 */
    requiresApiKey: boolean;
}

const STREAMING_TOOL_JSON_DEFAULT: Omit<ModelProviderCapabilityRecord, "providerId" | "updatedAt"> = {
    supportsVision: false,
    supportsToolCalling: true,
    supportsJsonOutput: true,
    supportsReasoningEffort: false,
    supportsModelList: true,
    supportsStreaming: true,
    providesCacheUsage: false,
};

const REASONING_DEFAULT: Omit<ModelProviderCapabilityRecord, "providerId" | "updatedAt"> = {
    supportsVision: false,
    supportsToolCalling: true,
    supportsJsonOutput: true,
    supportsReasoningEffort: true,
    supportsModelList: true,
    supportsStreaming: true,
    providesCacheUsage: true,
};

/**
 * ModelProviderSourceRegistry：模型来源注册表。
 *
 * 用途：集中维护 provider_source 的展示、默认地址和默认能力。
 * 关键逻辑：这里只保存代码映射，不把 AI SDK provider 包名、运行时实现名或历史协议字段写入数据库。
 */
export class ModelProviderSourceRegistry {
    /** definitions: 所有允许的供应商来源定义。 */
    private readonly definitions: ModelProviderSourceDefinition[];

    /**
     * constructor：初始化固定来源定义。
     */
    constructor() {
        this.definitions = [
            {
                providerSource: "openai",
                label: "OpenAI",
                description: "OpenAI 官方模型来源。",
                defaultBaseUrl: null,
                defaultCapabilities: REASONING_DEFAULT,
                requiresBaseUrl: false,
                requiresApiKey: true,
            },
            {
                providerSource: "anthropic",
                label: "Anthropic",
                description: "Anthropic Claude 官方模型来源。",
                defaultBaseUrl: null,
                defaultCapabilities: {
                    ...STREAMING_TOOL_JSON_DEFAULT,
                    supportsVision: true,
                },
                requiresBaseUrl: false,
                requiresApiKey: true,
            },
            {
                providerSource: "google",
                label: "Google",
                description: "Google Gemini 官方模型来源。",
                defaultBaseUrl: null,
                defaultCapabilities: {
                    ...STREAMING_TOOL_JSON_DEFAULT,
                    supportsVision: true,
                },
                requiresBaseUrl: false,
                requiresApiKey: true,
            },
            {
                providerSource: "deepseek",
                label: "DeepSeek",
                description: "DeepSeek OpenAI 兼容模型来源。",
                defaultBaseUrl: "https://api.deepseek.com",
                defaultCapabilities: STREAMING_TOOL_JSON_DEFAULT,
                requiresBaseUrl: false,
                requiresApiKey: true,
            },
            {
                providerSource: "qwen",
                label: "Qwen",
                description: "通义千问 OpenAI 兼容模型来源。",
                defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
                defaultCapabilities: STREAMING_TOOL_JSON_DEFAULT,
                requiresBaseUrl: false,
                requiresApiKey: true,
            },
            {
                providerSource: "openrouter",
                label: "OpenRouter",
                description: "OpenRouter 多模型聚合来源。",
                defaultBaseUrl: null,
                defaultCapabilities: STREAMING_TOOL_JSON_DEFAULT,
                requiresBaseUrl: false,
                requiresApiKey: true,
            },
            {
                providerSource: "codex",
                label: "Codex",
                description: "Codex 模型来源，后续由运行时适配具体调用方式。",
                defaultBaseUrl: null,
                defaultCapabilities: REASONING_DEFAULT,
                requiresBaseUrl: false,
                requiresApiKey: true,
            },
            {
                providerSource: "openai-compatible-custom",
                label: "OpenAI 兼容自定义",
                description: "用户自定义 OpenAI 兼容接口来源。",
                defaultBaseUrl: null,
                defaultCapabilities: STREAMING_TOOL_JSON_DEFAULT,
                requiresBaseUrl: true,
                requiresApiKey: true,
            },
        ];
    }

    /**
     * listSourceOptions：返回前端可展示的来源选项。
     *
     * @returns 来源选项数组。
     */
    listSourceOptions(): ModelProviderSourceOption[] {
        return this.definitions.map((definition) => {
            return {
                providerSource: definition.providerSource,
                label: definition.label,
                description: definition.description,
                defaultBaseUrl: definition.defaultBaseUrl,
                defaultCapabilities: definition.defaultCapabilities,
            };
        });
    }

    /**
     * getSourceDefinition：读取指定来源定义。
     *
     * @param providerSource 供应商来源枚举。
     * @returns 来源定义。
     */
    getSourceDefinition(providerSource: ModelProviderSource): ModelProviderSourceDefinition {
        const definition = this.definitions.find((item) => {
            return item.providerSource === providerSource;
        });

        if (!definition) {
            throw new Error(`不支持的模型来源：${providerSource}`);
        }

        return definition;
    }

    /**
     * isSupportedSource：判断来源是否允许保存。
     *
     * @param providerSource 外部传入来源字符串。
     * @returns 支持时返回 true。
     */
    isSupportedSource(providerSource: string): providerSource is ModelProviderSource {
        return this.definitions.some((definition) => {
            return definition.providerSource === providerSource;
        });
    }
}
