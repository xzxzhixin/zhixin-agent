# 记忆召回与富文本输入框实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 实现跨窗口长期记忆召回、富文本输入框结构化消息事实、单份归档附件引用和附件记忆写入。

**架构：** 前端输入框继续负责草稿编辑，中心服务在发送后把草稿固化为正式消息事实。临时附件发送后移动到 `center-data/memory/attachments` 归档目录，会话消息和长期记忆都引用同一份归档附件；轮次完成后用 Markdown、SQLite `memory_index` 和 Mem0 写入与召回长期记忆。

**技术栈：** Vue 3、Pinia、Fastify WebSocket、better-sqlite3、Node.js fs/path、Mem0 OSS、Deep Agents、项目现有 `scripts/check-*.ts/mjs` 回归检查风格、IDEA Run Configuration、Chrome DevTools。

---

## 规格与约束

- 规格文件：`docs/superpowers/specs/2026-06-17-memory-recall-rich-composer-design.md`。
- 项目事实源必须同步：`需求.md`、`设计.md`、`架构.md`、`功能清单与关系.md`。
- `总体计划.md` 仅用户可修改，本计划不修改。
- 不使用新 worktree，直接在当前仓库修改。
- 不直接终端启动项目；启动必须使用 IDEA Run Configuration。
- 已存在 IDEA Run Configuration：`dev:frontend`、`dev:desktop-shell`。
- 浏览器验收必须使用 Chrome DevTools 真实点击、粘贴、输入和发送。
- 不加入 `tsc --noEmit`、`vue-tsc` 或项目级 TS 编译质量门槛。
- 新增和修改代码必须有中文注释。
- 不删除用户已有未提交改动：当前已知 `提示词模板.md` 修改、`本次计划.md` 删除。

## 文件结构

### 文档事实源

- 修改：`需求.md`
  - 增补跨窗口记忆召回、正式附件归档、会话引用归档附件、附件内容摘要记忆、草稿不入记忆的需求条目。
- 修改：`设计.md`
  - 新增一级标题“记忆召回与富文本输入框关联设计”，承接规格中的目标、范围、设计要点和验收口径。
- 修改：`架构.md`
  - 更新中心目录结构：正式附件从 `sessions/attachments` 调整为 `memory/attachments`。
  - 说明 `attachments` 表保存引用关系，删除会话只删除引用，不删除归档文件。
- 修改：`功能清单与关系.md`
  - 新增或修订单一可回归功能：富文本输入框结构化草稿、归档附件引用、附件记忆写入、跨窗口记忆召回。

### 共享协议与前端

- 修改：`packages/ui/src/index.ts`
  - 为输入框草稿新增片段顺序模型 `ComposerDraftPart`，保留旧字段兼容期间仅作为派生视图。
- 修改：`packages/api-client/src/index.ts`
  - 更新 `CommittedAttachmentResult` 注释和字段，补充 `archivePath`、`attachmentId`、来源追溯含义。
- 修改：`apps/frontend/src/stores/app-conversation-actions.ts`
  - 发送消息后提交附件时接收归档附件元数据。
  - 后续富文本输入框改造时保持片段顺序，不直接写记忆。
- 修改：`apps/frontend/src/views/Chat/components/ChatConversationPanel.vue`
  - 把附件、引用从输入框上方标签逐步迁移到片段化展示入口。
  - 保持现有 `textarea` 第一阶段可用，新增片段结构不阻塞发送。

### 中心服务附件与消息事实

- 修改：`services/center/src/domain/usage-domain.ts`
  - `createTemporaryAttachment` 保存真实临时附件文件元数据。
  - `commitAttachment` 从 `center-data/temp` 移动到 `center-data/memory/attachments/{year}/{month}/{day}/{attachmentId}/原文件名`。
  - 返回 `archivePath`，并写入附件提交事件。
- 修改：`services/center/src/api/sync-route.ts`
  - `attachment.temporary.create` 和 `attachment.commit` 请求/响应字段与归档路径一致。
- 修改：`services/center/src/data-access/usage-repository.ts`
  - `attachments` 表继续保存引用关系，新增需要的来源字段时通过迁移处理。
- 修改：`services/center/src/data-access/session-repository.ts`
  - 删除会话时只删除附件引用，不删除归档文件。
- 创建：`services/center/src/domain/AttachmentArchiveService.ts`
  - 单 class 文件，封装附件归档路径、移动、文件名清理和来源元数据。
- 创建：`services/center/src/domain/AttachmentMemoryService.ts`
  - 单 class 文件，封装附件来源记忆写入和附件摘要事件入口。

### 记忆写入与召回

- 修改：`services/center/src/domain/session-turn-effects.ts`
  - 轮次完成后同时写入文本事实和正式附件来源记忆。
