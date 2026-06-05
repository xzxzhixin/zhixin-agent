import {
    nextTick,
    ref,
    type Ref,
} from "vue";

/**
 * UseMessageListAutoScrollResult：消息列表自动贴底能力。
 *
 * 来源：Chat 页面主滚动容器。
 * 含义：封装默认贴底、持续输出贴底和用户离底暂停逻辑。
 * 格式：Vue ref 与函数集合。
 * 默认值：进入页面时视为贴底。
 * 约束：只操作消息列表容器，不制造页面级滚动。
 */
export interface UseMessageListAutoScrollResult {
    /** messageListRef: 消息主滚动容器。 */
    messageListRef: Ref<HTMLElement | null>;
    /** isMessageListPinnedToBottom: 用户是否仍在底部。 */
    isMessageListPinnedToBottom: Ref<boolean>;
    /** updateMessageListPinnedState: 根据滚动位置刷新底部状态。 */
    updateMessageListPinnedState: () => void;
    /** scrollMessageListToBottom: 立即滚动到消息列表底部。 */
    scrollMessageListToBottom: (behavior?: ScrollBehavior) => void;
    /** requestAutoScrollToBottom: DOM 更新后按底部状态决定是否贴底。 */
    requestAutoScrollToBottom: (force: boolean) => void;
    /** pauseAutoScrollForHistoryView: 用户定位历史消息时暂停自动贴底。 */
    pauseAutoScrollForHistoryView: () => void;
    /** disposeMessageListAutoScroll: 释放自动贴底延迟任务。 */
    disposeMessageListAutoScroll: () => void;
}

/**
 * useMessageListAutoScroll：创建消息列表贴底控制能力。
 *
 * @returns 消息列表滚动状态和操作函数。
 */
export function useMessageListAutoScroll(): UseMessageListAutoScrollResult {
    // messageListRef: 只绑定 Chat 消息列表，避免页面根容器参与滚动。
    const messageListRef = ref<HTMLElement | null>(null);
    // isMessageListPinnedToBottom: true 时新消息和流式过程自动保持底部可见。
    const isMessageListPinnedToBottom = ref(true);
    // scrollGeneration: 每次请求自动贴底时递增，用于让旧的延迟滚动失效。
    let scrollGeneration = 0;
    // frameIds: 记录 requestAnimationFrame 任务，组件卸载时统一取消。
    const frameIds: number[] = [];
    // timeoutIds: 记录低频兜底滚动任务，解决 Markdown 和过程卡片高度延迟稳定的问题。
    const timeoutIds: number[] = [];
    // ignoreScrollEventUntil: 程序化贴底会触发 scroll 事件，短时间内不把它误判为用户离底。
    let ignoreScrollEventUntil = 0;

    /**
     * markProgrammaticScroll：标记当前滚动来自自动贴底。
     *
     * @returns 没有返回值。
     */
    function markProgrammaticScroll(): void {
        ignoreScrollEventUntil = window.performance.now() + 180;
    }

    /**
     * updateMessageListPinnedState：根据滚动位置记录用户是否在底部。
     *
     * @returns 没有返回值。
     */
    function updateMessageListPinnedState(): void {
        const container = messageListRef.value;
        if (!container) {
            return;
        }
        if (window.performance.now() <= ignoreScrollEventUntil) {
            isMessageListPinnedToBottom.value = true;
            return;
        }
        // bottomThreshold: 允许少量像素误差，避免高 DPI 或子像素布局导致用户已在底部仍被判定离底。
        const bottomThreshold = 24;
        const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        isMessageListPinnedToBottom.value = distanceToBottom <= bottomThreshold;
    }

    /**
     * scrollMessageListToBottom：把消息主滚动容器滚动到底部。
     *
     * @param behavior 滚动行为。
     * @returns 没有返回值。
     */
    function scrollMessageListToBottom(behavior: ScrollBehavior = "auto"): void {
        const container = messageListRef.value;
        if (!container) {
            return;
        }
        markProgrammaticScroll();
        container.scrollTo({
            top: container.scrollHeight,
            behavior,
        });
        container.scrollTop = container.scrollHeight;
        isMessageListPinnedToBottom.value = true;
    }

    /**
     * scheduleStableBottomPin：跨多帧贴底，等待长消息、过程卡片和 Markdown 高度完成布局。
     *
     * @param generation 当前贴底请求版本。
     * @returns 没有返回值。
     */
    function scheduleStableBottomPin(generation: number): void {
        const scrollIfCurrent = (): void => {
            if (generation !== scrollGeneration) {
                return;
            }
            scrollMessageListToBottom();
        };

        scrollIfCurrent();
        for (let index = 0; index < 4; index += 1) {
            const frameId = window.requestAnimationFrame(scrollIfCurrent);
            frameIds.push(frameId);
        }
        for (const delayMs of [
            60,
            160,
        ]) {
            const timeoutId = window.setTimeout(scrollIfCurrent, delayMs);
            timeoutIds.push(timeoutId);
        }
    }

    /**
     * requestAutoScrollToBottom：在 DOM 更新后按底部状态决定是否贴底。
     *
     * @param force 是否强制贴底；切换会话和发送消息需要强制。
     * @returns 没有返回值。
     */
    function requestAutoScrollToBottom(force: boolean): void {
        void nextTick(() => {
            if (force || isMessageListPinnedToBottom.value) {
                scrollGeneration += 1;
                scheduleStableBottomPin(scrollGeneration);
            }
        });
    }

    /**
     * pauseAutoScrollForHistoryView：用户查看历史定位时暂停自动贴底。
     *
     * @returns 没有返回值。
     */
    function pauseAutoScrollForHistoryView(): void {
        isMessageListPinnedToBottom.value = false;
    }

    /**
     * disposeMessageListAutoScroll：组件销毁时释放所有挂起的浏览器任务。
     *
     * @returns 没有返回值。
     */
    function disposeMessageListAutoScroll(): void {
        scrollGeneration += 1;
        while (frameIds.length > 0) {
            const frameId = frameIds.pop();
            if (frameId !== undefined) {
                window.cancelAnimationFrame(frameId);
            }
        }
        while (timeoutIds.length > 0) {
            const timeoutId = timeoutIds.pop();
            if (timeoutId !== undefined) {
                window.clearTimeout(timeoutId);
            }
        }
    }

    return {
        messageListRef,
        isMessageListPinnedToBottom,
        updateMessageListPinnedState,
        scrollMessageListToBottom,
        requestAutoScrollToBottom,
        pauseAutoScrollForHistoryView,
        disposeMessageListAutoScroll,
    };
}
