import type {
    AgentConfigView,
    ProviderConfigView,
    ProviderModelListView,
    SessionDetailResult,
    UsageFilters,
} from "@zhixin/api-client";
import type {
    ComposerDraftModel,
    ComposerReferenceDraft,
} from "@zhixin/ui";
import type {
    ConversationSession,
    InternalFileLink,
    ProjectRecord,
} from "@zhixin/shared";

import type {RuntimeEnvironment} from "../runtime";
import type {
    AgentStatusTreeNode,
    AgentDraft,
    IdeContextReferencePayload,
    McpDraft,
    PendingSessionDraft,
    PluginDraft,
    ProjectReferenceSuggestion,
    ProviderDraft,
    ProxyDraft,
    RuntimeDraft,
    SkillDraft,
} from "./app-types";

export function createProjectFileSuggestion(projectId: string): ProjectReferenceSuggestion {
    const link = createInternalFileLink(projectId, "当前文件", null, null);
    return {
        key: "project-current-file",
        label: "当前文件",
        description: "引用当前项目文件",
        reference: {
            type: "file",
            link,
            displayName: "当前文件",
        },
    };
}

/**
 * resolveComposerProjectId：解析当前输入区明确绑定的项目 ID。
 *
 * 来源：依次只读取三类已有明确状态：中心服务项目会话、未发送项目草稿、IDE 插件运行时项目上下文。
 * @param state Pinia 当前状态切片。
 * @returns 有明确项目上下文时返回项目 ID，否则返回 null。
 */
export function resolveComposerProjectId(state: {
    sessionDetail: SessionDetailResult | null;
    pendingSessionDraft: PendingSessionDraft | null;
    runtime: RuntimeEnvironment;
}): string | null {
    // sessionProjectId: 已存在项目会话的中心服务事实源，优先级最高。
    const sessionProjectId = state.sessionDetail?.session.sessionType === "project"
        ? state.sessionDetail.session.projectId
        : null;
    if (typeof sessionProjectId === "string" && sessionProjectId.trim().length > 0) {
        return sessionProjectId;
    }

    // draftProjectId: 用户新建项目对话或插件页签后的本地待发送项目意图，来源于 pendingSessionDraft.projectId。
    const draftProjectId = state.pendingSessionDraft?.sessionType === "project"
        ? state.pendingSessionDraft.projectId
        : null;
    if (typeof draftProjectId === "string" && draftProjectId.trim().length > 0) {
        return draftProjectId;
    }

    // runtimeProjectContext: IDE 插件入口明确携带的项目上下文，支持首个项目页签尚未发送时使用项目引用。
    const runtimeProjectContext = state.runtime.projectContext;
    if (!runtimeProjectContext) {
        return null;
    }
    // runtimeProjectId: 来自 runtime.projectContext.projectId，不从其他字段推断。
    const runtimeProjectId = runtimeProjectContext.projectId;
    if (typeof runtimeProjectId === "string" && runtimeProjectId.trim().length > 0) {
        return runtimeProjectId;
    }

    return null;
}

export function createProjectFolderSuggestion(projectId: string): ProjectReferenceSuggestion {
    return {
        key: "project-root-folder",
        label: "项目文件夹",
        description: "引用当前项目根目录",
        reference: {
            type: "folder",
            projectId,
            absolutePath: "",
            relativePath: ".",
            displayName: "项目文件夹",
        },
    };
}

export function createProjectCodeSuggestion(projectId: string): ProjectReferenceSuggestion {
    const link = createInternalFileLink(projectId, "当前代码位置", 1, 1);
    return {
        key: "project-current-code",
        label: "当前代码位置",
        description: "引用当前编辑器行或选区",
        reference: {
            type: "code",
            link,
            selectedCode: "",
            displayName: "当前代码位置",
        },
    };
}

/**
 * fallbackProjectsFromSessions：从项目会话构造兜底项目记录。
 *
 * @param projects 中心服务项目列表事实源。
 * @param sessions 中心服务会话列表事实源。
 * @returns 旧中心服务缺少 /api/project/list 时用于导航展示的项目记录。
 */