- 修改：`services/center/src/domain/agent-domain.ts`
  - `MemoryWriteInput` 增补附件来源元数据。
  - Markdown 记忆段落增加“附件来源”小节。
- 修改：`services/center/src/model-gateway-runtime.ts`
  - 移除身份类专项硬编码检索词，改为通用查询扩展。
  - 召回结果包含来源会话、轮次、消息、附件 ID、附件名和 Markdown 路径。
- 修改：`services/center/src/memory-engine.ts`
  - Mem0 metadata 增加附件来源字段。

### 回归检查

- 创建：`scripts/check-memory-attachment-archive.ts`
  - 验证临时附件转归档目录、会话引用保留、删除会话不删除归档文件。
- 创建：`scripts/check-memory-recall-cross-window.mjs`
  - 静态和轻量数据回归：确认召回入口同时使用 Mem0、SQLite 索引、Markdown 来源，且不保留固定身份/业务词硬编码召回。
- 修改：`scripts/check-all.mjs`
  - 纳入新增检查脚本。

---

### 任务 1：同步事实源文档

**文件：**
- 修改：`需求.md`
- 修改：`设计.md`
- 修改：`架构.md`
- 修改：`功能清单与关系.md`

- [ ] **步骤 1：更新 `需求.md`**

加入单层清单条目，内容必须覆盖：

```md
- ⏳ 富文本输入框发送前的文本、附件、文件引用、代码位置和 IDE 选区只属于草稿，不能写入长期记忆。
- ⏳ 用户发送消息后，中心服务必须把草稿固化为正式消息事实，包含文本、归档附件引用、项目引用和代码引用来源。
- ⏳ 正式附件文件只保存一份，归档到 `center-data/memory/attachments/{year}/{month}/{day}/{attachmentId}/原文件名`，会话消息和长期记忆都引用该归档附件。
- ⏳ 删除会话只删除会话和附件引用关系，不删除已经归档并可被长期记忆引用的附件文件。
- ⏳ 轮次完成后，长期记忆必须写入可复用文本事实和正式附件来源引用；可解析附件需要异步写入内容摘要，摘要失败不得影响主轮次终态。
- ⏳ 跨窗口对话前必须通过 Mem0、SQLite `memory_index` 和 Markdown 来源联合召回长期记忆，不能依赖固定身份问题、固定业务词或用户提示词硬编码。
```

- [ ] **步骤 2：更新 `设计.md`**

新增一级标题，结构必须包含“目标、范围、设计要点、验收口径、清单状态”。设计要点必须写入：

```md
# 记忆召回与富文本输入框关联设计

## 目标

- ⏳ 让富文本输入框产出的正式消息事实成为长期记忆写入来源。
- ⏳ 让跨窗口对话能通过 Mem0、SQLite 和 Markdown 召回文本事实、附件来源和附件摘要。

## 范围

- ⏳ 覆盖结构化草稿、正式消息事实、归档附件、附件记忆写入和跨窗口召回。
- ⏳ 不覆盖附件解析供应商选择和附件清理 UI。
```

- [ ] **步骤 3：更新 `架构.md`**

在中心目录结构中把附件说明改为：

```text
memory
├─ attachments：正式归档附件目录，会话消息和长期记忆通过附件 ID 引用同一份文件。
```

把 `sessions/attachments` 的说明改为“历史会话附件目录，后续正式附件归档迁移到 `memory/attachments`，会话只保存引用关系”。同时在 SQLite 状态表说明里补充 `attachments` 表是引用索引，不拥有归档文件生命周期。

- [ ] **步骤 4：更新 `功能清单与关系.md`**

新增或修订以下行：

```md
- 富文本输入框结构化消息事实 - 依赖 `packages/ui/src/index.ts` 草稿协议、`apps/frontend/src/views/Chat/components/ChatConversationPanel.vue` 输入区和 `apps/frontend/src/stores/app-conversation-actions.ts` 发送链路；影响附件、项目引用、代码引用和消息展示；修改后至少回归纯文本发送、附件发送、代码引用插入、发送前草稿不入记忆。
- 归档附件引用 - 依赖 `services/center/src/domain/AttachmentArchiveService.ts`、`services/center/src/domain/usage-domain.ts` 和 `attachments` 表；影响临时附件转正、会话删除、中心目录迁移和附件记忆来源；修改后至少回归附件只保存一份、会话删除不删除归档文件、会话消息仍能展示附件。
- 附件记忆写入 - 依赖 `services/center/src/domain/AttachmentMemoryService.ts`、`services/center/src/domain/session-turn-effects.ts`、`services/center/src/domain/agent-domain.ts` 和 `services/center/src/memory-engine.ts`；影响 Markdown 记忆、SQLite `memory_index` 和 Mem0 metadata；修改后至少回归附件来源写入、附件摘要成功追加、附件摘要失败不影响轮次。
- 跨窗口长期记忆召回 - 依赖 `services/center/src/model-gateway-runtime.ts`、`services/center/src/memory-engine.ts` 和 SQLite `memory_index`；影响普通对话、项目对话和多窗口上下文；修改后至少回归窗口 A 说“我今天吃了龙虾”、窗口 B 问“我今天吃了什么”能召回，且源码不保留固定身份或业务词硬编码召回。
```

