/**
 * 阶段 12 输入框、附件与引用协议检查。
 *
 * 用途：验证共享 UI 输入框草稿协议、临时附件和正式附件保存接口。
 * 关键逻辑：创建草稿、发送消息、创建临时附件并转正式附件。
 * 参数：无。
 * 返回值：检查通过时正常退出；任一断言失败时抛错并返回非零退出码。
 */
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";

import { CENTER_DATA_DIR_NAME, type ApiResponse } from "@zhixin/shared";
import { canSendComposerDraft, createEmptyComposerDraft } from "../packages/ui/src/index";
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
    /createTemporaryAttachment/u,
    /commitAttachment/u,
    /insertIdeContextReference/u,
    /registerRuntimeProject/u,
    /createProjectConversationTab/u,
    /window\.addEventListener\("message"/u,
    /references/u,
    /attachments/u,
  ], "前端输入框状态层");
  assertFileContains("apps/frontend/src/views/MainView.vue", [
    /@paste="appStore\.handleComposerPaste"/u,
    /project-reference-popover/u,
    /v-if="appStore\.canUseProjectReferences/u,
    /新建项目页签/u,
    /composer-reference-tag/u,
    /composer-attachment-tag/u,
  ], "前端输入框界面");
  assertFileContains("apps/frontend/src/runtime.ts", [
    /projectContext/u,
    /projectId/u,
    /projectName/u,
    /projectPath/u,
  ], "前端插件运行时项目上下文");
  assertFileContains("packages/api-client/src/index.ts", [
    /createTemporaryAttachment/u,
    /commitAttachment/u,
    /FormData/u,
    /\/api\/file\/temp\/create/u,
    /\/api\/session\/attachment\/commit/u,
  ], "前端 API 客户端");

  const draft = createEmptyComposerDraft();
  assert(!canSendComposerDraft(draft), "空草稿不应允许发送");
  draft.text = "附件检查";
  assert(canSendComposerDraft(draft), "有文本草稿应允许发送");

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

    const temporary = (await service.app.inject({
      method: "POST",
      url: "/api/file/temp/create",
      payload: {
        fileName: "check.png",
        mimeType: "image/png",
        sizeBytes: 10,
      },
    })).json<ApiResponse<{ temporaryAttachmentId: string; relativePath: string }>>();
    assert(temporary.success, "临时附件创建失败");
    await stat(join(centerDirectory, temporary.data?.relativePath ?? ""));

    const committed = (await service.app.inject({
      method: "POST",
      url: "/api/session/attachment/commit",
      payload: {
        sessionId: session.data?.sessionId,
        messageId: message.data?.messageId,
        temporaryAttachmentId: temporary.data?.temporaryAttachmentId,
        fileName: "check.png",
        mimeType: "image/png",
        sizeBytes: 10,
      },
    })).json<ApiResponse<{ attachmentId: string; relativePath: string }>>();
    assert(committed.success, "正式附件保存失败");
    await stat(join(centerDirectory, committed.data?.relativePath ?? ""));
  } finally {
    await service?.close().catch(() => {});
    await rm(tempRoot, {
      force: true,
      recursive: true,
    });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