export function fallbackProjectsFromSessions(
    projects: ProjectRecord[],
    sessions: ConversationSession[],
): ProjectRecord[] {
    // existingProjectIds: 已有项目事实源优先，避免项目列表正常时重复构造兜底节点。
    const existingProjectIds = new Set(projects.map((project) => {
        return project.projectId;
    }));
    // projectIds: 项目会话明确携带的 projectId；这是旧中心服务兼容兜底的唯一来源。
    const projectIds = sessions.filter((session) => {
        return session.sessionType === "project" && typeof session.projectId === "string";
    }).map((session) => {
        return session.projectId as string;
    }).filter((projectId) => {
        return !existingProjectIds.has(projectId);
    });

    return Array.from(new Set(projectIds)).map((projectId) => {
        return {
            projectId,
            // displayName: 旧中心服务缺少项目登记事实源时不能用 ID 冒充文件夹名，只显示明确的未登记状态。
            displayName: "未登记项目名称",
            alias: null,
            latestPath: "",
            createdAt: "",
            updatedAt: "",
        };
    });
}

export function createInternalFileLink(
    projectId: string,
    relativePath: string,
    startLine: number | null,
    endLine: number | null,
): InternalFileLink {
    return {
        projectId,
        absolutePath: "",
        relativePath,
        startLine,
        endLine,
    };
}

/**
 * createProviderDraft：创建供应商表单默认值。
 *
 * @returns 供应商表单草稿。
 */
export function createProviderDraft(): ProviderDraft {
    return {
        providerId: null,
        providerName: "",
        protocolPluginId: "builtin-model-openai-compatible",
        protocolMode: "chat-completions",
        baseUrl: "",
        apiKey: "",
        model: "",
        enabled: true,
        capabilities: {
            supportsVision: false,
            supportsToolCalling: false,
            supportsJsonOutput: false,
            supportsReasoningEffort: false,
            providesCacheUsage: false,
            supportsModelList: false,
            supportsStreaming: false,
        },
        proxyPolicy: {
            mode: "use-global-default",
            proxyId: null,
        },
        refreshModelsText: "",
        refreshModelContextWindowsText: "",
        refreshReasoningText: "",
    };
}

/**
 * createProxyDraft：创建代理表单默认值。
 *
 * @returns 代理表单草稿。
 */
export function createProxyDraft(): ProxyDraft {
    return {
        proxyId: null,
        proxyName: "",
        protocol: "SOCKS5",
        host: "127.0.0.1",
        port: 1080,
        username: "",
        password: "",
        clearAuth: false,
        enabled: true,
        note: "",
    };
}

/**
 * createRuntimeDraft：创建运行环境表单默认值。
 *
 * @returns 运行环境表单草稿。
 */
export function createRuntimeDraft(): RuntimeDraft {
    return {
        runtimeId: null,
        runtimeName: "",
        runtimeType: "Node.js",
        executablePath: "",
        rootPath: "",
        version: "",
        environmentVariablesText: "",
        pathEntriesText: "",
        isDefault: false,
        enabled: true,
        note: "",
    };
}

/**
 * createPluginDraft：创建插件管理默认草稿。
 *
 * @returns 插件表单草稿。
 */
export function createPluginDraft(): PluginDraft {
    return {
        pluginId: "",
        manifestJson: formatJsonText({
            id: "user-plugin",
            name: "用户插件",
            source: "user-installed",
            scope: "global",
            permissions: [],
        }),
        configJson: formatJsonText({}),
    };
}

/**
 * createMcpDraft：创建 MCP 配置默认草稿。
 *
 * @returns MCP 表单草稿。
 */
export function createMcpDraft(): McpDraft {
    return {
        projectId: "",
        configJson: formatJsonText({
            mcpServers: {},
        }),
    };
}

/**
 * createSkillDraft：创建 skill 安装默认草稿。
 *
 * @returns skill 表单草稿。
 */
export function createSkillDraft(): SkillDraft {
    return {
        skillName: "",
        content: "",
        projectId: "",
    };
}

