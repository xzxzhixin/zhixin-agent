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
            if (this.hasActiveRunningTurn()) {
                this.queueDraftForCurrentTurn(
                    contentMarkdown,
                );
                this.draft = createEmptyComposerDraft();
                this.showProjectReferencePopover = false;
                this.projectReferenceQuery = "";
                return;
            }
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
            this.applySentMessageOptimisticState(
                sessionId,
                contentMarkdown,
                sent,
            );
            await this.commitDraftAttachments(
                sessionId,
                sent.messageId,
                attachments,
            );
            await this.loadNavigationData();
            await this.loadActiveSessionDetail();
            await this.refreshEvents();
            await this.updateComposerContextUsageFromExecution();
        },

        /**
         * hasActiveRunningTurn：判断当前对话是否存在运行中或等待用户轮次。
         *
         * @returns 存在运行中或等待用户轮次时返回 true。
         */
        hasActiveRunningTurn(): boolean {
            return Boolean(this.sessionDetail?.turns.some((turn) => {
                return turn.endedAt === null
                    && (
                        turn.status === "queued"
                        || turn.status === "running"
                        || turn.status === "waiting_user"
                    );
            }));
        },

        /**
         * queueDraftForCurrentTurn：把运行中新发送内容放入本地排队消息区。
         *
         * @param contentMarkdown 发送瞬间构建好的 Markdown 正文。
         * @returns 没有返回值。
         */
        queueDraftForCurrentTurn(contentMarkdown: string): void {
            const trimmedContent = contentMarkdown.trim();
            if (trimmedContent.length === 0) {
                return;
            }
            this.queuedComposerMessages.push({
                queuedMessageId: `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                sessionId: this.activeSessionId ?? "",
                contentMarkdown: trimmedContent,
                createdAt: new Date().toISOString(),
            });
        },

        /**
         * submitQueuedMessageAsGuidance：排队消息转为当前轮次引导并立即移除。
         *
         * @param queuedMessageId 本地排队消息 ID。
         * @returns 引导提交完成后没有返回值。
         */
        async submitQueuedMessageAsGuidance(queuedMessageId: string): Promise<void> {
            const queuedMessage = this.queuedComposerMessages.find((message) => {
                return message.queuedMessageId === queuedMessageId;
            });
            if (!queuedMessage) {
                return;
            }
            this.queuedComposerMessages = this.queuedComposerMessages.filter((message) => {
                return message.queuedMessageId !== queuedMessageId;
            });
            const sessionId = this.activeSessionId ?? await this.ensureSessionForSending();
            if (!sessionId) {
                return;
            }
            // 当前中心服务尚未提供独立 guidance API；这里绕过运行中入队判断，按单一引导文本协议直接提交到当前会话。
            const contentMarkdown = `针对当前对话当前轮次补充引导：${queuedMessage.contentMarkdown}`;
            const sent = await this.api().sendMessage({
                sessionId,
                contentMarkdown,
            });
            this.applySentMessageOptimisticState(
                sessionId,
                contentMarkdown,
                sent,
            );
            await this.loadNavigationData();
            await this.loadActiveSessionDetail();
            await this.refreshEvents();
            await this.updateComposerContextUsageFromExecution();
        },

        /**
         * stopActiveConversationTurn：停止当前对话执行。
         *
         * @returns 没有返回值。
         */
        async stopActiveConversationTurn(): Promise<void> {
            // 当前中心服务取消接口只暴露 Worker task 级入口；会话轮次取消协议接入前，前端必须给出明确可见反馈。
            this.lastError = "停止当前执行的中心服务接口待接入。";
        },

        /**
         * applySentMessageOptimisticState：发送成功后立即补入浏览器可见的首包状态。
         *
         * @param sessionId 当前会话 ID。
         * @param contentMarkdown 用户发送正文。
         * @param sent 中心服务返回的消息、轮次和任务身份。
         * @returns 没有返回值。
         */
        applySentMessageOptimisticState(
            sessionId: string,
            contentMarkdown: string,
            sent: {
                messageId: string;
                turnId: string;
                taskId: string;
            },
        ): void {
            if (!this.sessionDetail || this.sessionDetail.session.sessionId !== sessionId) {
                return;
            }

            // now: 只作为浏览器首包占位时间；随后 loadActiveSessionDetail 会用中心服务事实覆盖。
            const now = new Date().toISOString();
            if (!this.sessionDetail.messages.some((message) => message.messageId === sent.messageId)) {
                this.sessionDetail.messages.push({
                    messageId: sent.messageId,
                    sessionId,
                    turnId: sent.turnId,
                    role: "user",
                    contentMarkdown,
                    createdAt: now,
                });
            }
            if (!this.sessionDetail.turns.some((turn) => turn.turnId === sent.turnId)) {
                this.sessionDetail.turns.push({
                    turnId: sent.turnId,
                    sessionId,
                    turnNumber: this.sessionDetail.turns.length + 1,
                    userMessageId: sent.messageId,
                    status: "running",
                    startedAt: now,
                    endedAt: null,
                    durationMs: null,
                });
            }
            if (!this.sessionDetail.tasks.some((task) => task.taskId === sent.taskId)) {
                this.sessionDetail.tasks.push({
                    taskId: sent.taskId,
                    turnId: sent.turnId,
                    sessionId,
                    status: "running",
                    title: "正在生成回复",
                    createdAt: now,
                    updatedAt: now,
                });
            }
            // 过程事件只能来自中心服务 sequence 事实源；浏览器不再插入负 sequence 占位，避免命令开始、输出和完成顺序被本地假事件打乱。
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
                        this.events.sort((left: EventRecord, right: EventRecord) => {
                            return left.sequence - right.sequence;
                        });
                        void this.refreshActiveConversationState();
                    }
                    if (message.type === "agent.state.changed") {
                        this.applyAgentRuntimeState(message.payload as {
                            agentId: string;
                            status: string;
                            currentTaskId: string | null;
                            updatedAt: string;
                        });
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

        /**
         * applyAgentRuntimeState：合并中心服务推送的智能体运行状态。
         *
         * @param payload WebSocket `agent.state.changed` 载荷。
         * @returns 没有返回值。
         */
        applyAgentRuntimeState(payload: {
            agentId: string;
            status: string;
            currentTaskId: string | null;
            updatedAt: string;
        }): void {
            const statusLabel = this.formatAgentRuntimeStatus(payload.status);
            this.mainAgentStatusTree = this.mainAgentStatusTree.map((node) => {
                if (node.agentId === payload.agentId) {
                    return {
                        ...node,
                        status: statusLabel,
                        taskSummary: payload.currentTaskId
                            ? `当前任务：${payload.currentTaskId}`
                            : "当前没有执行任务。",
                    };
                }
                return {
                    ...node,
                    children: node.children.map((child) => {
                        if (child.agentId !== payload.agentId) {
                            return child;
                        }
                        return {
                            ...child,
                            status: statusLabel,
                            taskSummary: payload.currentTaskId
                                ? `当前任务：${payload.currentTaskId}`
                                : "当前没有执行任务。",
                        };
                    }),
                };
            });
        },

        /**
         * formatAgentRuntimeStatus：把中心服务智能体状态协议转成中文。
         *
         * @param status 中心服务 AgentRuntimeStatus。
         * @returns 中文状态。
         */
        formatAgentRuntimeStatus(status: string): string {
            const labels: Record<string, string> = {
                idle: "空闲",
                working: "工作中",
                queued: "排队中",
                waiting_user: "等待用户",
                ended: "已结束",
                failed: "失败",
            };
            return labels[status] ?? "未知状态";
        },
    };
}
