import type {
    SessionUpdatedPayload,
} from "@zhixin/api-client";
import {
    CenterApiError,
    ReconnectingWebSocketClient,
} from "@zhixin/api-client";
import {
    createEmptyComposerDraft,
    canSendComposerDraft,
    type ComposerAttachmentDraft,
} from "@zhixin/ui";
import type {
    AgentSubConversationDetail,
    EventRecord,
    PendingEditRecord,
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
            try {
                await this.loadActiveSessionDetail();
                await this.loadPendingEditsForActiveSession();
            } catch (error) {
                if (error instanceof CenterApiError && error.code === "SESSION_NOT_FOUND") {
                    // 删除事件和普通事件可能交错到达；当前会话已被删时只清理本地状态，不能把竞态错误冒泡到控制台。
                    this.clearDeletedActiveSessionState();
                    await this.loadNavigationData();
                    await this.ensureSession();
                    return;
                }
                throw error;
            }
        },

        /**
         * clearDeletedActiveSessionState：清理已删除当前会话的本地展示状态。
         *
         * @returns 没有返回值。
         */
        clearDeletedActiveSessionState(): void {
            this.activeSessionId = null;
            this.sessionDetail = null;
            this.events = [];
            this.pendingSessionDraft = null;
            this.composerEditFiles = [];
            this.resetComposerContextUsageForWindow();
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

            const sent = await this.requireRealtimeRequest<{
                /** sessionId: 中心服务确认的会话 ID。 */
                sessionId: string;
                /** messageId: 用户消息 ID。 */
                messageId: string;
                /** turnId: 本轮轮次 ID。 */
                turnId: string;
                /** taskId: 本轮任务 ID。 */
                taskId: string;
            }>("session.message.send", {
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
            await this.loadActiveSessionSnapshot();
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
            await this.requireRealtimeRequest<{
                /** taskId: 被合并的当前任务 ID。 */
                taskId: string;
                /** turnId: 被合并的当前轮次 ID。 */
                turnId: string;
                /** stepId: 新增引导步骤 ID。 */
                stepId: string;
                /** status: 固定 merged。 */
                status: "merged";
            }>("session.guidance.submit", {
                sessionId,
                contentMarkdown,
            });
            await this.loadNavigationData();
            await this.loadActiveSessionSnapshot();
            await this.updateComposerContextUsageFromExecution();
        },

        /**
         * stopActiveConversationTurn：停止当前对话执行。
         *
         * @returns 没有返回值。
         */
        async stopActiveConversationTurn(): Promise<void> {
            if (!this.activeSessionId) {
                return;
            }
            await this.requireRealtimeRequest<{
                /** sessionId: 被停止的当前会话 ID。 */
                sessionId: string;
                /** turnId: 被停止的当前运行轮次 ID；没有运行轮次时为 null。 */
                turnId: string | null;
                /** taskId: 被停止的当前任务 ID；没有运行任务时为 null。 */
                taskId: string | null;
                /** status: 停止后的状态。 */
                status: "cancelled" | "idle";
                /** cancelledStepCount: 本次同步取消的运行中步骤数量。 */
                cancelledStepCount: number;
            }>("session.turn.cancel", {
                sessionId: this.activeSessionId,
                reason: "用户点击停止当前执行。",
            });
            await this.loadActiveSessionSnapshot();
            await this.updateComposerContextUsageFromExecution();
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
            const result = await this.requireRealtimeRequest<{
                /** events: 中心服务返回的事件列表。 */
                events: EventRecord[];
            }>("session.event.replay", {
                sessionId: this.activeSessionId,
                turnId: null,
                afterSequence: 0,
            });
            this.events = result.events;
        },

        /**
         * requireRealtimeRequest：对话页 WebSocket-only 请求入口。
         *
         * @param type WebSocket 请求类型。
         * @param payload 请求载荷。
         * @returns 服务端响应载荷。
         */
        async requireRealtimeRequest<TResponse>(type: string, payload: unknown): Promise<TResponse> {
            if (!this.webSocketClient) {
                throw new Error("对话页 WebSocket 尚未连接，不能使用 REST 兜底。");
            }
            return this.webSocketClient.request<TResponse>(
                type,
                payload,
            );
        },

        /**
         * loadPendingEditsForActiveSession：加载当前会话真实待确认编辑。
         *
         * @returns 加载完成后没有返回值。
         */
        async loadPendingEditsForActiveSession(): Promise<void> {
            if (!this.activeSessionId) {
                this.composerEditFiles = [];
                return;
            }
            const result = await this.requireRealtimeRequest<{
                /** edits: 当前会话待确认编辑。 */
                edits: PendingEditRecord[];
            }>("edit.pending.list", {
                sessionId: this.activeSessionId,
            });
            this.composerEditFiles = result.edits.map(mapPendingEditToComposerFile);
        },

        /**
         * saveComposerEditFile：确认保存单个文件编辑。
         *
         * @param editId 编辑记录 ID。
         * @returns 没有返回值。
         */
        async saveComposerEditFile(editId: string): Promise<void> {
            await this.requireRealtimeRequest<{
                /** edit: 保存后的编辑记录。 */
                edit: PendingEditRecord;
            }>("edit.pending.save", {
                editId,
            });
            await this.loadPendingEditsForActiveSession();
        },

        /**
         * revertComposerEditFile：撤回单个文件编辑。
         *
         * @param editId 编辑记录 ID。
         * @returns 没有返回值。
         */
        async revertComposerEditFile(editId: string): Promise<void> {
            await this.requireRealtimeRequest<{
                /** edit: 撤回后的编辑记录。 */
                edit: PendingEditRecord;
            }>("edit.pending.revert", {
                editId,
            });
            await this.loadPendingEditsForActiveSession();
        },

        /**
         * saveAllComposerEditFiles：确认保存当前会话全部待确认编辑。
         *
         * @returns 没有返回值。
         */
        async saveAllComposerEditFiles(): Promise<void> {
            if (!this.activeSessionId) {
                return;
            }
            await this.requireRealtimeRequest<{
                /** edits: 保存后的编辑列表。 */
                edits: PendingEditRecord[];
            }>("edit.pending.save_all", {
                sessionId: this.activeSessionId,
            });
            await this.loadPendingEditsForActiveSession();
        },

        /**
         * revertAllComposerEditFiles：撤回当前会话全部待确认编辑。
         *
         * @returns 没有返回值。
         */
        async revertAllComposerEditFiles(): Promise<void> {
            if (!this.activeSessionId) {
                return;
            }
            await this.requireRealtimeRequest<{
                /** edits: 撤回后的编辑列表。 */
                edits: PendingEditRecord[];
            }>("edit.pending.revert_all", {
                sessionId: this.activeSessionId,
            });
            await this.loadPendingEditsForActiveSession();
        },

        /**
         * openComposerEditDiff：打开 Web 或 IDE 编辑对比。
         *
         * @param editId 编辑记录 ID。
         * @returns 对比文本，Web 端可用于弹框展示。
         */
        async openComposerEditDiff(editId: string): Promise<string> {
            const diff = await this.requireRealtimeRequest<{
                /** editId: 编辑记录 ID。 */
                editId: string;
                /** filePath: 文件路径。 */
                filePath: string;
                /** beforeContent: 编辑前内容。 */
                beforeContent: string;
                /** afterContent: 编辑后内容。 */
                afterContent: string;
                /** diffText: 统一 diff 文本。 */
                diffText: string;
            }>("edit.pending.diff", {
                editId,
            });
            const ideBridge = window.zhixinPlugin;
            if (ideBridge?.openEditDiff) {
                await ideBridge.openEditDiff({
                    filePath: diff.filePath,
                    beforeContent: diff.beforeContent,
                    afterContent: diff.afterContent,
                    title: `致心编辑对比：${diff.filePath}`,
                });
            }
            return diff.diffText;
        },

        /**
         * loadAgentSubConversation：读取当前会话内某智能体独立子对话。
         *
         * @param payload 主会话和智能体身份。
         * @returns 智能体子对话详情。
         */
        async loadAgentSubConversation(payload: {
            parentSessionId: string;
            agentId: string;
            agentName: string;
        }): Promise<AgentSubConversationDetail> {
            return this.requireRealtimeRequest<AgentSubConversationDetail>(
                "agent.sub_conversation.detail",
                payload,
            );
        },

        /**
         * sendAgentSubConversationMessage：向智能体独立子对话发送消息。
         *
         * @param payload 主会话、智能体和正文。
         * @returns 更新后的智能体子对话详情。
         */
        async sendAgentSubConversationMessage(payload: {
            parentSessionId: string;
            agentId: string;
            agentName: string;
            contentMarkdown: string;
        }): Promise<AgentSubConversationDetail> {
            return this.requireRealtimeRequest<AgentSubConversationDetail>(
                "agent.sub_conversation.message.send",
                payload,
            );
        },

        /**
         * connectRealtime：建立 WebSocket 实时同步连接。
         *
         * @returns WebSocket 连接打开后完成；未授权时直接返回。
         */
        async connectRealtime(): Promise<void> {
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
                        const event = message.payload as EventRecord;
                        if (event.sessionId !== this.activeSessionId) {
                            return;
                        }
                        this.events.push(event);
                        this.events.sort((left: EventRecord, right: EventRecord) => {
                            return left.sequence - right.sequence;
                        });
                        if (shouldRefreshComposerContextUsage(event)) {
                            void this.updateComposerContextUsageFromExecution();
                        }
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
                    if (message.type === "session.deleted") {
                        void this.handleSessionDeleted(message.payload as {
                            sessionId: string;
                            sessionType: "normal" | "project";
                            projectId: string | null;
                        });
                    }
                },
            });
            this.webSocketClient.connect();
            await this.webSocketClient.waitUntilOpen();
        },

        /**
         * addClipboardImageAttachment：把剪贴板图片登记为临时附件草稿。
         *
         * @param file 剪贴板图片文件。
         * @returns 登记完成后没有返回值。
         */
        async addClipboardImageAttachment(file: File): Promise<void> {
            const fileName = file.name || `clipboard-${Date.now()}.png`;
            const temporary = await this.requireRealtimeRequest<{
                /** temporaryAttachmentId: 临时附件 ID。 */
                temporaryAttachmentId: string;
                /** storageFileName: 临时存储文件名。 */
                storageFileName: string;
                /** relativePath: 临时附件相对中心目录路径。 */
                relativePath: string;
            }>("attachment.temporary.create", {
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
                await this.requireRealtimeRequest<{
                    /** attachmentId: 正式附件 ID。 */
                    attachmentId: string;
                    /** relativePath: 正式附件相对中心目录路径。 */
                    relativePath: string;
                }>("attachment.commit", {
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

/**
 * mapPendingEditToComposerFile：把中心服务编辑记录转换为输入区展示模型。
 *
 * @param record 中心服务待确认编辑记录。
 * @returns 输入区编辑文件行。
 */
function mapPendingEditToComposerFile(record: PendingEditRecord) {
    return {
        editId: record.editId,
        filePath: record.filePath,
        changeKind: record.changeKind,
        status: record.status,
        previousEditLabel: "编辑前",
        currentEditLabel: "当前文件",
        diffLines: [
            ...Array.from({
                length: record.removedLines,
            }, (_, index) => {
                return {
                    kind: "removed" as const,
                    content: `-${index + 1}`,
                };
            }),
            ...Array.from({
                length: record.addedLines,
            }, (_, index) => {
                return {
                    kind: "added" as const,
                    content: `+${index + 1}`,
                };
            }),
        ],
    };
}

/**
 * shouldRefreshComposerContextUsage：判断事件是否代表模型响应上下文发生变化。
 *
 * @param event 中心服务实时事件。
 * @returns 需要刷新输入框当前窗口 token 总览时返回 true。
 */
function shouldRefreshComposerContextUsage(event: EventRecord): boolean {
    return event.eventType === "model.stream.started"
        || event.eventType === "model.stream.delta"
        || event.eventType === "model.stream.completed"
        || event.eventType === "model.tool.result.appended"
        || event.eventType === "message.created"
        || event.eventType === "message.assistant.created";
}