- [ ] **步骤 5：Commit 文档同步**

```bash
git add 需求.md 设计.md 架构.md 功能清单与关系.md
git commit -m "docs: 同步记忆召回与附件归档设计"
```

### 任务 2：归档附件服务与附件提交链路

**文件：**
- 创建：`services/center/src/domain/AttachmentArchiveService.ts`
- 修改：`services/center/src/domain/usage-domain.ts`
- 修改：`services/center/src/api/sync-route.ts`
- 修改：`packages/api-client/src/index.ts`

- [ ] **步骤 1：创建归档服务文件**

创建 `services/center/src/domain/AttachmentArchiveService.ts`：

```ts
import {
    existsSync,
    mkdirSync,
    renameSync,
} from "node:fs";
import {
    basename,
    dirname,
    join,
} from "node:path";

import {
    formatLocalDateParts,
} from "../time.js";

/**
 * AttachmentArchiveResult：正式归档附件结果。
 *
 * 来源：输入框临时附件提交。
 * 含义：描述归档附件在中心目录中的唯一文件位置。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：archivePath 必须是相对中心目录路径，供会话和记忆共同引用。
 */
export interface AttachmentArchiveResult {
    /** attachmentId: 正式附件 ID。 */
    attachmentId: string;
    /** archivePath: 正式归档附件相对中心目录路径。 */
    archivePath: string;
    /** originalFileName: 用户原始文件名。 */
    originalFileName: string;
}

/**
 * AttachmentArchiveService：归档输入框正式附件。
 */
export class AttachmentArchiveService {
    /**
     * constructor：保存中心目录。
     *
     * @param centerDirectory 中心目录绝对路径。
     */
    constructor(private readonly centerDirectory: string) {}

    /**
     * moveTemporaryToArchive：把临时附件移动为唯一归档附件。
     *
     * @param temporaryRelativePath 临时附件相对中心目录路径。
     * @param attachmentId 正式附件 ID。
     * @param originalFileName 用户原始文件名。
     * @returns 归档附件结果。
     */
    moveTemporaryToArchive(
        temporaryRelativePath: string,
        attachmentId: string,
        originalFileName: string,
    ): AttachmentArchiveResult {
        const temporaryPath = join(
            this.centerDirectory,
            temporaryRelativePath,
        );
        if (!existsSync(temporaryPath)) {
            throw new Error("TEMP_ATTACHMENT_NOT_FOUND");
        }
        const dateParts = formatLocalDateParts();
        const safeFileName = this.normalizeFileName(originalFileName);
        const archivePath = join(
            "memory",
            "attachments",
            dateParts.year,
            dateParts.month,
            dateParts.day,
            attachmentId,
            safeFileName,
        ).replace(/\\/gu, "/");
        const absoluteArchivePath = join(
            this.centerDirectory,
            archivePath,
        );
        mkdirSync(dirname(absoluteArchivePath), {
            recursive: true,
        });
        renameSync(
            temporaryPath,
            absoluteArchivePath,
        );
        return {
            attachmentId,
            archivePath,
            originalFileName: safeFileName,
        };
    }

    /**
     * normalizeFileName：保留文件名并移除路径片段。
     *
     * @param fileName 用户传入文件名。
     * @returns 可写入归档目录的文件名。
     */
    private normalizeFileName(fileName: string): string {
        const normalized = basename(fileName).trim();
        return normalized.length > 0
            ? normalized
            : "attachment.bin";
    }
}
```

如果 `services/center/src/time.ts` 没有 `formatLocalDateParts()`，本步骤同时新增：

```ts
/**
 * formatLocalDateParts：返回中心服务本机日期目录片段。
 *
 * @returns 年月日目录片段。
 */
export function formatLocalDateParts(): {
    /** year: 四位年份。 */
    year: string;
    /** month: 两位月份。 */
    month: string;
    /** day: 两位日期。 */
    day: string;
} {
    const now = moment();
    return {
        year: now.format("YYYY"),
        month: now.format("MM"),
        day: now.format("DD"),
    };
}
```

- [ ] **步骤 2：修改临时附件创建为真实文件保存**

