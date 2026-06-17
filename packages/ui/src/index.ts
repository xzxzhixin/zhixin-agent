import type { InternalFileLink } from "@zhixin/shared";

/**
 * 输入附件草稿。
 *
 * 来源：阶段 12 统一输入框需求。
 * 含义：描述尚未发送、可能位于 temp 目录的附件。
 * 格式：JSON 对象。
 * 默认值：无。
 * 约束：临时附件不能进入永久记忆，发送后必须转正式附件。
 */
export interface ComposerAttachmentDraft {
  /**
   * temporaryAttachmentId: 中心服务生成的临时附件 ID。
   */
  temporaryAttachmentId: string;

  /**
   * temporaryRelativePath: 临时附件相对中心目录路径，发送后用于移动到正式归档目录。
   */
  temporaryRelativePath: string;

  /**
   * fileName: 展示给用户的文件名。
   */
  fileName: string;

  /**
   * mimeType: MIME 类型。
   */
  mimeType: string;

  /**
   * sizeBytes: 文件大小，单位字节。
   */
  sizeBytes: number;
}

/**
 * 输入引用草稿。
 *
 * 来源：阶段 12 项目文件、文件夹和代码引用需求。
 * 含义：保存输入框中的结构化上下文引用。
 * 格式：判别联合对象。
 * 默认值：无。
 * 约束：普通非项目会话不能创建项目引用。
 */
export type ComposerReferenceDraft =
  | {
      /**
       * type: 文件引用。
       */
      type: "file";

      /**
       * link: 内部文件定位链接，行号可为空。
       */
      link: InternalFileLink;

      /**
       * displayName: 输入框标签展示名。
       */
      displayName: string;
    }
  | {
      /**
       * type: 文件夹引用。
       */
      type: "folder";

      /**
       * projectId: 所属项目 ID。
       */
      projectId: string;

      /**
       * absolutePath: 文件夹绝对路径。
       */
      absolutePath: string;

      /**
       * relativePath: 相对项目路径。
       */
      relativePath: string;

      /**
       * displayName: 输入框标签展示名。
       */
      displayName: string;
    }
  | {
      /**
       * type: 代码选区引用。
       */
      type: "code";

      /**
       * link: 内部文件定位链接，必须包含起止行。
       */
      link: InternalFileLink;

      /**
       * selectedCode: 选中代码文本。
       */
      selectedCode: string;

      /**
       * displayName: 输入框标签展示名。
       */
      displayName: string;
    };

/**
 * 输入框结构化片段。
 *
 * 来源：富文本输入框结构化消息事实需求。
 * 含义：按用户插入顺序保留文本、附件和引用，供发送时构造 Markdown。
 * 格式：判别联合对象。
 * 默认值：空草稿使用空数组。
 * 约束：该顺序只表示发送展示 Markdown，不代表写入长期记忆。
 */
export type ComposerDraftPart =
  | {
      /**
       * type: 文本片段。
       */
      type: "text";

      /**
       * text: 用户输入的原始文本。
       */
      text: string;
    }
  | {
      /**
       * type: 附件片段。
       */
      type: "attachment";

      /**
       * attachment: 输入框临时附件草稿。
       */
      attachment: ComposerAttachmentDraft;
    }
  | {
      /**
       * type: 引用片段。
       */
      type: "reference";

      /**
       * reference: 输入框上下文引用草稿。
       */
      reference: ComposerReferenceDraft;
    };

/**
 * 输入框草稿。
 *
 * 来源：统一输入框组件协议。
 * 含义：聚合文本、附件、skill 和上下文引用。
 * 格式：JSON 对象。
 * 默认值：文本为空，数组为空。
 * 约束：发送时由中心服务保存为消息事实。
 */
export interface ComposerDraftModel {
  /**
   * text: 用户输入文本。
   */
  text: string;

  /**
   * attachments: 临时附件草稿。
   */
  attachments: ComposerAttachmentDraft[];

  /**
   * references: 上下文引用草稿。
   */
  references: ComposerReferenceDraft[];

  /**
   * skillNames: 本轮显式选择的 skill 名称。
   */
  skillNames: string[];

