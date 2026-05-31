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
    || draft.skillNames.length > 0;
}