在 `services/center/src/domain/usage-domain.ts` 中检查 `createTemporaryAttachment`。如果当前只写占位 JSON，改为写入前端上传的真实文件数据。WebSocket 传 File 时不能直接跨进程传二进制，第一阶段允许保存结构化占位，但必须把字段命名为临时文件事实，并在注释中说明后续由浏览器文件上传通道替换；不得把占位误称为真实附件内容。

最小实现要求：

```ts
const relativePath = `temp/${temporaryAttachmentId}/${storageFileName}`;
```

并确保注释说明 `temp` 是草稿目录，不能进入长期记忆。

- [ ] **步骤 3：修改附件提交路径**

在 `commitAttachment` 中：

```ts
const attachmentId = randomUUID();
const archiveService = new AttachmentArchiveService(centerDirectory);
const archived = archiveService.moveTemporaryToArchive(
    `temp/${input.temporaryAttachmentId}/${input.storageFileName}`,
    attachmentId,
    input.fileName,
);
```

写入 `attachments` 表时使用：

```ts
relativePath: archived.archivePath,
```

返回：

```ts
return {
    attachmentId,
    relativePath: archived.archivePath,
    archivePath: archived.archivePath,
};
```

- [ ] **步骤 4：更新 WebSocket 请求字段**

在 `services/center/src/api/sync-route.ts` 的 `commitAttachmentFromRealtime` 中，要求 payload 携带 `temporaryRelativePath` 或能由 `temporaryAttachmentId` 查出临时文件路径。字段不确定时使用单一协议字段：

```ts
/** temporaryRelativePath: 临时附件相对中心目录路径，来源于 attachment.temporary.create 返回值。 */
temporaryRelativePath?: string;
```

同时更新 `apps/frontend/src/stores/app-conversation-actions.ts`，把 `temporary.relativePath` 保存到草稿附件里。

- [ ] **步骤 5：更新 API 类型注释**

在 `packages/api-client/src/index.ts` 中把 `CommittedAttachmentResult` 改为：

```ts
export interface CommittedAttachmentResult {
  /** attachmentId: 正式附件 ID，来源于中心服务生成。 */
  attachmentId: string;
  /** relativePath: 兼容字段，等同于 archivePath。 */
  relativePath: string;
  /** archivePath: 归档附件相对中心目录路径，位于 memory/attachments。 */
  archivePath: string;
}
```

- [ ] **步骤 6：运行附件归档静态检查**

先创建任务 6 的检查脚本后运行：

```bash
pnpm exec tsx scripts/check-memory-attachment-archive.ts
```

预期输出：

```text
check-memory-attachment-archive: ok
```

- [ ] **步骤 7：Commit 附件归档链路**

```bash
git add services/center/src/domain/AttachmentArchiveService.ts services/center/src/domain/usage-domain.ts services/center/src/api/sync-route.ts packages/api-client/src/index.ts packages/ui/src/index.ts apps/frontend/src/stores/app-conversation-actions.ts
git commit -m "feat: 归档正式附件并保留会话引用"
```

### 任务 3：结构化输入草稿与消息事实

**文件：**
- 修改：`packages/ui/src/index.ts`
- 修改：`apps/frontend/src/stores/app-conversation-actions.ts`
- 修改：`apps/frontend/src/views/Chat/components/ChatConversationPanel.vue`

- [ ] **步骤 1：扩展草稿协议**

在 `packages/ui/src/index.ts` 新增：

```ts
/**
 * ComposerDraftPart：输入框片段。
 *
 * 来源：富文本输入框草稿。
 * 含义：保持文本、附件和引用在输入框中的顺序。
 * 格式：判别联合对象。
 * 默认值：无。
 * 约束：发送前只是草稿，不能进入长期记忆。
 */
export type ComposerDraftPart =
  | {
      /** type: 文本片段。 */
      type: "text";
      /** text: 用户输入的原始文本。 */
      text: string;
    }
  | {
      /** type: 附件片段。 */
      type: "attachment";
      /** temporaryAttachmentId: 临时附件 ID。 */
      temporaryAttachmentId: string;
    }
  | {
      /** type: 引用片段。 */
      type: "reference";
      /** referenceIndex: references 数组索引。 */
      referenceIndex: number;
    };
```

给 `ComposerAttachmentDraft` 增加：

```ts
/** temporaryRelativePath: 临时附件相对中心目录路径，发送后用于移动归档。 */
temporaryRelativePath: string;
```

给 `ComposerDraftModel` 增加：

```ts
/** parts: 输入框片段顺序，来源于光标位置插入。 */
parts: ComposerDraftPart[];
```

`createEmptyComposerDraft()` 增加 `parts: []`。

- [ ] **步骤 2：保持旧文本发送兼容**

在 `apps/frontend/src/stores/app-conversation-actions.ts` 的 `sendDraft` 中，构造消息 Markdown 时优先读取 `draft.parts`；如果 `parts` 为空，则按旧的 `text + references + attachments` 生成。