/**
 * createAgentDraft：创建智能体管理表单默认值。
 *
 * @returns 长期智能体创建和修改草稿。
 */
export function createAgentDraft(): AgentDraft {
    return {
        agentId: null,
        name: "",
        roleDescription: "",
        capabilityBoundary: "",
        defaultProviderId: null,
        defaultModel: "",
        reasoningEffort: "medium",
        archiveMemoryOnDelete: true,
    };
}

/**
 * createDefaultAgentStatusTree：创建默认智能体状态树。
 *
 * @returns 至少包含系统内置主智能体的两级树根节点。
 */
export function createDefaultAgentStatusTree(): AgentStatusTreeNode[] {
    return [
        {
            agentId: "main",
            parentAgentId: "",
            name: "致心",
            status: "空闲",
            taskSummary: "主智能体当前没有执行任务。",
            conversationHint: "主智能体“致心”负责默认对话、任务派发和长期记忆归纳；主智能体不可删除。",
            nodeKind: "主智能体",
            children: [],
        },
    ];
}

/**
 * mergeAgentStatusTree：合并中心服务长期智能体和当前运行期子智能体树。
 *
 * @param agents 中心服务已固化的智能体列表。
 * @param runtimeTree 当前运行期智能体状态树，第二级子智能体来源于后续运行事件。
 * @returns 输入区弹框展示的两级智能体状态树。
 */
export function mergeAgentStatusTree(
    agents: AgentConfigView[],
    runtimeTree: AgentStatusTreeNode[],
): AgentStatusTreeNode[] {
    // childrenByParent: 只按 parentAgentId 精确归属第二级子智能体，避免按名称或摘要猜测父节点。
    const childrenByParent = new Map<string, AgentStatusTreeNode[]>();
    for (const node of runtimeTree.flatMap((root) => {
        return root.children;
    })) {
        const siblings = childrenByParent.get(node.parentAgentId) ?? [];
        siblings.push(node);
        childrenByParent.set(
            node.parentAgentId,
            siblings,
        );
    }

    // mainAgent: 主智能体必须存在；中心服务返回主智能体时用中心服务名称，否则使用内置“致心”语义。
    const mainAgent = agents.find((agent) => {
        return agent.agentId === "main";
    });
    const longTermAgents = agents.filter((agent) => {
        return agent.agentId !== "main";
    });
    const rootAgents: AgentConfigView[] = [
        mainAgent ?? {
            agentId: "main",
            name: "致心",
            enabled: true,
            roleDescription: "系统内置主智能体，直接与用户对话并调度其他智能体。",
            capabilityBoundary: "默认对话、任务派发和长期记忆归纳。",
            defaultProviderId: null,
            defaultModel: "",
            reasoningEffort: "medium",
            memoryIndexPath: "memory/agents/main",
            createdBy: "system",
            definitionPath: "agents/main.md",
            updatedAt: "",
        },
        ...longTermAgents,
    ];

    return rootAgents.map((agent) => {
        const fallbackNode = runtimeTree.find((node) => {
            return node.agentId === agent.agentId;
        });
        return {
            agentId: agent.agentId,
            parentAgentId: "",
            name: agent.name,
            status: agent.enabled ? (fallbackNode?.status ?? "空闲") : "已停用",
            taskSummary: fallbackNode?.taskSummary ?? "当前没有执行任务。",
            conversationHint: fallbackNode?.conversationHint ?? `${agent.name} 的对话查看和发送暂时仍通过当前会话消息接口完成；主智能体不可删除，长期智能体删除后会保留历史会话。`,
            nodeKind: agent.agentId === "main"
                ? "主智能体"
                : "长期智能体",
            children: childrenByParent.get(agent.agentId) ?? [],
        };
    });
}

/**
 * createUsageFilters：创建用量筛选默认值。
 *
 * @returns 用量筛选条件。
 */
export function createUsageFilters(): UsageFilters {
    return {
        providerId: null,
        model: null,
        projectId: null,
        sessionId: null,
        startedAt: null,
        endedAt: null,
    };
}

/**
 * splitLines：把多行文本转换为去空白数组。
 *
 * @param value 多行文本。
 * @returns 非空行数组。
 */
