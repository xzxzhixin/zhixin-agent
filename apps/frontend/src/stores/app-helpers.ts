import type {
    AgentConfigView,
    ProviderConfigView,
    ProviderModelListView,
    UsageFilters,
} from "@zhixin/api-client";
import type {
    ComposerDraftModel,
    ComposerReferenceDraft,
} from "@zhixin/ui";
import {
    renderComposerReferenceMarkdown,
} from "@zhixin/ui";
import type {
    ConversationSession,
    InternalFileLink,
    ProjectRecord,
} from "@zhixin/shared";
import {
    isRecord,
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
        modelProtocol: "openai",
        apiBaseUrl: "",
        apiKey: "",
        customHeadersText: formatJsonText({}),
        defaultModelName: "",
        enabled: true,
        capabilities: {
            supportsVision: false,
            supportsToolCalling: false,
            supportsJsonOutput: false,
            supportsReasoningEffort: false,
            providesCacheUsage: false,
            supportsModelList: false,
            supportsStreaming: false,
            responsesSupported: false,
            chatCompletionsSupported: false,
            responsesStreamSupported: false,
            chatCompletionsStreamSupported: false,
            streamToolCallsSupported: false,
            selectedRuntimeMode: null,
            lastTestStatus: null,
            lastTestMessage: null,
            lastTestedAt: null,
        },
        proxyPolicy: {
            mode: "use-global-default",
            proxyId: null,
        },
        manualModelsText: "",
        manualModelContextText: "",
        reasoningEffortText: "",
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
        serverId: "",
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
 * @returns 默认可测试两级树；真实长期智能体加载后会由中心服务列表覆盖。
 */
export function createDefaultAgentStatusTree(): AgentStatusTreeNode[] {
    // 当前前端单一临时约定：中心服务尚未创建长期智能体时提供可测试节点；主智能体仍不进入该状态树。
    return [
        {
            agentId: "test-long-term-agent",
            parentAgentId: "",
            name: "测试长期智能体",
            status: "空闲",
            taskSummary: "当前没有执行任务，可点击节点打开对话和引导区域。",
            conversationHint: "该节点用于浏览器端验证长期智能体入口；真实长期智能体创建后由中心服务事实覆盖。",
            nodeKind: "长期智能体",
            children: [
                {
                    agentId: "test-child-agent",
                    parentAgentId: "test-long-term-agent",
                    name: "测试子智能体",
                    status: "空闲",
                    taskSummary: "等待当前对话内发送或引导。",
                    conversationHint: "该节点用于验证子智能体对话弹窗、发送和引导入口。",
                    nodeKind: "子智能体",
                    children: [],
                },
            ],
        },
    ];
}

/**
 * mergeAgentStatusTree：合并中心服务长期智能体和当前运行期子智能体树。
 *
 * @param agents 中心服务已固化的智能体列表。
 * @param runtimeTree 当前运行期智能体状态树，第二级子智能体来源于后续运行事件。
 * @returns 输入区弹框展示的主智能体、长期智能体和子智能体两级状态树。
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

    // visibleAgents: 当前窗口一级节点包含主智能体和长期智能体，子智能体仍只通过 children 展示。
    const visibleAgents = agents.filter((agent) => {
        return agent.agentId.trim().length > 0;
    });

    if (visibleAgents.length === 0) {
        // fallbackRuntimeTree: 中心服务尚未返回智能体列表时只使用当前运行期树；这是一套单一临时约定，便于浏览器端验证两级树。
        return runtimeTree.filter((node) => {
            return node.nodeKind === "主智能体" || node.nodeKind === "长期智能体";
        });
    }

    return visibleAgents.map((agent) => {
        const fallbackNode = runtimeTree.find((node) => {
            return node.agentId === agent.agentId;
        });
        const isMainAgent = agent.agentId === "main";
        return {
            agentId: agent.agentId,
            parentAgentId: "",
            name: agent.name,
            status: agent.enabled ? (fallbackNode?.status ?? "空闲") : "已停用",
            taskSummary: fallbackNode?.taskSummary ?? "当前没有执行任务。",
            conversationHint: fallbackNode?.conversationHint ?? `${agent.name} 的对话查看、引导和发送暂时仍通过当前会话消息接口完成；长期智能体删除后会保留历史会话。`,
            nodeKind: isMainAgent ? "主智能体" : "长期智能体",
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
        providerName: null,
        model: null,
        modelName: null,
        projectId: null,
        projectName: null,
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
 * sortProviderModelsByNumericVersion：按模型名中的数字版本降序排序。
 *
 * @param models 供应商返回或用户维护的模型名数组。
 * @returns 去重后按数字段从大到小排列的模型名数组。
 */
export function sortProviderModelsByNumericVersion(models: string[]): string[] {
    // uniqueModels: 保留模型名第一次出现的原文，避免大小写或空白处理后生成额外候选协议。
    const uniqueModels = Array.from(new Set(models.map((model) => {
        return model.trim();
    }).filter((model) => {
        return model.length > 0;
    })));
    return uniqueModels.sort((leftModel, rightModel) => {
        const leftParts = extractModelNumericParts(leftModel);
        const rightParts = extractModelNumericParts(rightModel);
        const maxLength = Math.max(
            leftParts.length,
            rightParts.length,
        );
        for (let index = 0; index < maxLength; index += 1) {
            const leftValue = leftParts[index] ?? 0;
            const rightValue = rightParts[index] ?? 0;
            if (leftValue !== rightValue) {
                return rightValue - leftValue;
            }
        }
        return leftModel.localeCompare(rightModel);
    });
}

/**
 * extractModelNumericParts：提取模型名里的所有数字段。
 *
 * @param model 模型名称。
 * @returns 按出现顺序排列的数字段。
 */
function extractModelNumericParts(model: string): number[] {
    // matches: 数字可能不在模型名末尾，例如 gpt-5.5-codex；只提取明确数字段参与排序。
    const matches = model.match(/\d+(?:\.\d+)?/gu) ?? [];
    return matches.flatMap((part) => {
        return part.split(".").map((value) => Number(value));
    }).filter((value) => {
        return Number.isFinite(value);
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
        ? splitLines(draft.manualModelsText)
        : savedOptions?.models ?? [];
    return {
        models: models.length > 0
            ? models
            : [
                provider.settings.defaultModelName ?? "",
            ].filter((model) => {
                return model.length > 0;
            }),
        contextWindows: isEditingCurrentProvider
            ? parseModelContextWindows(draft.manualModelContextText)
            : savedOptions?.contextWindows ?? [],
        reasoningEfforts: savedOptions?.reasoningEfforts ?? [],
    };
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
    return renderComposerReferenceMarkdown(reference);
}