代码结构：

```ts
const contentMarkdown = this.buildComposerMessageMarkdown(this.draft);
```

新增方法时必须写中文注释，方法只放在 store actions 中，不写到组件里。

- [ ] **步骤 3：附件插入片段**

在 `addClipboardImageAttachment` 成功后：

```ts
this.draft.attachments.push({
    temporaryAttachmentId: temporary.temporaryAttachmentId,
    temporaryRelativePath: temporary.relativePath,
    fileName,
    mimeType: file.type,
    sizeBytes: file.size,
});
this.draft.parts.push({
    type: "attachment",
    temporaryAttachmentId: temporary.temporaryAttachmentId,
});
```

- [ ] **步骤 4：引用插入片段**

在 `insertProjectReference` 成功 push 引用后，追加：

```ts
this.draft.parts.push({
    type: "reference",
    referenceIndex: this.draft.references.length - 1,
});
```

- [ ] **步骤 5：组件展示先保留标签**

`ChatConversationPanel.vue` 第一阶段不强制实现 contenteditable。保留现有标签展示，同时在注释中说明 `parts` 已保存顺序，后续组件升级为光标内嵌渲染时消费同一协议。

- [ ] **步骤 6：运行输入草稿静态检查**

创建或扩展 `scripts/check-composer-attachments.ts`，增加断言：

```ts
assertFileContains("packages/ui/src/index.ts", "ComposerDraftPart");
assertFileContains("packages/ui/src/index.ts", "temporaryRelativePath");
assertFileContains("apps/frontend/src/stores/app-conversation-actions.ts", "parts.push");
```

运行：

```bash
pnpm exec tsx scripts/check-composer-attachments.ts
```

预期输出包含：

```text
check-composer-attachments: ok
```

- [ ] **步骤 7：Commit 结构化草稿**

```bash
git add packages/ui/src/index.ts apps/frontend/src/stores/app-conversation-actions.ts apps/frontend/src/views/Chat/components/ChatConversationPanel.vue scripts/check-composer-attachments.ts
git commit -m "feat: 保留输入框结构化草稿片段"
```

### 任务 4：附件来源记忆写入

**文件：**
- 创建：`services/center/src/domain/AttachmentMemoryService.ts`
- 修改：`services/center/src/domain/session-turn-effects.ts`
- 修改：`services/center/src/domain/agent-domain.ts`
- 修改：`services/center/src/memory-engine.ts`

- [ ] **步骤 1：创建附件记忆服务**

创建 `services/center/src/domain/AttachmentMemoryService.ts`：

```ts
import type {
    CenterDatabase,
} from "../database.js";

/**
 * AttachmentMemorySource：附件记忆来源。
 *
 * 来源：正式用户消息附件引用。
 * 含义：让 Markdown、SQLite 和 Mem0 都能追溯附件来源。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：attachmentId 和 archivePath 必须来自中心服务正式附件记录。
 */
export interface AttachmentMemorySource {
    /** attachmentId: 正式附件 ID。 */
    attachmentId: string;
    /** fileName: 用户可见附件名。 */
    fileName: string;
    /** mimeType: 附件 MIME 类型。 */
    mimeType: string;
    /** sizeBytes: 附件大小，单位字节。 */
    sizeBytes: number;
    /** archivePath: 归档附件相对中心目录路径。 */
    archivePath: string;
    /** sessionId: 来源会话 ID。 */
    sessionId: string;
    /** turnId: 来源轮次 ID。 */
    turnId: string;
    /** messageId: 来源消息 ID。 */
    messageId: string;
}

/**
 * AttachmentMemoryService：读取轮次附件并生成记忆摘要输入。
 */
export class AttachmentMemoryService {
    /**
     * constructor：保存数据库事实源。
     *
     * @param database 中心服务数据库。
     */
    constructor(private readonly database: CenterDatabase) {}

    /**
     * listTurnAttachmentSources：读取本轮用户消息附件来源。
     *
     * @param sessionId 会话 ID。
     * @param turnId 轮次 ID。
     * @returns 附件记忆来源列表。
     */
    listTurnAttachmentSources(
        sessionId: string,
        turnId: string,
    ): AttachmentMemorySource[] {
        void sessionId;
        void turnId;
        return [];
    }
}
```

随后把 `return []` 替换为真实 SQL 查询：通过 `messages.turn_id = ?` 和 `attachments.message_id = messages.id` 取附件。字段缺失时先在 `usage-repository` 增补查询方法，不直接在业务层拼不明字段。

- [ ] **步骤 2：扩展 MemoryWriteInput**

在 `services/center/src/domain/agent-domain.ts` 中给 `MemoryWriteInput` 增加：