export function splitLines(value: string): string[] {
    return value.split(/\r?\n/u).map((line) => {
        return line.trim();
    }).filter((line) => {
        return line.length > 0;
    });
}

/**
 * parseModelContextWindows：解析模型窗口配置多行文本。
 *
 * @param value 多行文本，每行格式为 `模型名=数字K`。
 * @returns 模型窗口 token 配置数组。
 */
export function parseModelContextWindows(value: string): Array<{
    model: string;
    contextWindowTokens: number;
}> {
    return splitLines(value).map((line) => {
        const equalIndex = line.indexOf("=");
        if (equalIndex <= 0) {
            return null;
        }
        const model = line.slice(0, equalIndex).trim();
        const contextWindowK = Number(line.slice(equalIndex + 1).replace(/K$/iu, "").trim());
        if (model.length === 0 || !Number.isFinite(contextWindowK) || contextWindowK <= 0) {
            return null;
        }
        return {
            model,
            contextWindowTokens: Math.round(contextWindowK * 1000),
        };
    }).filter((item): item is {
        model: string;
        contextWindowTokens: number;
    } => {
        return item !== null;
    });
}

/**
 * findInvalidModelContextWindowLine：查找首个非法模型窗口配置行。
 *
 * @param value 多行模型窗口文本，每行格式为 `模型名=数字K`。
 * @returns 首个非法行；全部合法时返回空字符串。
 */
export function findInvalidModelContextWindowLine(value: string): string {
    return splitLines(value).find((line) => {
        const equalIndex = line.indexOf("=");
        const contextWindowK = Number(line.slice(equalIndex + 1).replace(/K$/iu, "").trim());
        return equalIndex <= 0 || !Number.isFinite(contextWindowK) || contextWindowK <= 0;
    }) ?? "";
}

/**
 * buildProviderModelRefreshDraft：构造指定供应商的模型刷新负载。
 *
 * @param provider 当前点击的供应商行。
 * @param savedOptions 中心服务已保存的模型列表。
 * @param draft 当前页面全局表单草稿。
 * @returns 模型、窗口和推理深度数组。
 */
export function buildProviderModelRefreshDraft(
    provider: ProviderConfigView,
    savedOptions: ProviderModelListView | undefined,
    draft: ProviderDraft,
): {
    models: string[];
    contextWindows: Array<{
        model: string;
        contextWindowTokens: number;
    }>;
    reasoningEfforts: string[];
} {
    // isEditingCurrentProvider: 只有当前表单正在编辑该供应商时，行级刷新才使用表单文本，避免把 A 的草稿误写到 B。
    const isEditingCurrentProvider = draft.providerId === provider.providerId;
    const models = isEditingCurrentProvider
        ? splitLines(draft.refreshModelsText)
        : savedOptions?.models ?? [];
    return {
        models: models.length > 0
            ? models
            : [
                provider.defaultModel,
            ].filter((model) => {
                return model.length > 0;
            }),
        contextWindows: isEditingCurrentProvider
            ? parseModelContextWindows(draft.refreshModelContextWindowsText)
            : savedOptions?.contextWindows ?? [],
        reasoningEfforts: isEditingCurrentProvider
            ? splitLines(draft.refreshReasoningText)
            : savedOptions?.reasoningEfforts ?? [],
    };
}

/**
 * estimateComposerContextUsedTokens：估算当前窗口已用上下文。
 *
 * @param sessionDetail 当前会话详情。
 * @param draft 当前输入草稿。
 * @returns 估算 token 数。
 */
export function estimateComposerContextUsedTokens(
    sessionDetail: SessionDetailResult | null,
    draft: ComposerDraftModel,
): number {
    // plainTextLength: 当前阶段中心服务未返回真实 tokenizer 统计，使用单一临时估算约定，后续替换为服务端上下文统计。
    const plainTextLength = [
        ...(sessionDetail?.messages ?? []).map((message) => {
            return message.contentMarkdown;
        }),
        draft.text,
        ...draft.references.map((reference) => {
            return reference.displayName;
        }),
        ...draft.attachments.map((attachment) => {
            return attachment.fileName;
        }),
    ].join("\n").length;
    return Math.ceil(plainTextLength / 4);
}

