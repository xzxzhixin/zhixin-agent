import type {
    AgentConfigView,
    ConversationTokenUsageView,
    McpConfigView,
    ModelProtocolOption,
    PluginConfigView,
    ProviderConfigView,
    ProviderModelListView,
    ProxyConfigView,
    RuntimeConfigView,
    SaveModelProviderModelsPayload,
    UsageFilters,
} from "@zhixin/api-client";
import {
    isRecord,
} from "@zhixin/shared";

import {
    buildProviderModelRefreshDraft,
    createMcpDraft,
    createProviderDraft,
    createProxyDraft,
    createRuntimeDraft,
    createSkillDraft,
    findInvalidModelContextWindowLine,
    formatModelContextWindowsForDraft,
    formatJsonText,
    normalizeOptionalText,
    parseJsonObject,
    parseEnvironmentVariables,
    readPluginConfig,
    sortProviderModelsByNumericVersion,
} from "./app-helpers";
import type {
    ProviderDraft,
    ProxyDraft,
    RuntimeDraft,
} from "./app-types";

/**
 * sortModelContextWindowsByModels：按模型排序结果重排上下文窗口配置。
 *
 * @param models 已排序模型名称数组。
 * @param contextWindows 中心服务返回的模型窗口配置。
 * @returns 与模型顺序一致的窗口配置数组。
 */
function sortModelContextWindowsByModels(
    models: string[],
    contextWindows: Array<{
        model: string;
        contextWindowTokens: number;
    }>,
): Array<{
    model: string;
    contextWindowTokens: number;
}> {
    // contextWindowByModel: 窗口配置只按明确 model 字段匹配，不猜测别名或候选字段。
    const contextWindowByModel = new Map(contextWindows.map((item) => {
        return [
            item.model,
            item,
        ];
    }));
    return models.map((model) => {
        return contextWindowByModel.get(model);
    }).filter((item): item is {
        model: string;
        contextWindowTokens: number;
    } => {
        return item !== undefined;
    });
}

/**
 * normalizeProviderModelOptionsSnapshot：整理对话页启动快照中的供应商模型列表。
 *
 * @param snapshot 中心服务按供应商 ID 返回的模型列表快照。
 * @returns 排序和上下文窗口同步后的模型列表映射。
 */
function normalizeProviderModelOptionsSnapshot(
    snapshot: Record<string, ProviderModelListView | ProviderConfigView["models"]>,
): Record<string, ProviderModelListView> {
    return Object.fromEntries(Object.entries(snapshot).map(([
        providerId,
        modelList,
    ]) => {
        if (Array.isArray(modelList)) {
            const models = modelList.map((model) => {
                return model.modelName;
            });
            const contextWindows = modelList.filter((model) => {
                return typeof model.contextWindowTokens === "number";
            }).map((model) => {
                return {
                    model: model.modelName,
                    contextWindowTokens: model.contextWindowTokens as number,
                };
            });
            const sortedModels = sortProviderModelsByNumericVersion(models);
            return [
                providerId,
                {
                    providerId,
                    models: sortedModels,
                    // reasoningEfforts: 旧 WebSocket 快照只返回模型行数组，无法携带候选值；调用处会保留当前非空候选。
                    reasoningEfforts: [],
                    contextWindows: sortModelContextWindowsByModels(
                        sortedModels,
                        contextWindows,
                    ),
                    updatedAt: modelList[0]?.updatedAt ?? null,
                },
            ];
        }
        // models/contextWindows/reasoningEfforts: 旧数据或刚创建的供应商可能还没有模型快照字段，前端管理页按空列表展示。
        const models = Array.isArray(modelList.models)
            ? modelList.models
            : [];
        const contextWindows = Array.isArray(modelList.contextWindows)
            ? modelList.contextWindows
            : [];
        const reasoningEfforts = Array.isArray(modelList.reasoningEfforts)
            ? modelList.reasoningEfforts
            : [];
        const sortedModels = sortProviderModelsByNumericVersion(models);
        return [
            providerId,
            {
                ...modelList,
                models: sortedModels,
                reasoningEfforts,
                contextWindows: sortModelContextWindowsByModels(
                    sortedModels,
                    contextWindows,
                ),
            },
        ];
    }));
}

/**
 * createManagementActions：创建管理页相关 Pinia actions。
 *
 * 用途：把供应商、代理、运行环境、插件、MCP、skill 和用量管理动作从主 store 拆出，避免单文件膨胀。
 * @returns 可被 Pinia actions 展开的管理动作集合。
 */
