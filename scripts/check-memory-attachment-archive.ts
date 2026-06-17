/**
 * 附件来源长期记忆静态回归检查。
 *
 * 用途：验证附件来源会进入 Markdown 记忆、轮次副作用和 Mem0 metadata。
 * 关键逻辑：只检查源码结构和关键事件名，不依赖模型供应商或中心服务启动。
 * 参数：无。
 * 返回值：检查通过时正常退出；任一断言失败时抛错并返回非零退出码。
 */
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

function readSource(relativePath: string): string {
    return readFileSync(
        resolve(relativePath),
        "utf-8",
    );
}

function assertContains(
    source: string,
    pattern: RegExp,
    message: string,
): void {
    assert(
        pattern.test(source),
        message,
    );
}

function main(): void {
    const attachmentMemoryService = readSource("services/center/src/domain/AttachmentMemoryService.ts");
    const agentDomain = readSource("services/center/src/domain/agent-domain.ts");
    const sessionTurnEffects = readSource("services/center/src/domain/session-turn-effects.ts");
    const memoryEngine = readSource("services/center/src/memory-engine.ts");

    assertContains(
        attachmentMemoryService,
        /export\s+class\s+AttachmentMemoryService/u,
        "必须存在 AttachmentMemoryService 类。",
    );
    assertContains(
        attachmentMemoryService,
        /export\s+interface\s+AttachmentMemorySource/u,
        "必须定义 AttachmentMemorySource 接口。",
    );
    assertContains(
        attachmentMemoryService,
        /messages\.turn_id\s*=\s*\?/u,
        "附件来源查询必须通过 messages.turn_id 限定轮次。",
    );
    assertContains(
        attachmentMemoryService,
        /attachments\.message_id\s*=\s*messages\.id/u,
        "附件来源查询必须通过 attachments.message_id = messages.id 关联正式消息。",
    );
    assertContains(
        agentDomain,
        /attachmentSources\?:\s*AttachmentMemorySource\[\]/u,
        "MemoryWriteInput 必须包含 attachmentSources 字段。",
    );
    assert(
        !/attachmentRefsJson\?:/u.test(agentDomain),
        "MemoryWriteInput 不允许继续暴露 attachmentRefsJson 输入字段，附件引用必须由 attachmentSources 单一路径生成。",
    );
    assertContains(
        agentDomain,
        /const\s+attachmentRefsJson\s*=\s*JSON\.stringify\(\s*attachmentSources\s*\)/u,
        "attachmentRefsJson 必须只由 attachmentSources 序列化生成。",
    );
    assert(
        !/input\.attachmentRefsJson/u.test(agentDomain),
        "writeAgentMemory 不允许使用旧 input.attachmentRefsJson 兜底。",
    );
    assertContains(
        agentDomain,
        /## 附件来源/u,
        "writeAgentMemory 写入 Markdown 时必须包含附件来源小节。",
    );
    assertContains(
        agentDomain,
        /"```json"/u,
        "附件来源小节必须使用 fenced JSON，避免附件名或路径破坏 Markdown。",
    );
    assertContains(
        agentDomain,
        /return\s+\[\s*"```json"[\s\S]*JSON\.stringify\(\s*attachmentSources/u,
        "renderAttachmentMemorySources 必须输出 attachmentSources 对应的 JSON 数组。",
    );
    assertContains(
        agentDomain,
        /enterMemoryQueue\(memoryQueues,\s*input\.agentId\)/u,
        "writeAgentMemory 入队必须直接使用必填 agentId，不能用空字符串兜底。",
    );
    assert(
        !/(请只回复|实时刷新验证|回归验证|数据库恢复|完成事件复测|桌面壳实时刷新验证|不知道你的真实身份|不知道你的姓名|无法确认你的真实身份|无法确认你的姓名|我叫 ChatGPT|我是 ChatGPT)/u.test(sessionTurnEffects),
        "session-turn-effects 不允许按固定用户提示词、验收词或身份词过滤长期记忆。",
    );
    assertContains(
        sessionTurnEffects,
        /function\s+looksLikeGenericFailureReply/u,
        "session-turn-effects 必须使用通用失败回复过滤替代固定身份词过滤。",
    );
    assertContains(
        sessionTurnEffects,
        /AttachmentMemoryService/u,
        "commitMainAgentMemoryAfterTurn 必须使用 AttachmentMemoryService 读取正式附件来源。",
    );
    assertContains(
        memoryEngine,
        /attachments/u,
        "memory-engine 的 Mem0 metadata 必须包含 attachments。",
    );
    assertContains(
        sessionTurnEffects + agentDomain + memoryEngine + attachmentMemoryService,
        /memory\.attachment\.summary\.skipped/u,
        "必须预留 memory.attachment.summary.skipped 事件。",
    );

    console.log("check-memory-attachment-archive: ok");
}

try {
    main();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