/**
 * formatModelContextWindowsForDraft：把模型窗口配置转回表单文本。
 *
 * @param value 中心服务返回的 token 窗口配置。
 * @returns 每行 `模型名=数字K` 的文本。
 */
export function formatModelContextWindowsForDraft(value: Array<{
    model: string;
    contextWindowTokens: number;
}>): string {
    return value.map((item) => {
        return `${item.model}=${Math.round(item.contextWindowTokens / 1000)}K`;
    }).join("\n");
}

/**
 * parseEnvironmentVariables：解析 KEY=VALUE 多行文本。
 *
 * @param value 环境变量多行文本。
 * @returns 环境变量对象。
 */
export function parseEnvironmentVariables(value: string): Record<string, string> {
    const variables: Record<string, string> = {};
    for (const line of splitLines(value)) {
        const equalIndex = line.indexOf("=");
        if (equalIndex <= 0) {
            continue;
        }
        const key = line.slice(0, equalIndex).trim();
        const variableValue = line.slice(equalIndex + 1).trim();
        variables[key] = variableValue;
    }
    return variables;
}

/**
 * isRecord：判断未知值是否为普通对象。
 *
 * @param value 待判断值。
 * @returns 是普通对象时返回 true。
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * parseJsonObject：把 JSON 文本解析为对象。
 *
 * @param value JSON 文本。
 * @returns 解析后的对象。
 */
export function parseJsonObject(value: string): Record<string, unknown> {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) {
        throw new Error("JSON 内容必须是对象。");
    }
    return parsed;
}

/**
 * formatJsonText：把对象格式化为稳定缩进 JSON 文本。
 *
 * @param value 待格式化对象。
 * @returns JSON 文本。
 */
export function formatJsonText(value: Record<string, unknown>): string {
    return JSON.stringify(value, null, 2);
}

/**
 * readPluginConfig：从插件清单 JSON 中读取 config 对象。
 *
 * @param manifestJson 插件清单 JSON 文本。
 * @returns 插件配置对象。
 */
export function readPluginConfig(manifestJson: string): Record<string, unknown> {
    const manifest = parseJsonObject(manifestJson);
    return isRecord(manifest.config)
        ? manifest.config
        : {};
}

/**
 * normalizeOptionalText：把空字符串转换为 null。
 *
 * @param value 可选文本。
 * @returns 非空文本或 null。
 */
export function normalizeOptionalText(value: string | null): string | null {
    if (value === null) {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0
        ? trimmed
        : null;
}

export function convertIdePayloadToReference(payload: IdeContextReferencePayload): ComposerReferenceDraft {
    const link: InternalFileLink = {
        projectId: payload.projectId,
        absolutePath: payload.absolutePath,
        relativePath: payload.relativePath,
        startLine: payload.startLine > 0
            ? payload.startLine
            : null,
        endLine: payload.endLine > 0
            ? payload.endLine
            : null,
    };

    if (payload.type === "folder") {
        return {
            type: "folder",
            projectId: payload.projectId,
            absolutePath: payload.absolutePath,
            relativePath: payload.relativePath,
            displayName: payload.displayText,
        };
    }

    if (payload.type === "code") {
        return {
            type: "code",
            link,
            selectedCode: payload.selectedText,
            displayName: payload.displayText,
        };
    }

    return {
        type: "file",
        link,
        displayName: payload.displayText,
    };
}

export function formatReferenceMarkdown(reference: ComposerReferenceDraft): string {
    if (reference.type === "folder") {
        return `[@${reference.displayName}](zhixin-folder:${encodeURIComponent(JSON.stringify(reference))})`;
    }

    if (reference.type === "code") {
        return `[@${reference.displayName}](zhixin-code:${encodeURIComponent(JSON.stringify(reference))})`;
    }

    return `[@${reference.displayName}](zhixin-file:${encodeURIComponent(JSON.stringify(reference.link))})`;
}