export function createManagementActions() {
    return {
        /**
         * providerModelDraftHasError：检查当前供应商模型手填草稿是否存在格式错误。
         *
         * @returns 存在非法模型窗口行时返回 true。
         */
        providerModelDraftHasError(): boolean {
            const invalidLine = findInvalidModelContextWindowLine(this.providerDraft.manualModelContextText);
            if (!invalidLine) {
                return false;
            }
            this.managementErrors.providers = "手填模型必须使用“模型名=上下文长度K”，例如 gpt-4o=128K。";
            this.lastError = this.managementErrors.providers;
            return true;
        },

        /**
         * providerCustomHeadersDraftHasError：检查自定义请求头是否为 JSON 对象。
         *
         * @returns 自定义请求头不是 JSON 对象时返回 true。
         */
        providerCustomHeadersDraftHasError(): boolean {
            try {
                // customHeadersText: 新模型协议接口只接受 JSON 对象字符串，空对象是明确默认值。
                parseJsonObject(this.providerDraft.customHeadersText);
                return false;
            } catch (error) {
                this.managementErrors.providers = "自定义请求头必须是 JSON 对象。";
                this.lastError = this.managementErrors.providers;
                return true;
            }
        },

        /**
         * loadUsageRecords：加载用量原始记录。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadUsageRecords(): Promise<void> {
            try {
                const result = await this.api().queryUsageRecords(this.normalizedUsageFilters());
                this.usageRecords = result.records;
                this.clearManagementError("usage");
            } catch (error) {
                this.recordManagementError("usage", error);
            }
        },

        /**
         * loadUsageAggregate：加载用量聚合统计。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadUsageAggregate(): Promise<void> {
            try {
                const result = await this.api().loadUsageAggregate(this.normalizedUsageFilters());
                this.usageAggregate = result.stats;
                this.usageDailyStats = result.refreshedDailyStats;
                this.clearManagementError("usage");
            } catch (error) {
                this.recordManagementError("usage", error);
            }
        },

        /**
         * loadUsageStatistics：同时加载原始和聚合用量。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadUsageStatistics(): Promise<void> {
            await Promise.all([
                this.loadUsageRecords(),
                this.loadUsageAggregate(),
            ]);
        },

        /**
         * normalizedUsageFilters：把空字符串筛选转为接口需要的 null。
         *
         * @returns 用量筛选条件。
         */
        normalizedUsageFilters(): UsageFilters {
            return {
                providerId: normalizeOptionalText(this.usageFilters.providerId),
                providerName: normalizeOptionalText(this.usageFilters.providerName),
                model: normalizeOptionalText(this.usageFilters.model),
                modelName: normalizeOptionalText(this.usageFilters.modelName),
                projectId: normalizeOptionalText(this.usageFilters.projectId),
                projectName: normalizeOptionalText(this.usageFilters.projectName),
                sessionId: normalizeOptionalText(this.usageFilters.sessionId),
                startedAt: normalizeOptionalText(this.usageFilters.startedAt),
                endedAt: normalizeOptionalText(this.usageFilters.endedAt),
            };
        },

        /**
         * loadProviders：加载供应商列表。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadProviders(): Promise<void> {
            try {
                const [
                    providerResult,
                    protocolResult,
                    agentSnapshot,
                ] = await Promise.all([
                    this.api().listProviders(),
                    this.api().listModelProtocolOptions(),
                    this.requireRealtimeRequest<{
                        /** agents: 主智能体和长期智能体索引。 */
                        agents: AgentConfigView[];
                        /** providerModelOptions: 每个供应商已保存的模型列表。 */
                        providerModelOptions: Record<string, ProviderModelListView>;
                    }>("chat.bootstrap.snapshot", {}),
                ]);
                this.providers = providerResult.providers;
                this.modelProtocolOptions = protocolResult.modelProtocolOptions;
                this.syncProviderDraftWithProtocolOptions(protocolResult.modelProtocolOptions);
                this.providerModelOptions = normalizeProviderModelOptionsSnapshot(agentSnapshot.providerModelOptions);
                this.agents = agentSnapshot.agents;
                this.applyDefaultComposerModelSettings();
                this.clearManagementError("providers");
                this.clearManagementError("agents");
            } catch (error) {
                this.recordManagementError("providers", error);
            }
        },

        /**
         * syncProviderDraftWithProtocolOptions：根据模型协议列表修正供应商草稿。
         *
         * @param protocolOptions 中心服务返回的模型协议选项。
         * @returns 没有返回值。
         */
        syncProviderDraftWithProtocolOptions(protocolOptions: ModelProtocolOption[]): void {
            // currentProtocol: 草稿只能保存中心服务声明的模型协议，避免前端热状态保留旧协议值。
            const currentProtocol = protocolOptions.find((option) => {
                return option.modelProtocol === this.providerDraft.modelProtocol;
            }) ?? protocolOptions[0];
            if (!currentProtocol) {
                return;
            }
            this.providerDraft.modelProtocol = currentProtocol.modelProtocol;
            this.providerDraft.capabilities = {
                ...currentProtocol.defaultCapabilities,
                ...this.providerDraft.capabilities,
            };
        },

        /**
         * selectModelProtocol：用户切换模型协议时同步默认能力和默认接口地址。
         *
         * @param modelProtocol 模型协议稳定值。
         * @returns 没有返回值。
         */
        selectModelProtocol(modelProtocol: string): void {
            const selectedProtocol = this.modelProtocolOptions.find((option) => {
                return option.modelProtocol === modelProtocol;
            });
            if (!selectedProtocol) {
                return;
            }
            this.providerDraft.modelProtocol = selectedProtocol.modelProtocol;
            this.providerDraft.capabilities = {
                ...selectedProtocol.defaultCapabilities,
            };
            if (this.providerDraft.apiBaseUrl.trim().length === 0 && selectedProtocol.defaultBaseUrl) {
                // apiBaseUrl: 只在用户尚未填写时使用协议默认地址，避免切换协议覆盖用户已输入地址。
                this.providerDraft.apiBaseUrl = selectedProtocol.defaultBaseUrl;
            }
        },

        /**
         * loadProviderModelOptions：加载单个供应商已保存模型列表。
         *
         * @param providerId 供应商 ID。
         * @returns 加载完成后没有返回值。
         */
        async loadProviderModelOptions(providerId: string): Promise<void> {
            try {
                const snapshot = await this.requireRealtimeRequest<{
                    /** providerModelOptions: 每个供应商已保存的模型列表。 */
                    providerModelOptions: Record<string, ProviderModelListView>;
                }>("chat.bootstrap.snapshot", {});
                const nextOptions = normalizeProviderModelOptionsSnapshot(snapshot.providerModelOptions);
                if (nextOptions[providerId]) {
                    const currentOptions = this.providerModelOptions[providerId];
                    const nextProviderOptions = nextOptions[providerId];
                    this.providerModelOptions[providerId] = {
                        ...nextProviderOptions,
                        // reasoningEfforts: 旧快照没有候选时保留编辑入口从供应商详情解析出的候选，避免下拉被空数组覆盖。
                        reasoningEfforts: nextProviderOptions.reasoningEfforts.length > 0
                            ? nextProviderOptions.reasoningEfforts
                            : currentOptions?.reasoningEfforts ?? [],
                    };
                }
            } catch (error) {
                // 模型列表失败不阻断供应商主列表，页面会显示手动填写兜底说明。
                console.error("供应商模型列表加载失败", {
                    providerId,
                    error,
                });
            }
        },

        /**
         * editProvider：把供应商列表项填入表单。
         *
         * @param provider 供应商列表项。
         * @returns 没有返回值。
         */
        editProvider(provider: ProviderConfigView): void {
            this.providerDraft = {
                providerId: provider.providerId,
                providerName: provider.providerName,
                modelProtocol: provider.modelProtocol,
                apiBaseUrl: provider.apiBaseUrl ?? "",
                apiKey: "",
                customHeadersText: provider.customHeadersJson,
                defaultModelName: provider.settings.defaultModelName ?? "",
                enabled: provider.enabled,
                capabilities: {
                    ...provider.capabilities,
                },
                proxyPolicy: {
                    mode: provider.proxyMode,
                    proxyId: provider.proxyId,
                },
                manualModelsText: provider.settings.defaultModelName ?? "",
                manualModelContextText: formatModelContextWindowsForDraft(this.providerModelOptions[provider.providerId]?.contextWindows ?? []),
                reasoningEffortText: provider.settings.reasoningEffort ?? "",
            };
            void this.loadProviderModelOptions(provider.providerId);
        },

        /**
         * fetchProviderModels：从供应商上游获取模型列表并同步当前弹框。
         *
         * @returns 获取完成后没有返回值。
         */
        async fetchProviderModels(): Promise<void> {
            try {
                const providerId = this.providerDraft.providerId;
                if (!providerId) {
                    this.managementErrors.providers = "新增供应商请先保存后再获取模型列表。";
                    this.lastError = this.managementErrors.providers;
                    return;
                }
                const result = await this.api().fetchProviderModels({
                    providerId,
                });
                const sortedModels = sortProviderModelsByNumericVersion(result.models);
                const sortedContextWindows = sortModelContextWindowsByModels(
                    sortedModels,
                    result.contextWindows,
                );
                this.providerModelOptions[providerId] = {
                    ...result,
                    models: sortedModels,
                    contextWindows: sortedContextWindows,
                };
                this.providerDraft.manualModelsText = sortedModels.join("\n");
                this.providerDraft.manualModelContextText = formatModelContextWindowsForDraft(sortedContextWindows);
                if (result.reasoningEfforts.length > 0 && !this.providerDraft.reasoningEffortText) {
                    // 默认推理深度：获取结果只在当前没有单值时选第一个候选，避免把候选列表整体写入调用参数。
                    this.providerDraft.reasoningEffortText = result.reasoningEfforts[0];
                }
                if (sortedModels.length > 0) {
                    // 默认模型：用户确认获取后使用数字版本排序后的第一项，例如 gpt-5.5 优先于 gpt-5.4。
                    this.providerDraft.defaultModelName = sortedModels[0];
                }
                this.clearManagementError("providers");
                await this.loadProviders();
            } catch (error) {
                this.recordManagementError("providers", error);
            }
        },

        /**
         * resetProviderDraft：重置供应商表单。
         *
         * @returns 没有返回值。
         */
        resetProviderDraft(): void {
            this.providerDraft = createProviderDraft();
        },

        /**
         * saveProvider：新增或修改供应商。
         *
         * @returns 保存完成后没有返回值。
         */
        async saveProvider(): Promise<void> {
            try {
                if (this.providerModelDraftHasError()) {
                    return;
                }
                if (this.providerCustomHeadersDraftHasError()) {
                    return;
                }
                if (this.providerDraft.providerId) {
                    const editingProvider = this.providers.find((provider) => {
                        return provider.providerId === this.providerDraft.providerId;
                    });
                    await this.api().updateModelProvider({
                        providerId: this.providerDraft.providerId,
                        providerName: this.providerDraft.providerName,
                        modelProtocol: this.providerDraft.modelProtocol,
                        apiBaseUrl: this.providerDraft.apiBaseUrl,
                        apiKey: this.providerDraft.apiKey,
                        customHeadersJson: this.providerDraft.customHeadersText,
                        proxyMode: this.providerDraft.proxyPolicy.mode,
                        proxyId: this.providerDraft.proxyPolicy.proxyId,
                        defaultModelName: this.providerDraft.defaultModelName,
                        reasoningEffort: this.providerDraft.reasoningEffortText,
                        capabilities: this.providerDraft.capabilities,
                        enabled: this.providerDraft.enabled,
                    });
                    if (editingProvider) {
                        await this.saveProviderDraftModels(editingProvider);
                    }
                } else {
                    const result = await this.api().createModelProvider({
                        providerName: this.providerDraft.providerName,
                        modelProtocol: this.providerDraft.modelProtocol,
                        apiBaseUrl: this.providerDraft.apiBaseUrl,
                        apiKey: this.providerDraft.apiKey,
                        customHeadersJson: this.providerDraft.customHeadersText,
                        proxyMode: this.providerDraft.proxyPolicy.mode,
                        proxyId: this.providerDraft.proxyPolicy.proxyId,
                        defaultModelName: this.providerDraft.defaultModelName,
                        reasoningEffort: this.providerDraft.reasoningEffortText,
                        enabled: this.providerDraft.enabled,
                        capabilities: this.providerDraft.capabilities,
                    });
                    await this.saveProviderDraftModels(result.provider);
                }
                this.providerDraft.apiKey = "";
                this.clearManagementError("providers");
                await this.loadProviders();
            } catch (error) {
                this.recordManagementError("providers", error);
            }
        },

        /**
         * saveProviderDraftModels：保存当前编辑弹框中的模型列表与上下文窗口。
         *
         * @param provider 当前编辑的供应商行。
         * @returns 保存完成后没有返回值。
         */
        async saveProviderDraftModels(provider: ProviderConfigView): Promise<void> {
            const refreshDraft = buildProviderModelRefreshDraft(
                provider,
                this.providerModelOptions[provider.providerId],
                this.providerDraft,
            );
            const payload: SaveModelProviderModelsPayload = {
                providerId: provider.providerId,
                defaultModelName: this.providerDraft.defaultModelName,
                models: refreshDraft.models.map((modelName, index) => {
                    const contextWindow = refreshDraft.contextWindows.find((item) => {
                        return item.model === modelName;
                    });
                    return {
                        modelName,
                        displayName: modelName,
                        contextWindowTokens: contextWindow?.contextWindowTokens ?? null,
                        enabled: true,
                        sortOrder: index,
                    };
                }),
            };
            if (refreshDraft.reasoningEfforts.length > 0) {
                Object.assign(
                    payload,
                    {
                        reasoningEfforts: refreshDraft.reasoningEfforts,
                    },
                );
            }
            await this.api().saveModelProviderModels(payload);
        },

        /**
         * toggleProvider：启用或停用供应商。
         *
         * @param provider 供应商列表项。
         * @returns 更新完成后没有返回值。
         */
        async toggleProvider(provider: ProviderConfigView): Promise<void> {
            try {
                await this.api().updateModelProvider({
                    providerId: provider.providerId,
                    enabled: !provider.enabled,
                });
                this.clearManagementError("providers");
                await this.loadProviders();
            } catch (error) {
                this.recordManagementError("providers", error);
            }
        },

        /**
         * deleteProvider：按中心服务当前能力停用供应商。
         *
         * @param provider 供应商列表项。
         * @returns 更新完成后没有返回值。
         */
        async deleteProvider(provider: ProviderConfigView): Promise<void> {
            try {
                await this.api().deleteProvider({
                    providerId: provider.providerId,
                });
                this.clearManagementError("providers");
                await this.loadProviders();
            } catch (error) {
                this.recordManagementError("providers", error);
            }
        },

        /**
         * refreshProviderModels：提交手动模型和推理深度刷新。
         *
         * @param provider 供应商列表项。
         * @returns 刷新完成后没有返回值。
         */
        async refreshProviderModels(provider: ProviderConfigView): Promise<void> {
            try {
                if (this.providerDraft.providerId === provider.providerId && this.providerModelDraftHasError()) {
                    return;
                }
                const refreshDraft = buildProviderModelRefreshDraft(
                    provider,
                    this.providerModelOptions[provider.providerId],
                    this.providerDraft,
                );
                const payload: SaveModelProviderModelsPayload = {
                    providerId: provider.providerId,
                    defaultModelName: this.providerDraft.providerId === provider.providerId
                        ? this.providerDraft.defaultModelName
                        : provider.settings.defaultModelName,
                    models: refreshDraft.models.map((modelName, index) => {
                        const contextWindow = refreshDraft.contextWindows.find((item) => {
                            return item.model === modelName;
                        });
                        return {
                            modelName,
                            displayName: modelName,
                            contextWindowTokens: contextWindow?.contextWindowTokens ?? null,
                            enabled: true,
                            sortOrder: index,
                        };
                    }),
                };
                if (refreshDraft.reasoningEfforts.length > 0) {
                    Object.assign(
                        payload,
                        {
                            reasoningEfforts: refreshDraft.reasoningEfforts,
                        },
                    );
                }
                await this.api().saveModelProviderModels(payload);
                await this.loadProviderModelOptions(provider.providerId);
                this.clearManagementError("providers");
                await this.loadProviders();
            } catch (error) {
                this.recordManagementError("providers", error);
            }
        },

        /**
         * updateComposerContextUsage：统计当前窗口已进入上下文的 token 用量。
         *
         * @returns 没有返回值。
         */
        async updateComposerContextUsage(): Promise<void> {
            // 窗口失焦后 token 用量保持：该状态写入 composerContextUsageState 和 composerSettings，不绑定 hover 弹层或 DOM 生命周期。
            const activeTurnId = this.sessionDetail?.turns.findLast((turn) => {
                return turn.endedAt === null
                    || turn.status === "running"
                    || turn.status === "waiting_user";
            })?.turnId ?? this.sessionDetail?.turns.at(-1)?.turnId ?? null;
            const contextUsageWindowKey = JSON.stringify({
                sessionId: this.activeSessionId,
                turnId: activeTurnId,
                agentId: this.activeConversationAgentId,
                draftTitle: this.pendingSessionDraft?.title ?? null,
                modelId: this.composerSettings.selectedModel,
                messageCount: this.sessionDetail?.messages.length ?? 0,
                eventCount: this.events.length,
            });
            const usageKey = JSON.stringify({
                sessionId: this.activeSessionId,
                turnId: activeTurnId,
                agentId: this.activeConversationAgentId,
                modelId: this.composerSettings.selectedModel,
                windowLimitTokens: this.composerSelectedModelContextWindowTokens,
                messageCount: this.sessionDetail?.messages.length ?? 0,
                eventCount: this.events.length,
            });
            if (usageKey === this.composerContextUsageState.lastComposerContextUsageKey) {
                return;
            }

            this.composerContextUsageState.lastComposerContextUsageKey = usageKey;
            this.composerContextUsageState.contextUsageWindowKey = contextUsageWindowKey;
            this.composerContextUsageState.composerContextUsageRequestSerial += 1;
            const requestSerial = this.composerContextUsageState.composerContextUsageRequestSerial;
            const requestWindowKey = contextUsageWindowKey;
            const result = await this.requireRealtimeRequest<{
                /** usedTokens: 当前窗口已用 token 数。 */
                usedTokens: number;
                /** tokenizerName: 中心服务 tokenizer 名称。 */
                tokenizerName: string;
                /** source: token 统计来源。 */
                source: "built-in" | "external" | "fallback";
                /** windowKey: 中心服务回显的当前窗口统计键。 */
                windowKey: string;
                /** tokenUsage: 中心服务数据库保存后的当前窗口 token 快照。 */
                tokenUsage: ConversationTokenUsageView | null;
            }>("tokenizer.count", {
                sessionId: this.activeSessionId,
                turnId: activeTurnId,
                agentId: this.activeConversationAgentId,
                draftText: "",
                referenceSummaries: [],
                attachmentSummaries: [],
                modelId: this.composerSettings.selectedModel,
                windowLimitTokens: this.composerSelectedModelContextWindowTokens,
                windowKey: requestWindowKey,
            });
            if (requestSerial !== this.composerContextUsageState.composerContextUsageRequestSerial) {
                return;
            }
            if (requestWindowKey !== this.composerContextUsageState.contextUsageWindowKey
                || result.windowKey !== requestWindowKey) {
                return;
            }
            this.composerSettings.contextUsedTokens = result.usedTokens;
            this.composerSettings.contextTokenizerName = result.tokenizerName;
            this.composerSettings.contextTokenizerSource = result.source;
            this.applyPersistedTokenUsage(result.tokenUsage);
        },

        /**
         * updateComposerContextUsageFromExecution：模型响应过程或完成后刷新 token 总览。
         *
         * @returns 没有返回值。
         */
        async updateComposerContextUsageFromExecution(): Promise<void> {
            await this.updateComposerContextUsage();
        },

        /**
         * scheduleComposerContextUsageUpdate：节流刷新输入区上下文用量。
         *
         * @returns 没有返回值。
         */
        scheduleComposerContextUsageUpdate(): void {
            // 用户输入阶段不进行 token 统计；该函数保留为执行期显式刷新入口的兼容空操作。
            return;
            if (this.composerContextUsageState.composerContextUsageTimer !== null) {
                window.clearTimeout(this.composerContextUsageState.composerContextUsageTimer);
            }
            // 延迟请求是为了把连续输入、引用和附件变化合并成一次中心服务 tokenizer 调用。
            this.composerContextUsageState.composerContextUsageTimer = window.setTimeout(() => {
                this.composerContextUsageState.composerContextUsageTimer = null;
                void this.updateComposerContextUsage();
            }, 500);
        },

        /**
         * loadProxies：加载代理列表和全局默认代理。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadProxies(): Promise<void> {
            try {
                const result = await this.api().listProxies();
                this.proxies = result.proxies;
                this.defaultProxyId = result.defaultProxyId;
                this.clearManagementError("proxies");
            } catch (error) {
                this.recordManagementError("proxies", error);
            }
        },

        /**
         * editProxy：把代理列表项填入表单。
         *
         * @param proxy 代理列表项。
         * @returns 没有返回值。
         */
        editProxy(proxy: ProxyConfigView): void {
            this.proxyDraft = {
                proxyId: proxy.proxyId,
                proxyName: proxy.proxyName,
                protocol: proxy.protocol,
                host: proxy.host,
                port: proxy.port,
                username: proxy.username,
                password: "",
                clearAuth: false,
                enabled: proxy.enabled,
                note: proxy.note,
            };
        },

        /**
         * resetProxyDraft：重置代理表单。
         *
         * @returns 没有返回值。
         */
        resetProxyDraft(): void {
            this.proxyDraft = createProxyDraft();
        },

        /**
         * saveProxy：新增或修改代理配置。
         *
         * @returns 保存完成后没有返回值。
         */
        async saveProxy(): Promise<void> {
            try {
                await this.api().saveProxy({
                    proxyId: this.proxyDraft.proxyId ?? undefined,
                    proxyName: this.proxyDraft.proxyName,
                    protocol: this.proxyDraft.protocol,
                    host: this.proxyDraft.host,
                    port: this.proxyDraft.port,
                    username: this.proxyDraft.clearAuth ? "" : this.proxyDraft.username,
                    password: this.proxyDraft.clearAuth ? "" : this.proxyDraft.password,
                    clearAuth: this.proxyDraft.clearAuth,
                    enabled: this.proxyDraft.enabled,
                    note: this.proxyDraft.note,
                });
                this.proxyDraft.password = "";
                this.proxyDraft.clearAuth = false;
                this.clearManagementError("proxies");
                await this.loadProxies();
            } catch (error) {
                this.recordManagementError("proxies", error);
            }
        },

        /**
         * toggleProxy：启用或停用代理。
         *
         * @param proxy 代理列表项。
         * @returns 更新完成后没有返回值。
         */
        async toggleProxy(proxy: ProxyConfigView): Promise<void> {
            try {
                await this.api().saveProxy({
                    proxyId: proxy.proxyId,
                    proxyName: proxy.proxyName,
                    protocol: proxy.protocol,
                    host: proxy.host,
                    port: proxy.port,
                    username: proxy.username,
                    password: "",
                    clearAuth: false,
                    enabled: !proxy.enabled,
                    note: proxy.note,
                });
                this.clearManagementError("proxies");
                await this.loadProxies();
            } catch (error) {
                this.recordManagementError("proxies", error);
            }
        },

        /**
         * setGlobalDefaultProxy：设置全局默认代理。
         *
         * @param proxyId 代理 ID，null 表示取消默认代理。
         * @returns 保存完成后没有返回值。
         */
        async setGlobalDefaultProxy(proxyId: string | null): Promise<void> {
            try {
                await this.api().setGlobalDefaultProxy({
                    proxyId,
                });
                this.clearManagementError("proxies");
                await this.loadProxies();
            } catch (error) {
                this.recordManagementError("proxies", error);
            }
        },

        /**
         * deleteProxy：删除代理配置。
         *
         * @param proxy 代理列表项。
         * @returns 删除完成后没有返回值。
         */
        async deleteProxy(proxy: ProxyConfigView): Promise<void> {
            try {
                await this.api().deleteProxy({
                    proxyId: proxy.proxyId,
                });
                this.clearManagementError("proxies");
                await this.loadProxies();
            } catch (error) {
                this.recordManagementError("proxies", error);
            }
        },

        /**
         * loadRuntimes：加载运行环境列表。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadRuntimes(): Promise<void> {
            try {
                const result = await this.api().listRuntimes();
                this.runtimes = result.runtimes;
                this.clearManagementError("runtimes");
            } catch (error) {
                this.recordManagementError("runtimes", error);
            }
        },

        /**
         * editRuntime：把运行环境列表项填入表单。
         *
         * @param runtime 运行环境列表项。
         * @returns 没有返回值。
         */
        editRuntime(runtime: RuntimeConfigView): void {
            this.runtimeDraft = {
                runtimeId: runtime.runtimeId,
                runtimeName: runtime.runtimeName,
                runtimeType: runtime.runtimeType,
                executablePath: runtime.executablePath,
                rootPath: runtime.rootPath,
                version: runtime.version,
                environmentVariablesText: Object.entries(runtime.environmentVariables).map(([
                                                                                                key,
                                                                                                value,
                                                                                            ]) => {
                    return `${key}=${value}`;
                }).join("\n"),
                pathEntriesText: runtime.pathEntries.join("\n"),
                isDefault: runtime.isDefault,
                enabled: runtime.enabled,
                note: runtime.note,
            };
        },

        /**
         * resetRuntimeDraft：重置运行环境表单。
         *
         * @returns 没有返回值。
         */
        resetRuntimeDraft(): void {
            this.runtimeDraft = createRuntimeDraft();
        },

        /**
         * saveRuntime：新增或修改运行环境。
         *
         * @returns 保存完成后没有返回值。
         */
        async saveRuntime(): Promise<void> {
            try {
                await this.api().saveRuntime({
                    runtimeId: this.runtimeDraft.runtimeId ?? undefined,
                    runtimeName: this.runtimeDraft.runtimeName,
                    runtimeType: this.runtimeDraft.runtimeType,
                    executablePath: this.runtimeDraft.executablePath,
                    rootPath: this.runtimeDraft.rootPath,
                    version: this.runtimeDraft.version,
                    environmentVariables: parseEnvironmentVariables(this.runtimeDraft.environmentVariablesText),
                    pathEntries: splitLines(this.runtimeDraft.pathEntriesText),
                    isDefault: this.runtimeDraft.isDefault,
                    enabled: this.runtimeDraft.enabled,
                    note: this.runtimeDraft.note,
                });
                this.clearManagementError("runtimes");
                await this.loadRuntimes();
            } catch (error) {
                this.recordManagementError("runtimes", error);
            }
        },

        /**
         * toggleRuntime：启用或停用运行环境。
         *
         * @param runtime 运行环境列表项。
         * @returns 更新完成后没有返回值。
         */
        async toggleRuntime(runtime: RuntimeConfigView): Promise<void> {
            try {
                await this.api().saveRuntime({
                    runtimeId: runtime.runtimeId,
                    runtimeName: runtime.runtimeName,
                    runtimeType: runtime.runtimeType,
                    executablePath: runtime.executablePath,
                    rootPath: runtime.rootPath,
                    version: runtime.version,
                    environmentVariables: runtime.environmentVariables,
                    pathEntries: runtime.pathEntries,
                    isDefault: runtime.isDefault,
                    enabled: !runtime.enabled,
                    note: runtime.note,
                });
                this.clearManagementError("runtimes");
                await this.loadRuntimes();
            } catch (error) {
                this.recordManagementError("runtimes", error);
            }
        },

        /**
         * setDefaultRuntime：设置同类型默认运行环境。
         *
         * @param runtime 运行环境列表项。
         * @returns 更新完成后没有返回值。
         */
        async setDefaultRuntime(runtime: RuntimeConfigView): Promise<void> {
            try {
                await this.api().saveRuntime({
                    runtimeId: runtime.runtimeId,
                    runtimeName: runtime.runtimeName,
                    runtimeType: runtime.runtimeType,
                    executablePath: runtime.executablePath,
                    rootPath: runtime.rootPath,
                    version: runtime.version,
                    environmentVariables: runtime.environmentVariables,
                    pathEntries: runtime.pathEntries,
                    isDefault: true,
                    enabled: runtime.enabled,
                    note: runtime.note,
                });
                this.clearManagementError("runtimes");
                await this.loadRuntimes();
            } catch (error) {
                this.recordManagementError("runtimes", error);
            }
        },

        /**
         * deleteRuntime：删除运行环境。
         *
         * @param runtime 运行环境列表项。
         * @returns 删除完成后没有返回值。
         */
        async deleteRuntime(runtime: RuntimeConfigView): Promise<void> {
            try {
                await this.api().deleteRuntime({
                    runtimeId: runtime.runtimeId,
                });
                this.clearManagementError("runtimes");
                await this.loadRuntimes();
            } catch (error) {
                this.recordManagementError("runtimes", error);
            }
        },

        /**
         * loadPlugins：加载插件列表。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadPlugins(): Promise<void> {
            try {
                const result = await this.api().listPlugins();
                this.plugins = result.plugins;
                this.clearManagementError("plugins");
            } catch (error) {
                this.recordManagementError("plugins", error);
            }
        },

        /**
         * loadAgents：加载主智能体和长期智能体列表。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadAgents(): Promise<void> {
            try {
                const snapshot = await this.requireRealtimeRequest<{
                    /** agents: 主智能体和长期智能体索引。 */
                    agents: AgentConfigView[];
                }>("chat.bootstrap.snapshot", {});
                this.agents = snapshot.agents;
                this.clearManagementError("agents");
            } catch (error) {
                // 当前页面仍保留主智能体默认节点；中心服务接口失败时不伪造长期智能体，只记录排查信息。
                this.recordManagementError("agents", error);
            }
        },

        /**
         * editAgent：把智能体列表项填入表单草稿。
         *
         * @param agent 智能体列表项。
         * @returns 没有返回值。
         */
        editAgent(agent: {
            agentId: string;
            name: string;
            roleDescription: string;
            defaultProviderId: string | null;
            defaultModel: string;
            reasoningEffort: string;
            enabled: boolean;
        }): void {
            this.agentDraft = {
                agentId: agent.agentId,
                name: agent.name,
                roleDescription: agent.roleDescription,
                defaultProviderId: agent.defaultProviderId,
                defaultModel: agent.defaultModel,
                reasoningEffort: agent.reasoningEffort,
                archiveMemoryOnDelete: true,
            };
        },

        /**
         * resetAgentDraft：重置智能体草稿。
         *
         * @returns 没有返回值。
         */
        resetAgentDraft(): void {
            this.agentDraft = {
                agentId: null,
                name: "",
                roleDescription: "",
                defaultProviderId: null,
                defaultModel: "",
                reasoningEffort: "medium",
                archiveMemoryOnDelete: true,
            };
        },

        /**
         * saveAgent：新增或修改长期智能体。
         *
         * @returns 保存完成后没有返回值。
         */
        async saveAgent(): Promise<void> {
            try {
                if (this.agentDraft.agentId) {
                    await this.api().updateAgent({
                        agentId: this.agentDraft.agentId,
                        name: this.agentDraft.name,
                        roleDescription: this.agentDraft.roleDescription,
                        defaultProviderId: this.agentDraft.defaultProviderId,
                        defaultModel: this.agentDraft.defaultModel,
                        reasoningEffort: this.agentDraft.reasoningEffort,
                    });
                } else {
                    await this.api().createAgent({
                        name: this.agentDraft.name,
                        roleDescription: this.agentDraft.roleDescription,
                        defaultProviderId: this.agentDraft.defaultProviderId,
                        defaultModel: this.agentDraft.defaultModel,
                        reasoningEffort: this.agentDraft.reasoningEffort,
                    });
                }
                this.clearManagementError("agents");
                await this.loadAgents();
            } catch (error) {
                this.recordManagementError("agents", error);
            }
        },

        /**
         * disableAgent：停用长期智能体。
         *
         * @param agent 智能体列表项。
         * @returns 更新完成后没有返回值。
         */
        async disableAgent(agent: {
            agentId: string;
            enabled: boolean;
        }): Promise<void> {
            try {
                if (agent.agentId === "main") {
                    this.recordManagementError("agents", new Error("主智能体不可停用。"));
                    return;
                }
                await this.api().disableAgent({
                    agentId: agent.agentId,
                    archiveMemory: false,
                    impactAccepted: true,
                });
                this.clearManagementError("agents");
                await this.loadAgents();
            } catch (error) {
                this.recordManagementError("agents", error);
            }
        },

        /**
         * deleteAgent：删除长期智能体。
         *
         * @param agent 智能体列表项。
         * @returns 删除完成后没有返回值。
         */
        async deleteAgent(agent: {
            agentId: string;
            name: string;
        }): Promise<void> {
            try {
                if (agent.agentId === "main") {
                    this.recordManagementError("agents", new Error("主智能体不可删除。"));
                    return;
                }
                await this.api().deleteAgent({
                    agentId: agent.agentId,
                    archiveMemory: this.agentDraft.archiveMemoryOnDelete,
                    impactAccepted: true,
                });
                this.clearManagementError("agents");
                await this.loadAgents();
            } catch (error) {
                this.recordManagementError("agents", error);
            }
        },

        /**
         * installPlugin：安装插件清单 JSON。
         *
         * @returns 安装完成后没有返回值。
         */
        async installPlugin(): Promise<void> {
            try {
                await this.api().installPlugin({
                    manifest: parseJsonObject(this.pluginDraft.manifestJson),
                });
                this.clearManagementError("plugins");
                await this.loadPlugins();
            } catch (error) {
                this.recordManagementError("plugins", error);
            }
        },

        /**
         * editPlugin：把插件列表项填入配置表单。
         *
         * @param plugin 插件列表项。
         * @returns 没有返回值。
         */
        editPlugin(plugin: PluginConfigView): void {
            this.pluginDraft = {
                pluginId: plugin.pluginId,
                manifestJson: plugin.manifestJson,
                configJson: formatJsonText(readPluginConfig(plugin.manifestJson)),
            };
        },

        /**
         * togglePlugin：启用或停用插件。
         *
         * @param plugin 插件列表项。
         * @returns 更新完成后没有返回值。
         */
        async togglePlugin(plugin: PluginConfigView): Promise<void> {
            try {
                if (plugin.enabled) {
                    await this.api().disablePlugin({
                        pluginId: plugin.pluginId,
                    });
                } else {
                    await this.api().enablePlugin({
                        pluginId: plugin.pluginId,
                    });
                }
                this.clearManagementError("plugins");
                await this.loadPlugins();
            } catch (error) {
                this.recordManagementError("plugins", error);
            }
        },

        /**
         * configurePlugin：保存当前插件配置 JSON。
         *
         * @returns 保存完成后没有返回值。
         */
        async configurePlugin(): Promise<void> {
            try {
                await this.api().configurePlugin({
                    pluginId: this.pluginDraft.pluginId,
                    config: parseJsonObject(this.pluginDraft.configJson),
                });
                this.clearManagementError("plugins");
                await this.loadPlugins();
            } catch (error) {
                this.recordManagementError("plugins", error);
            }
        },

        /**
         * deletePlugin：删除可删除插件。
         *
         * @param plugin 插件列表项。
         * @returns 删除完成后没有返回值。
         */
        async deletePlugin(plugin: PluginConfigView): Promise<void> {
            try {
                await this.api().deletePlugin({
                    pluginId: plugin.pluginId,
                });
                this.clearManagementError("plugins");
                await this.loadPlugins();
            } catch (error) {
                this.recordManagementError("plugins", error);
            }
        },

        /**
         * loadMcpConfigs：加载全局和项目级 MCP 配置。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadMcpConfigs(): Promise<void> {
            try {
                const result = await this.api().listMcpConfigs();
                this.mcpConfigs = result.configs;
                this.clearManagementError("mcp");
            } catch (error) {
                this.recordManagementError("mcp", error);
            }
        },

        /**
         * loadMcpServerTools：按单个 MCP Server 加载工具列表。
         *
         * @param payload 配置文件相对路径和 Server ID。
         * @returns 当前 Server 的工具列表。
         */
        async loadMcpServerTools(payload: {
            relativePath: string;
            serverId: string;
        }): Promise<McpToolView[]> {
            try {
                const result = await this.api().listMcpTools({
                    relativePath: payload.relativePath,
                    serverId: payload.serverId,
                });
                this.clearManagementError("mcp");
                return result.tools;
            } catch (error) {
                this.recordManagementError("mcp", error);
                return [
                    {
                        serverId: payload.serverId,
                        transportType: "stdio",
                        toolName: "",
                        description: "",
                        inputSchema: {
                            type: "object",
                            properties: {},
                        },
                        errorMessage: this.managementErrors.mcp || "MCP 工具读取失败。",
                    },
                ];
            }
        },

        /**
         * editMcpConfig：把单个 MCP Server 配置填入编辑区。
         *
         * @param config MCP Server 行配置。
         * @returns 没有返回值。
         */
        editMcpConfig(config: McpConfigView): void {
            this.mcpDraft = {
                projectId: "",
                serverId: config.serverId,
                configJson: formatJsonText({
                    mcpServers: {
                        [config.serverId]: config.serverConfig,
                    },
                }),
            };
        },

        /**
         * saveMcpConfig：保存单个全局 MCP Server 配置。
         *
         * @returns 本次保存成功时返回 true，失败时返回 false。
         */
        async saveMcpConfig(): Promise<boolean> {
            try {
                const config = parseJsonObject(this.mcpDraft.configJson);
                if (!isRecord(config.mcpServers)) {
                    throw new Error("MCP 配置根字段必须是 mcpServers 对象。");
                }

                const serverEntries = Object.entries(config.mcpServers);
                if (serverEntries.length !== 1) {
                    throw new Error("MCP 配置一次只能保存一个 mcpServers 服务。");
                }

                const [
                    rawServerId,
                    rawServerConfig,
                ] = serverEntries[0];
                const serverId = rawServerId.trim();
                if (!serverId) {
                    throw new Error("MCP 服务 ID 不能为空。");
                }
                if (!isRecord(rawServerConfig)) {
                    throw new Error("MCP 服务配置必须是 JSON 对象。");
                }

                // serverId: UI 展示字段只由标准 JSON key 同步，保存事实源以 configJson 为准。
                this.mcpDraft.serverId = serverId;
                await this.api().saveMcpConfig({
                    projectId: null,
                    serverId,
                    serverConfig: rawServerConfig,
                });
                this.clearManagementError("mcp");
                await this.loadMcpConfigs();
                return true;
            } catch (error) {
                this.recordManagementError("mcp", error);
                return false;
            }
        },

        /**
         * loadSkills：加载已安装 skill。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadSkills(): Promise<void> {
            try {
                const result = await this.api().listSkills();
                this.skills = result.skills;
                this.clearManagementError("skills");
            } catch (error) {
                this.recordManagementError("skills", error);
            }
        },

        /**
         * loadProjectCapabilitySources：加载项目能力摘要需要的中心服务数据源。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadProjectCapabilitySources(): Promise<void> {
            // Promise.allSettled：能力摘要是项目上下文提示，不应因某类能力接口失败阻断对话详情展示。
            await Promise.allSettled([
                this.loadPlugins(),
                this.loadMcpConfigs(),
                this.loadSkills(),
            ]);
        },

        /**
         * installSkill：安装全局或项目级 skill。
         *
         * @returns 安装完成后没有返回值。
         */
        async installSkill(): Promise<void> {
            try {
                await this.api().installSkill({
                    skillName: this.skillDraft.skillName,
                    content: this.skillDraft.content,
                    projectId: null,
                });
                this.clearManagementError("skills");
                await this.loadSkills();
            } catch (error) {
                this.recordManagementError("skills", error);
            }
        },

        /**
         * requestBrowserNotificationPermission：请求浏览器通知权限并降级为页面内状态。
         *
         * @returns 权限处理完成后没有返回值。
         */
        async requestBrowserNotificationPermission(): Promise<void> {
            if (!("Notification" in window)) {
                this.lastError = "浏览器不支持系统通知，已使用页面内通知。";
                return;
            }

            if (Notification.permission === "default") {
                await Notification.requestPermission();
            }

            if (Notification.permission !== "granted") {
                this.lastError = "浏览器通知权限未开启，已使用页面内通知。";
            }
        },

        /**
         * recordManagementError：记录管理页接口错误并保留控制台排查信息。
         *
         * @param page 管理页标识。
         * @param error 捕获到的真实错误对象。
         * @returns 没有返回值。
         */
        recordManagementError(
            page: "providers" | "proxies" | "runtimes" | "usage" | "plugins" | "mcp" | "skills" | "agents",
            error: unknown,
        ): void {
            // message: 网络层 Failed to fetch 统一转成中文，避免用户只看到浏览器英文错误。
            const rawMessage = error instanceof Error
                ? error.message
                : String(error);
            const message = rawMessage === "Failed to fetch"
                ? "无法连接中心服务，请确认中心服务已启动后重试。"
                : rawMessage;
            this.managementErrors[page] = message;
            this.lastError = message;
            // errorMessage: 浏览器控制台会把 Error 序列化成空对象，因此额外展开名称和消息用于排查。
            const errorMessage = error instanceof Error
                ? error.message
                : String(error);
            const errorName = error instanceof Error
                ? error.name
                : typeof error;
            // 控制台保留原始错误对象，方便排查 CORS、网络失败或中心服务业务错误。
            console.error("管理页接口请求失败", {
                errorMessage,
                errorName,
                page,
                error,
            });
        },

        /**
         * clearManagementError：清除指定管理页错误。
         *
         * @param page 管理页标识。
         * @returns 没有返回值。
         */
        clearManagementError(page: "providers" | "proxies" | "runtimes" | "usage" | "plugins" | "mcp" | "skills" | "agents"): void {
            this.managementErrors[page] = "";
        },

    };
}
