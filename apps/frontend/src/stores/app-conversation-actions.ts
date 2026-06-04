import type {
    SessionUpdatedPayload,
} from "@zhixin/api-client";
import {
    ReconnectingWebSocketClient,
} from "@zhixin/api-client";
import {
    createEmptyComposerDraft,
    canSendComposerDraft,
    type ComposerAttachmentDraft,
} from "@zhixin/ui";
import type {
    EventRecord,
} from "@zhixin/shared";

/**
 * createConversationActions：创建对话发送、附件和实时同步相关 Pinia actions。
 *
 * 用途：把对话主链路从主 store 拆出，避免状态定义文件继续膨胀。
 * 关键逻辑：仍通过中心服务 REST 与 WebSocket 作为唯一事实入口。
 * @returns 可被 Pinia actions 展开的对话动作集合。
 */
export function createConversationActions() {
    return {
        /**
         * refreshActiveConversationState：按实时事件刷新当前会话事实。
         *
         * @returns 刷新完成后没有返回值。
         */
        async refreshActiveConversationState(): Promise<void> {
            if (!this.activeSessionId) {
                return;
            }
            await this.loadActiveSessionDetail();
        },

        /**
         * sendDraft：发送当前输入框文本。
         *
         * @returns 发送完成后没有返回值。
         */
        async sendDraft(): Promise<void> {
            if (!canSendComposerDraft(this.draft)) {
                return;
            }

            const contentMarkdown = this.buildDraftMarkdown();
            const attachments = [
                ...this.draft.attachments,
            ];
            this.draft = createEmptyComposerDraft();
            this.showProjectReferencePopover = false;
            this.projectReferenceQuery = "";

            const sessionId = await this.ensureSessionForSending();
            if (!sessionId) {
                return;
            }

            const sent = await this.api().sendMessage({
                sessionId,
                contentMarkdown,
            });
            await this.commitDraftAttachments(
                sessionId,
                sent.messageId,
                attachments,
            );
            await this.loadNavigationData();
            await this.loadActiveSessionDetail();
            await this.refreshEvents();
        },

        /**
         * refreshEvents：拉取当前会话缺失事件。
         *
         * @returns 拉取完成后没有返回值。
         */
        async refreshEvents(): Promise<void> {
            const result = await this.api().listEvents({
                sessionId: this.activeSessionId,
                turnId: null,
                afterSequence: 0,
            });
            this.events = result.events;
        },

        /**
         * runNodeVersionToolForActiveTurn：触发中心服务命令工具输出 Node.js 版本。
         *
         * @returns 通过当前对话发送工具请求后没有返回值。
         */
        async runNodeVersionToolForActiveTurn(): Promise<void> {
            // 固定接口只能证明 API 可用，不能证明命令工具被对话编排触发；这里按验收要求写入草稿并复用 sendDraft 的会话创建和发送闭环。
            this.draft.text = "请通过命令工具输出 Node.js 版本";
            await this.sendDraft();
        },

        /**
         * connectRealtime：建立 WebSocket 实时同步连接。
         *
         * @returns 没有返回值。
         */
        connectRealtime(): void {
            if (!this.authorization) {
                return;
            }

            const webSocketUrl = this.runtime.centerBaseUrl.replace(/^http/u, "ws");
            this.webSocketClient?.close();
            this.webSocketClient = new ReconnectingWebSocketClient({
                url: `${webSocketUrl}/api/sync`,
                clientId: this.authorization.clientId,
                clientType: this.runtime.clientType,
                projectId: this.runtime.projectContext?.projectId ?? null,
                maxRetries: 5,
                retryIntervalMs: 2000,
                onStateChange: (state) => {
                    this.connectionState = state;
                },
                onMessage: (message) => {
                    if (message.type === "event.appended") {
                        this.events.push(message.payload as EventRecord);
                        void this.refreshActiveConversationState();
                    }
                    if (message.type === "session.updated") {
                        void this.handleSessionUpdated(message.payload as SessionUpdatedPayload);
                    }
                },
            });
            this.webSocketClient.connect();
        },

        /**
         * addClipboardImageAttachment：把剪贴板图片登记为临时附件草稿。
         *
         * @param file 剪贴板图片文件。
         * @returns 登记完成后没有返回值。
         */
        async addClipboardImageAttachment(file: File): Promise<void> {
            const fileName = file.name || `clipboard-${Date.now()}.png`;
            const temporary = await this.api().createTemporaryAttachment({
                fileName,
                mimeType: file.type,
                sizeBytes: file.size,
                file,
            });
            this.draft.attachments.push({
                temporaryAttachmentId: temporary.temporaryAttachmentId,
                fileName,
                mimeType: file.type,
                sizeBytes: file.size,
            });
        },

        /**
         * commitDraftAttachments：消息发送成功后提交所有临时附件。
         *
         * @param sessionId 当前会话 ID。
         * @param messageId 已创建消息 ID。
         * @param attachments 临时附件草稿数组。
         * @returns 全部提交完成后没有返回值。
         */
        async commitDraftAttachments(
            sessionId: string,
            messageId: string,
            attachments: ComposerAttachmentDraft[],
        ): Promise<void> {
            for (const attachment of attachments) {
                await this.api().commitAttachment({
                    sessionId,
                    messageId,
                    temporaryAttachmentId: attachment.temporaryAttachmentId,
                    fileName: attachment.fileName,
                    mimeType: attachment.mimeType,
                    sizeBytes: attachment.sizeBytes,
                });
            }
        },
    };
}