```ts
/** attachmentSources: 本轮正式附件来源，写入 Markdown 和索引用于追溯。 */
attachmentSources?: AttachmentMemorySource[];
```

写 Markdown 时增加：

```md
## 附件来源

- 附件：{fileName}
  - ID：{attachmentId}
  - 类型：{mimeType}
  - 路径：{archivePath}
  - 来源会话：{sessionId}
  - 来源轮次：{turnId}
  - 来源消息：{messageId}
```

- [ ] **步骤 3：轮次完成后读取附件来源**

在 `services/center/src/domain/session-turn-effects.ts` 的 `commitMainAgentMemoryAfterTurn` 中：

```ts
const attachmentSources = new AttachmentMemoryService(database)
    .listTurnAttachmentSources(
        sent.sessionId,
        sent.turnId,
    );
```

传入 `writeAgentMemory`。

- [ ] **步骤 4：Mem0 metadata 增加附件来源**

在 `services/center/src/memory-engine.ts` 的 `Mem0MemorySource` 增加：

```ts
/** attachments: 本条记忆关联的正式附件来源。 */
attachments?: Array<{
    /** attachmentId: 正式附件 ID。 */
    attachmentId: string;
    /** fileName: 用户可见附件名。 */
    fileName: string;
    /** archivePath: 归档路径。 */
    archivePath: string;
}>;
```

`syncTurnMemoryToMem0` 写 metadata 时带上 `attachments`。

- [ ] **步骤 5：附件摘要失败事件**

先不实现真实附件内容解析，但预留事件函数：

```ts
/**
 * appendAttachmentSummarySkipped：记录附件摘要暂未执行。
 *
 * @param source 附件来源。
 * @returns 没有返回值。
 */
appendAttachmentSummarySkipped(source: AttachmentMemorySource): void
```

事件类型使用 `memory.attachment.summary.skipped`，说明本轮已保存附件来源，内容摘要由后续解析能力补充。

- [ ] **步骤 6：运行附件记忆检查**

运行：

```bash
pnpm exec tsx scripts/check-memory-attachment-archive.ts
```

预期输出：

```text
check-memory-attachment-archive: ok
```

- [ ] **步骤 7：Commit 附件记忆**

```bash
git add services/center/src/domain/AttachmentMemoryService.ts services/center/src/domain/session-turn-effects.ts services/center/src/domain/agent-domain.ts services/center/src/memory-engine.ts scripts/check-memory-attachment-archive.ts
git commit -m "feat: 写入附件来源长期记忆"
```

### 任务 5：通用跨窗口记忆召回

**文件：**
- 修改：`services/center/src/model-gateway-runtime.ts`
- 修改：`services/center/src/memory-engine.ts`
- 创建：`scripts/check-memory-recall-cross-window.mjs`

- [ ] **步骤 1：移除固定身份检索词**

在 `model-gateway-runtime.ts` 中删除或替换以下固定词数组：

```ts
[
    "你叫什么",
    "我叫什么",
    "我是谁",
    "徐志翔",
    "致心",
    "更喜欢你叫",
]
```

替换为通用扩展：

```ts
const genericMemoryTerms = [
    normalizedUserText,
    extractMeaningfulChineseTerms(normalizedUserText).join(" "),
    "用户长期事实 用户偏好 当天事实 附件来源 附件摘要",
].filter((term) => {
    return term.trim().length > 0;
});
```

`extractMeaningfulChineseTerms` 只做通用分词式清洗，不判断具体问题类型，不写死用户身份或具体业务词。

- [ ] **步骤 2：召回结果包含来源**

把 `AgentMemoryPromptEntry` 扩展为：

```ts
interface AgentMemoryPromptEntry {
    keywords: string;
    summary: string;
    sourceSessionId: string | null;
    sourceTurnId: string | null;
    sourceMessageId?: string | null;
    sourceMemoryPath?: string | null;
    attachments?: Array<{
        attachmentId: string;
        fileName: string;
        archivePath: string;
    }>;
}
```

`buildMainAgentMemoryPrompt` 中输出附件来源：

```ts
const attachmentText = memory.attachments?.length
    ? `；附件：${memory.attachments.map((item) => `${item.fileName}(${item.attachmentId})`).join("、")}`
    : "";
```

- [ ] **步骤 3：SQLite 检索覆盖当天事实和附件摘要**

`buildMainAgentIndexedMemorySearchTerms` 返回：

```ts
return Array.from(new Set([
    normalizedUserText,
    ...extractMeaningfulChineseTerms(normalizedUserText),
    "用户长期事实",
    "当天事实",
    "附件来源",
    "附件摘要",
])).filter((term) => term.trim().length > 0);
```

不要写入“龙虾”或用户姓名这类业务词。

- [ ] **步骤 4：创建召回回归脚本**

