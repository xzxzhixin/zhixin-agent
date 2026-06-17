/**
 * 阶段 12 输入框、附件与引用协议检查。
 *
 * 用途：验证共享 UI 输入框草稿协议、临时附件和正式附件保存接口。
 * 关键逻辑：创建草稿、发送消息、创建临时附件并转正式附件。
 * 参数：无。
 * 返回值：检查通过时正常退出；任一断言失败时抛错并返回非零退出码。
 */
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";

import { CENTER_DATA_DIR_NAME, type ApiResponse } from "@zhixin/shared";
import {
  canSendComposerDraft,
  createEmptyComposerDraft,
  renderComposerDraftMarkdown,
  type ComposerAttachmentDraft,
  type ComposerReferenceDraft,
} from "../packages/ui/src/index";
import {
  type CenterService,
  createCenterService,
  readCenterServiceConfig,
} from "../services/center/src/index";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertFileContains(filePath: string, patterns: RegExp[], purpose: string): void {
  const content = readFileSync(resolve(filePath), "utf-8");
  for (const pattern of patterns) {
    assert(pattern.test(content), `${purpose} 缺少 ${pattern.source}`);
  }
}

async function main(): Promise<void> {
  assertFileContains("apps/frontend/src/stores/app.ts", [
    /handleComposerPaste/u,
    /insertIdeContextReference/u,
    /registerRuntimeProject/u,
    /createProjectConversationTab/u,
    /window\.addEventListener\("message"/u,
    /references/u,
    /attachments/u,
  ], "前端输入框状态层");
  assertFileContains("apps/frontend/src/stores/app-conversation-actions.ts", [
    /attachment\.temporary\.create/u,
    /attachment\.commit/u,
    /requireRealtimeRequest/u,
    /addClipboardImageAttachment/u,
    /temporaryRelativePath/u,
    /buildComposerMessageMarkdown|renderComposerDraftMarkdown/u,
    /type:\s*"attachment"/u,
  ], "前端输入框附件动作层");
  assertFileContains("apps/frontend/src/stores/app.ts", [
    /parts\.push/u,
    /type:\s*"reference"/u,
  ], "前端输入框引用状态层");
  assertFileContains("packages/ui/src/index.ts", [
    /ComposerDraftPart/u,
    /parts:\s*ComposerDraftPart\[\]/u,
  ], "共享输入框结构化草稿协议");
  assertFileContains("services/center/src/api/sync-route.ts", [
    /attachment\.temporary\.create/u,
    /attachment\.commit/u,
    /createTemporaryAttachmentFromRealtime/u,
    /commitAttachmentFromRealtime/u,
  ], "中心服务附件实时通道");
  assertFileContains("apps/frontend/src/views/Chat/RouterIndex.vue", [
    /@paste="appStore\.handleComposerPaste"/u,
  ], "前端移动输入框界面");
  assertFileContains("apps/frontend/src/views/Chat/components/ChatConversationPanel.vue", [
    /appStore\.handleComposerPaste/u,
    /floating-picker/u,
    /v-if="!isAgentConversation && appStore\.canUseProjectReferences/u,
    /composer-reference-tag/u,
    /composer-attachment-tag|temporaryAttachmentId/u,
  ], "前端完整输入框界面");
  assertFileContains("apps/frontend/src/runtime.ts", [
    /projectContext/u,
    /projectId/u,
    /projectName/u,
    /projectPath/u,
  ], "前端插件运行时项目上下文");
  assertFileContains("packages/api-client/src/index.ts", [
    /createTemporaryAttachment/u,
    /commitAttachment/u,
    /\/api\/file\/temp\/create/u,
    /\/api\/session\/attachment\/commit/u,
  ], "前端 API 客户端");

  const draft = createEmptyComposerDraft();
  assert(!canSendComposerDraft(draft), "空草稿不应允许发送");
  draft.text = "附件检查";
  assert(canSendComposerDraft(draft), "有文本草稿应允许发送");
  assert(Array.isArray(draft.parts), "空草稿必须包含 parts 数组");

  const behaviorAttachment: ComposerAttachmentDraft = {
    temporaryAttachmentId: "temporary-behavior-attachment",
    temporaryRelativePath: "temp/temporary-behavior-attachment/check.png",
    fileName: "check.png",
    mimeType: "image/png",
    sizeBytes: 10,
  };
  const behaviorReference: ComposerReferenceDraft = {
    type: "file",
    link: {
      projectId: "project-check",
      absolutePath: "D:/project/check.ts",
      relativePath: "check.ts",
      startLine: null,
      endLine: null,
    },
    displayName: "check.ts",
  };
  draft.attachments.push(behaviorAttachment);
  draft.references.push(behaviorReference);
  assert(
    renderComposerDraftMarkdown(draft) === [
      "附件检查",
      `[@check.ts](zhixin-file:${encodeURIComponent(JSON.stringify(behaviorReference.link))})`,
      "![check.png](temp://temporary-behavior-attachment)",
    ].join("\n\n"),
    "parts 为空时必须继续兼容旧文本、引用、附件顺序",
  );
  draft.parts.push({
    type: "attachment",
    attachment: behaviorAttachment,
  });
  draft.parts.push({
    type: "reference",
    reference: behaviorReference,
  });
  assert(
    renderComposerDraftMarkdown(draft) === [
      "附件检查",
      "![check.png](temp://temporary-behavior-attachment)",
      `[@check.ts](zhixin-file:${encodeURIComponent(JSON.stringify(behaviorReference.link))})`,
    ].join("\n\n"),
    "parts 有内容且没有 text part 时必须保留当前 textarea 文本并按结构化顺序追加片段",
  );
  draft.parts = [
    {
      type: "attachment",
      attachment: behaviorAttachment,
    },
  ];
  draft.parts.push({
    type: "text",
    text: "中间文本",
  });
  draft.parts.push({
    type: "reference",
    reference: behaviorReference,
  });
  assert(
    renderComposerDraftMarkdown(draft) === [
      "![check.png](temp://temporary-behavior-attachment)",
      "中间文本",
      `[@check.ts](zhixin-file:${encodeURIComponent(JSON.stringify(behaviorReference.link))})`,
    ].join("\n\n"),
    "parts 包含 text part 时必须按结构化输入顺序构造 Markdown",
  );

  const tempRoot = await mkdtemp(join(tmpdir(), "zhixin-composer-"));
  const centerDirectory = join(tempRoot, CENTER_DATA_DIR_NAME);
  let service: CenterService | null = null;

  try {
    service = await createCenterService(readCenterServiceConfig({
      cwd: tempRoot,
      env: {
        ZHIXIN_CENTER_DIR: centerDirectory,
      },
    }));
    await service.initialize();

    const session = (await service.app.inject({
      method: "POST",
      url: "/api/session/create",
      payload: {
        sessionType: "normal",
        projectId: null,
        title: "附件会话",
      },
    })).json<ApiResponse<{ sessionId: string }>>();
    assert(session.success, "附件会话创建失败");

    const message = (await service.app.inject({
      method: "POST",
      url: "/api/session/message/send",
      payload: {
        sessionId: session.data?.sessionId,
        contentMarkdown: draft.text,
      },
    })).json<ApiResponse<{ messageId: string }>>();
    assert(message.success, "附件消息发送失败");

    const outsideFilePath = join(tempRoot, "outside-file");
    await writeFile(
      outsideFilePath,
      "outside-file-content",
      "utf-8",
    );
    const maliciousCommitted = (await service.app.inject({
      method: "POST",
      url: "/api/session/attachment/commit",
      payload: {
        sessionId: session.data?.sessionId,
        messageId: message.data?.messageId,
        temporaryAttachmentId: "malicious-temporary",
        temporaryRelativePath: "../outside-file",
        fileName: "outside-file.txt",
        mimeType: "text/plain",
        sizeBytes: 20,
      },
    })).json<ApiResponse<{
      attachmentId: string;
      relativePath: string;
      archivePath: string;
    }>>();
    assert(
      !maliciousCommitted.success,
      "穿越中心目录的临时附件路径必须被拒绝",
    );
    await stat(outsideFilePath);

    const temporary = (await service.app.inject({
      method: "POST",
      url: "/api/file/temp/create",
      payload: {
        fileName: "check.png",
        mimeType: "image/png",
        sizeBytes: 10,
      },
    })).json<ApiResponse<{
      temporaryAttachmentId: string;
      relativePath: string;
    }>>();
    assert(temporary.success, "临时附件创建失败");
    const temporaryAttachmentId = temporary.data?.temporaryAttachmentId ?? "";
    const temporaryRelativePath = temporary.data?.relativePath ?? "";
    assert(
      temporaryRelativePath.includes(`temp/${temporaryAttachmentId}/`),
      "临时附件必须保存在 temp/{temporaryAttachmentId}/ 草稿目录",
    );
    await stat(join(centerDirectory, temporaryRelativePath));

    const missingTemporaryPath = (await service.app.inject({
      method: "POST",
      url: "/api/session/attachment/commit",
      payload: {
        sessionId: session.data?.sessionId,
        messageId: message.data?.messageId,
        temporaryAttachmentId,
        fileName: "missing-path.png",
        mimeType: "image/png",
        sizeBytes: 10,
      },
    })).json<ApiResponse<{
      attachmentId: string;
      relativePath: string;
      archivePath: string;
    }>>();
    assert(
      !missingTemporaryPath.success,
      "缺少 temporaryRelativePath 时必须拒绝提交附件",
    );

    const committed = (await service.app.inject({
      method: "POST",
      url: "/api/session/attachment/commit",
      payload: {
        sessionId: session.data?.sessionId,
        messageId: message.data?.messageId,
        temporaryAttachmentId,
        temporaryRelativePath,
        fileName: "check.png",
        mimeType: "image/png",
        sizeBytes: 10,
      },
    })).json<ApiResponse<{
      attachmentId: string;
      relativePath: string;
      archivePath: string;
    }>>();
    assert(committed.success, "正式附件保存失败");
    assert(committed.data?.archivePath !== undefined, "正式附件必须返回 archivePath");
    assert(
      committed.data.archivePath.includes("memory/attachments"),
      "正式附件必须归档到 memory/attachments",
    );
    assert(
      committed.data.relativePath === committed.data.archivePath,
      "兼容字段 relativePath 必须等于 archivePath",
    );
    await stat(join(centerDirectory, committed.data.archivePath));
  } finally {
    await service?.close().catch(() => {});
  }
  console.log("check-composer-attachments: ok");
}

void main().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