  /**
   * parts: 按插入顺序保存的结构化输入片段。
   *
   * 默认值：空数组。
   * 约束：当前组件仍用标签展示附件和引用；后续 contenteditable 内嵌渲染消费同一协议。
   */
  parts: ComposerDraftPart[];
}

/**
 * createEmptyComposerDraft：创建空输入框草稿。
 *
 * @returns 空输入框草稿。
 */
export function createEmptyComposerDraft(): ComposerDraftModel {
  return {
    text: "",
    attachments: [],
    references: [],
    skillNames: [],
    parts: [],
  };
}

/**
 * canSendComposerDraft：判断输入框草稿是否可发送。
 *
 * @param draft 输入框草稿。
 * @returns 有文本、附件、引用或 skill 时返回 true。
 */
export function canSendComposerDraft(draft: ComposerDraftModel): boolean {
  return draft.text.trim().length > 0
    || draft.attachments.length > 0
    || draft.references.length > 0
    || draft.skillNames.length > 0
    || draft.parts.length > 0;
}

/**
 * renderComposerReferenceMarkdown：把结构化引用渲染成消息 Markdown。
 *
 * @param reference 输入框引用草稿。
 * @returns 中心服务消息正文使用的 Markdown 链接。
 */
export function renderComposerReferenceMarkdown(reference: ComposerReferenceDraft): string {
  if (reference.type === "folder") {
    return `[@${reference.displayName}](zhixin-folder:${encodeURIComponent(JSON.stringify(reference))})`;
  }

  if (reference.type === "code") {
    return `[@${reference.displayName}](zhixin-code:${encodeURIComponent(JSON.stringify(reference))})`;
  }

  return `[@${reference.displayName}](zhixin-file:${encodeURIComponent(JSON.stringify(reference.link))})`;
}

/**
 * renderComposerAttachmentMarkdown：把临时附件草稿渲染成消息 Markdown。
 *
 * @param attachment 输入框附件草稿。
 * @returns 中心服务消息正文使用的临时附件 Markdown。
 */
export function renderComposerAttachmentMarkdown(attachment: ComposerAttachmentDraft): string {
  return `![${attachment.fileName}](temp://${attachment.temporaryAttachmentId})`;
}

/**
 * renderComposerDraftMarkdown：按输入框草稿协议构造发送展示 Markdown。
 *
 * 关键逻辑：`parts` 有内容时按结构化片段顺序输出；`parts` 为空时继续兼容旧草稿格式。
 * 该函数只生成发送展示 Markdown，不代表写入长期记忆。
 *
 * @param draft 输入框草稿。
 * @returns 可发送到中心服务消息接口的 Markdown 正文。
 */
export function renderComposerDraftMarkdown(draft: ComposerDraftModel): string {
  const markdownParts: string[] = [];

  if (draft.parts.length > 0) {
    const hasTextPart = draft.parts.some((part) => {
      return part.type === "text";
    });
    const legacyText = draft.text.trim();
    if (!hasTextPart && legacyText.length > 0) {
      // 当前 textarea 还不是 contenteditable，文本仍来自 draft.text；后续内嵌渲染会直接写入 text part。
      markdownParts.push(legacyText);
    }
    for (const part of draft.parts) {
      if (part.type === "text") {
        const text = part.text.trim();
        if (text.length > 0) {
          markdownParts.push(text);
        }
      }
      if (part.type === "attachment") {
        markdownParts.push(renderComposerAttachmentMarkdown(part.attachment));
      }
      if (part.type === "reference") {
        markdownParts.push(renderComposerReferenceMarkdown(part.reference));
      }
    }
    return markdownParts.join("\n\n");
  }

  const text = draft.text.trim();
  if (text.length > 0) {
    markdownParts.push(text);
  }

  for (const reference of draft.references) {
    markdownParts.push(renderComposerReferenceMarkdown(reference));
  }

  for (const attachment of draft.attachments) {
    markdownParts.push(renderComposerAttachmentMarkdown(attachment));
  }

  return markdownParts.join("\n\n");
}