创建 `scripts/check-memory-recall-cross-window.mjs`：

```js
import { readFileSync } from "node:fs";

function readText(path) {
  return readFileSync(path, "utf-8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const runtime = readText("services/center/src/model-gateway-runtime.ts");

assert(runtime.includes("searchSemanticMemories"), "召回必须继续使用 Mem0 检索。");
assert(runtime.includes("searchAgentMemorySummaries"), "召回必须继续使用 SQLite memory_index 检索。");
assert(runtime.includes("buildMainAgentMemoryPrompt"), "召回结果必须注入模型上下文。");
assert(runtime.includes("附件来源") || runtime.includes("attachments"), "召回上下文必须包含附件来源。");

const forbiddenHardcodedTerms = [
  "\"徐志翔\"",
  "\"龙虾\"",
  "\"我是谁\"",
  "\"你叫什么\"",
];

for (const term of forbiddenHardcodedTerms) {
  assert(!runtime.includes(term), `召回逻辑不能硬编码 ${term}`);
}

console.log("check-memory-recall-cross-window: ok");
```

- [ ] **步骤 5：运行召回回归脚本**

```bash
node scripts/check-memory-recall-cross-window.mjs
```

预期输出：

```text
check-memory-recall-cross-window: ok
```

- [ ] **步骤 6：Commit 召回改造**

```bash
git add services/center/src/model-gateway-runtime.ts services/center/src/memory-engine.ts scripts/check-memory-recall-cross-window.mjs
git commit -m "feat: 使用通用长期记忆召回"
```

### 任务 6：回归检查脚本与 check-all 集成

**文件：**
- 创建：`scripts/check-memory-attachment-archive.ts`
- 修改：`scripts/check-all.mjs`

- [ ] **步骤 1：创建附件归档检查脚本**

创建 `scripts/check-memory-attachment-archive.ts`：

```ts
import {
    readFileSync,
} from "node:fs";

function readText(path: string): string {
    return readFileSync(
        path,
        "utf-8",
    );
}

function assert(condition: boolean, message: string): void {
    if (!condition) {
        throw new Error(message);
    }
}

const usageDomain = readText("services/center/src/domain/usage-domain.ts");
const archiveService = readText("services/center/src/domain/AttachmentArchiveService.ts");
const agentDomain = readText("services/center/src/domain/agent-domain.ts");
const sessionRepository = readText("services/center/src/data-access/session-repository.ts");

assert(
    usageDomain.includes("memory/attachments") || archiveService.includes("\"attachments\""),
    "正式附件必须归档到 memory/attachments。",
);
assert(
    usageDomain.includes("AttachmentArchiveService"),
    "commitAttachment 必须使用 AttachmentArchiveService。",
);
assert(
    agentDomain.includes("附件来源"),
    "Markdown 长期记忆必须包含附件来源小节。",
);
assert(
    sessionRepository.includes("DELETE FROM attachments WHERE session_id = ?"),
    "删除会话必须只删除附件引用。",
);
assert(
    !sessionRepository.includes("rmSync") && !sessionRepository.includes("unlinkSync"),
    "删除会话不能删除归档附件文件。",
);

console.log("check-memory-attachment-archive: ok");
```

- [ ] **步骤 2：纳入 `scripts/check-all.mjs`**

按现有数组风格新增：

```js
{
  command: "pnpm",
  args: [
    "exec",
    "tsx",
    "scripts/check-memory-attachment-archive.ts",
  ],
},
{
  command: "node",
  args: [
    "scripts/check-memory-recall-cross-window.mjs",
  ],
},
```

- [ ] **步骤 3：运行新增检查**

```bash
pnpm exec tsx scripts/check-memory-attachment-archive.ts
node scripts/check-memory-recall-cross-window.mjs
```

预期输出：

```text
check-memory-attachment-archive: ok
check-memory-recall-cross-window: ok
```

- [ ] **步骤 4：Commit 检查脚本**

```bash
git add scripts/check-memory-attachment-archive.ts scripts/check-memory-recall-cross-window.mjs scripts/check-all.mjs
git commit -m "test: 增加记忆附件归档回归检查"
```

### 任务 7：IDEA Run Configuration 启动验收

**文件：**
- 修改：`启动进程.md`
- 修改：`浏览器页面.md`

- [ ] **步骤 1：查询 IDEA Run Configuration**

使用 ideaMCP：

```text
get_run_configurations(projectPath="D:\\CODE\\project\\self\\zhixin-agent")
```

预期存在：

```text
dev:frontend
dev:desktop-shell
```

- [ ] **步骤 2：启动 `dev:frontend`**

使用 ideaMCP 执行：

```text
execute_run_configuration(configurationName="dev:frontend", projectPath="D:\\CODE\\project\\self\\zhixin-agent")
```

