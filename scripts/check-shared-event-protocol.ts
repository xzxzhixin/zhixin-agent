import {readFileSync} from "node:fs";

/**
 * readSource：读取源码文本。
 *
 * @param path 仓库内相对路径。
 * @returns 文件 UTF-8 文本。
 */
function readSource(path: string): string {
    return readFileSync(
        path,
        "utf-8",
    );
}

/**
 * assertIncludes：断言源码包含指定片段。
 *
 * @param source 源码文本。
 * @param fragment 必须存在的片段。
 * @param message 失败提示。
 */
function assertIncludes(
    source: string,
    fragment: string,
    message: string,
): void {
    if (!source.includes(fragment)) {
        throw new Error(message);
    }
}

/**
 * assertNoLiteral：断言指定源码不再直接写协议字面量。
 *
 * @param path 源码路径。
 * @param source 源码文本。
 * @param literal 禁止直接出现的协议字面量。
 */
function assertNoLiteral(
    path: string,
    source: string,
    literal: string,
): void {
    if (source.includes(literal)) {
        throw new Error(`${path} 仍直接硬编码共享协议字面量：${literal}`);
    }
}

const sharedProtocol = readSource("packages/shared/src/event-protocol.ts");

for (const fragment of [
    "EVENT_TYPES",
    "KnownEventType",
    "EVENT_TYPE_PREFIXES",
    "EVENT_TYPE_SUFFIXES",
    "EVENT_SCOPE_TYPES",
    "EventScopeType",
    "TASK_STATUSES",
    "CONVERSATION_TURN_STATUSES",
    "AGENT_RUNTIME_STATUSES",
    "FINAL_TASK_STATUSES",
    "FINAL_TURN_STATUSES",
]) {
    assertIncludes(
        sharedProtocol,
        fragment,
        `共享事件协议缺少导出：${fragment}`,
    );
}

const sharedIndex = readSource("packages/shared/src/index.ts");
assertIncludes(
    sharedIndex,
    "from \"./event-protocol.js\"",
    "packages/shared/src/index.ts 必须导出共享事件协议。",
);

const productionFiles = [
    "apps/frontend/src/stores/app-conversation-actions.ts",
    "apps/frontend/src/stores/TurnStateReconciler.ts",
    "services/center/src/domain/session-domain.ts",
    "services/center/src/deepagents-agent.ts",
    "services/center/src/events.ts",
    "services/center/src/realtime.ts",
    "services/center/src/data-access/event-repository.ts",
    "services/center/src/StructuredTool/CenterStructuredToolBase.ts",
    "services/center/src/StructuredTool/McpToolWrapperStructuredTool.ts",
    "services/center/src/StructuredTool/command-tool-executor.ts",
    "services/center/src/AgentMiddleware/CenterToolChoiceMiddleware.ts",
    "services/center/src/AgentMiddleware/CenterModelRetryMiddleware.ts",
];

const forbiddenProtocolLiterals = [
    "\"turn.state.changed\"",
    "\"message.turn.failed\"",
    "\"model.stream.completed\"",
    "\"tool.plan.failed\"",
    "\"tool.command.\"",
    "\"tool.mcp.\"",
    "\"model.tool.\"",
    "\"task.step.\"",
    "\".failed\"",
    "\".completed\"",
    "\"waiting_user\"",
    "scopeType: \"turn\"",
    "scopeType: \"task\"",
    "scopeType: \"tool\"",
    "scopeType: \"model\"",
    "scopeType: \"agent\"",
    "scopeType: \"session\"",
];

for (const path of productionFiles) {
    const source = readSource(path);
    assertIncludes(
        source,
        "@zhixin/shared",
        `${path} 必须从 @zhixin/shared 引入共享协议常量。`,
    );
    for (const literal of forbiddenProtocolLiterals) {
        assertNoLiteral(
            path,
            source,
            literal,
        );
    }
}

const chatViewHelpers = readSource("apps/frontend/src/views/Chat/chat-view-helpers.ts");
for (const literal of [
    "\"message.turn.failed\"",
    "\"worker.task.failed\"",
    "\"model.stream.delta\"",
    "\"tool.command.\"",
    "\"tool.mcp.\"",
    "\"model.tool.\"",
    "\"task.step.\"",
    "\"waiting_user\"",
]) {
    assertNoLiteral(
        "apps/frontend/src/views/Chat/chat-view-helpers.ts",
        chatViewHelpers,
        literal,
    );
}

console.log("check-shared-event-protocol passed");
