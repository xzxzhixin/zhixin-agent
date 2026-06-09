import type {
    UnifiedToolCapability,
} from "@zhixin/shared";

/**
 * UNIFIED_TOOL_CAPABILITY_REGISTRY：中心服务统一工具能力注册表。
 *
 * 来源：架构中的命令、智能体创建、MCP 和 skill 统一能力链路。
 * 含义：所有智能体和子智能体先从该注册表发现工具，再进入权限、执行和审计。
 * 约束：插件当前阶段已内联，不再作为模型可见工具占位；skill 尚未绑定具体执行器时只登记不可用原因；MCP 已接入中心服务配置执行器。
 */
export const UNIFIED_TOOL_CAPABILITY_REGISTRY: UnifiedToolCapability[] = [
    {
        toolId: "builtin.command.run",
        toolKind: "command",
        displayName: "命令工具",
        requiredPermission: "command.run",
        availability: "available",
        unavailableReason: null,
        description: "在中心服务受控环境中执行明确的本机命令，并返回标准输出或错误摘要。",
        inputSchema: {
            type: "object",
            required: [
                "inputSummary",
            ],
            properties: {
                shellCommand: {
                    type: "string",
                    description: "需要 shell 语法时使用的完整命令行；Windows 由 PowerShell 执行，macOS/Linux 由 sh 执行。",
                },
                executablePath: {
                    type: "string",
                    description: "不需要 shell 语法时要执行的可执行文件路径或命令名。",
                },
                args: {
                    type: "array",
                    description: "不需要 shell 语法时的命令参数数组。",
                    items: {
                        type: "string",
                    },
                },
                inputSummary: {
                    type: "string",
                    description: "模型请求执行命令的目的摘要。",
                },
            },
        },
        riskLevel: "high",
        scope: "session",
        approvalRequired: true,
        displayText: "执行命令",
    },
    {
        toolId: "builtin.agent.createLongTerm",
        toolKind: "agent",
        displayName: "创建长期智能体",
        requiredPermission: "project.write",
        availability: "available",
        unavailableReason: null,
        description: "由主智能体在任务需要且用户授权后创建可长期管理的智能体定义。",
        inputSchema: {
            type: "object",
            required: [
                "name",
                "roleDescription",
            ],
            properties: {
                name: {
                    type: "string",
                    description: "长期智能体名称。",
                },
                roleDescription: {
                    type: "string",
                    description: "长期智能体角色说明。",
                },
                capabilityBoundary: {
                    type: "string",
                    description: "长期智能体能力边界。",
                },
            },
        },
        riskLevel: "medium",
        scope: "session",
        approvalRequired: true,
        displayText: "创建长期智能体",
    },
    {
        toolId: "builtin.agent.createSubAgent",
        toolKind: "agent",
        displayName: "创建子智能体",
        requiredPermission: "project.read",
        availability: "available",
        unavailableReason: null,
        description: "由主智能体或长期智能体创建当前任务内的一次性子智能体，子智能体不会固化为长期定义。",
        inputSchema: {
            type: "object",
            required: [
                "name",
            ],
            properties: {
                name: {
                    type: "string",
                    description: "子智能体展示名称。",
                },
                parentAgentId: {
                    type: "string",
                    description: "创建者智能体 ID，缺省时按主智能体 main 处理。",
                },
                parentAgentKind: {
                    type: "string",
                    enum: [
                        "main",
                        "long-term",
                        "sub",
                    ],
                    description: "创建者类型，子智能体类型会被中心服务拒绝。",
                },
            },
        },
        riskLevel: "low",
        scope: "session",
        approvalRequired: false,
        displayText: "创建子智能体",
    },
    {
        toolId: "create-agent-team",
        toolKind: "agent",
        displayName: "创建 team",
        requiredPermission: "project.write",
        availability: "available",
        unavailableReason: null,
        description: "由主智能体在当前会话中创建跟随会话生命周期的协作 team。",
        inputSchema: {
            type: "object",
            required: [
                "name",
                "memberAgentIds",
            ],
            properties: {
                name: {
                    type: "string",
                    description: "team 展示名称。",
                },
                description: {
                    type: "string",
                    description: "team 协作目标说明。",
                },
                memberAgentIds: {
                    type: "array",
                    description: "初始成员长期智能体 ID 列表；成员必须是启用状态的长期智能体。",
                    items: {
                        type: "string",
                    },
                },
                creatorAgentId: {
                    type: "string",
                    description: "调用者智能体 ID；team 管理工具只允许 main。",
                },
            },
        },
        riskLevel: "medium",
        scope: "session",
        approvalRequired: false,
        displayText: "创建 team",
    },
    {
        toolId: "disband-agent-team",
        toolKind: "agent",
        displayName: "解散 team",
        requiredPermission: "project.write",
        availability: "available",
        unavailableReason: null,
        description: "由主智能体物理删除当前会话中的 team 记录和成员关系，历史事件保留。",
        inputSchema: {
            type: "object",
            required: [
                "teamId",
            ],
            properties: {
                teamId: {
                    type: "string",
                    description: "要解散的 team ID。",
                },
                creatorAgentId: {
                    type: "string",
                    description: "调用者智能体 ID；team 管理工具只允许 main。",
                },
            },
        },
        riskLevel: "medium",
        scope: "session",
        approvalRequired: false,
        displayText: "解散 team",
    },
    {
        toolId: "add-agent-team-member",
        toolKind: "agent",
        displayName: "添加 team 成员",
        requiredPermission: "project.write",
        availability: "available",
        unavailableReason: null,
        description: "由主智能体把启用状态的长期智能体加入当前会话 team。",
        inputSchema: {
            type: "object",
            required: [
                "teamId",
                "agentId",
            ],
            properties: {
                teamId: {
                    type: "string",
                    description: "目标 team ID。",
                },
                agentId: {
                    type: "string",
                    description: "要加入的启用长期智能体 ID。",
                },
                role: {
                    type: "string",
                    description: "成员角色；缺省为 member。",
                },
                creatorAgentId: {
                    type: "string",
                    description: "调用者智能体 ID；team 管理工具只允许 main。",
                },
            },
        },
        riskLevel: "medium",
        scope: "session",
        approvalRequired: false,
        displayText: "添加 team 成员",
    },
    {
        toolId: "remove-agent-team-member",
        toolKind: "agent",
        displayName: "移除 team 成员",
        requiredPermission: "project.write",
        availability: "available",
        unavailableReason: null,
        description: "由主智能体从当前会话 team 中移除长期智能体成员，不删除长期智能体和记忆。",
        inputSchema: {
            type: "object",
            required: [
                "teamId",
                "agentId",
            ],
            properties: {
                teamId: {
                    type: "string",
                    description: "目标 team ID。",
                },
                agentId: {
                    type: "string",
                    description: "要移除的长期智能体 ID。",
                },
                creatorAgentId: {
                    type: "string",
                    description: "调用者智能体 ID；team 管理工具只允许 main。",
                },
            },
        },
        riskLevel: "medium",
        scope: "session",
        approvalRequired: false,
        displayText: "移除 team 成员",
    },
    {
        toolId: "builtin.mcp.call",
        toolKind: "mcp",
        displayName: "MCP 工具",
        requiredPermission: "mcp.call",
        availability: "available",
        unavailableReason: null,
        description: "调用当前会话可用的 MCP Server 工具；优先使用动态列出的 mcp_<server>_<tool> 工具。",
        inputSchema: {
            type: "object",
            required: [
                "serverId",
                "toolName",
                "arguments",
            ],
            properties: {
                serverId: {
                    type: "string",
                    description: "MCP Server ID，例如全局配置里的 idea。",
                },
                toolName: {
                    type: "string",
                    description: "MCP 工具名称，例如 get_all_open_file_paths 或 get_file_text_by_path。",
                },
                arguments: {
                    type: "object",
                    description: "MCP 工具参数。",
                },
            },
        },
        riskLevel: "medium",
        scope: "session",
        approvalRequired: true,
        displayText: "调用 MCP",
    },
    {
        toolId: "builtin.skill.use",
        toolKind: "skill",
        displayName: "skill",
        requiredPermission: "skill.use",
        availability: "unavailable",
        unavailableReason: "SKILL_NOT_SELECTED",
        description: "解析并注入当前会话可用的 skill 工作流。",
        inputSchema: {
            type: "object",
            required: [
                "skillId",
                "request",
            ],
            properties: {
                skillId: {
                    type: "string",
                    description: "要使用的 skill ID。",
                },
                request: {
                    type: "string",
                    description: "请求 skill 处理的任务摘要。",
                },
            },
        },
        riskLevel: "low",
        scope: "session",
        approvalRequired: false,
        displayText: "使用 skill",
    },
];

/**
 * listUnifiedToolCapabilities：读取统一工具能力注册表。
 *
 * @returns 工具能力副本。
 */
export function listUnifiedToolCapabilities(): UnifiedToolCapability[] {
    return UNIFIED_TOOL_CAPABILITY_REGISTRY.map((capability) => ({
        ...capability,
    }));
}

/**
 * resolveUnifiedToolCapability：按工具 ID 读取注册能力。
 *
 * @param toolId 工具 ID。
 * @returns 工具能力；不存在时返回 null。
 */
export function resolveUnifiedToolCapability(toolId: string): UnifiedToolCapability | null {
    return listUnifiedToolCapabilities().find((capability) => {
        return capability.toolId === toolId;
    }) ?? null;
}

/**
 * toModelSafeToolName：把中心服务内部工具 ID 转成模型协议安全名称。
 *
 * @param toolId 中心服务内部工具 ID。
 * @returns 只包含字母、数字、下划线或连字符的模型工具名。
 */
export function toModelSafeToolName(toolId: string): string {
    // safeName: OpenAI 兼容工具名不允许点号，统一替换成下划线并保留可读来源。
    return toolId.replace(/[^a-zA-Z0-9_-]/gu, "_");
}