如果它已经运行，不重启；记录现有进程和端口到 `启动进程.md`。

- [ ] **步骤 3：启动 `dev:desktop-shell`**

按项目规则，启动前必须关闭旧桌面壳及其中心服务。关闭动作涉及停止旧进程，执行前确认只关闭本项目旧 `dev:desktop-shell`/中心服务进程。

使用 ideaMCP 执行：

```text
execute_run_configuration(configurationName="dev:desktop-shell", projectPath="D:\\CODE\\project\\self\\zhixin-agent")
```

记录到 `启动进程.md`：

```text
{pid} = {port} = dev:desktop-shell
```

- [ ] **步骤 4：确认中心服务健康**

通过浏览器页面或中心服务健康接口确认 `http://127.0.0.1:8866` 可用。此步骤不能替代后续浏览器真实验收。

- [ ] **步骤 5：Commit 启动记录**

如果 `启动进程.md` 或 `浏览器页面.md` 是项目跟踪文件：

```bash
git add 启动进程.md 浏览器页面.md
git commit -m "test: 记录记忆召回验收启动信息"
```

如果它们被 `.gitignore` 忽略，不强制加入。

### 任务 8：Chrome DevTools 浏览器验收

**文件：**
- 修改：`浏览器页面.md`

- [ ] **步骤 1：打开页面但不主动抢占用户已有页面**

使用 Chrome DevTools 新建后台或当前可控页面：

```text
http://127.0.0.1:5173
```

记录：

```text
{pageId} = http://127.0.0.1:5173
```

- [ ] **步骤 2：跨窗口文本记忆验收**

真实操作：

1. 新建普通对话 A。
2. 输入并发送：`请记住，我今天午饭吃了龙虾。`
3. 等待轮次完成。
4. 新建普通对话 B。
5. 输入并发送：`我今天午饭吃了什么？`
6. 观察回复包含“龙虾”，且不是当前窗口历史推断。

记录失败时的页面截图、控制台错误和最近中心服务事件。

- [ ] **步骤 3：三种不同提示词记忆验收**

按项目规则，不重复同一提示词。依次测试：

```text
我今天午饭吃了龙虾。
刚才让你记住的午饭是什么？
换个窗口问：今天午餐记录是什么？
```

三个提示词必须覆盖写入、跨窗口召回和换说法召回。

- [ ] **步骤 4：附件来源验收**

真实操作：

1. 在对话 A 粘贴或选择一个小图片附件。
2. 发送：`请把这个附件作为今天午饭记录的来源保存。`
3. 等待轮次完成。
4. 检查中心目录出现 `center-data/memory/attachments/...` 文件。
5. 删除会话 A。
6. 确认归档附件文件仍存在。

- [ ] **步骤 5：附件摘要验收**

第一版如果仅实现摘要 skipped 事件，则验收：

1. 发送附件后检查事件中有 `memory.attachment.summary.skipped`。
2. 确认附件来源仍写入长期记忆。
3. 本计划不实现附件内容解析供应商；另起附件解析任务时再把本步骤扩展为内容摘要召回。

- [ ] **步骤 6：浏览器问题记录**

使用 Chrome DevTools 检查：

- 控制台无新错误。
- 网络 WebSocket 未断开。
- 消息发送、轮次完成、停止按钮恢复正常。
- 输入框草稿附件未发送前不出现在长期记忆。

- [ ] **步骤 7：最终验证命令**

运行新增检查：

```bash
pnpm exec tsx scripts/check-memory-attachment-archive.ts
node scripts/check-memory-recall-cross-window.mjs
```

不要运行 `tsc` 或 `vue-tsc`。

- [ ] **步骤 8：最终提交与推送**

项目规则要求所有任务完成后推送。提交剩余本任务改动，避免纳入用户无关改动：

```bash
git status --short
git add <本任务相关文件>
git commit -m "feat: 完成记忆召回与附件归档"
git pull --rebase
git push
```

若远端领先，先拉取；若遇到冲突，停止并说明冲突文件。

---

## 自检

- 规格覆盖度：计划覆盖文档事实源、输入框结构化草稿、归档附件、附件记忆、跨窗口召回、IDEA 启动和 Chrome DevTools 验收。
- 占位符扫描：计划没有使用未完成标记作为任务内容；附件真实解析供应商被明确列为非目标，第一版用 skipped 事件验收。
- 类型一致性：附件正式路径统一使用 `archivePath`，兼容返回 `relativePath`；草稿临时路径统一使用 `temporaryRelativePath`；附件来源统一使用 `AttachmentMemorySource`。
- 项目约束：未计划修改 `总体计划.md`；未引入 TypeScript 项目级编译；启动验收明确使用 IDEA Run Configuration；浏览器验收明确使用 Chrome DevTools。
