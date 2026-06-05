import {
    computed,
    ref,
    type ComputedRef,
    type Ref,
} from "vue";

/**
 * UseComposerPanelResizeResult：输入面板拖拽高度控制能力。
 *
 * 来源：Chat 页面底部输入区。
 * 含义：用外层面板高度参与 flex 回流，避免 textarea 自身 resize 造成消息区重叠。
 * 格式：高度样式、拖拽状态、手柄文案和生命周期函数。
 * 默认值：面板初始高度 184px。
 * 约束：高度被限制在 132px 到 420px 之间。
 */
export interface UseComposerPanelResizeResult {
    /** composerPanelHeight: 当前输入面板高度，单位 px。 */
    composerPanelHeight: Ref<number>;
    /** isComposerResizing: 当前是否正在拖拽输入面板。 */
    isComposerResizing: Ref<boolean>;
    /** composerPanelStyle: 输入面板 CSS 变量样式。 */
    composerPanelStyle: ComputedRef<Record<string, string>>;
    /** composerResizeHandleLabel: 拖拽手柄无障碍说明。 */
    composerResizeHandleLabel: string;
    /** startComposerResize: 开始拖拽输入区高度。 */
    startComposerResize: (event: PointerEvent) => void;
    /** stopComposerResize: 停止拖拽并释放全局监听。 */
    stopComposerResize: () => void;
}

/**
 * useComposerPanelResize：创建输入面板高度拖拽控制。
 *
 * @returns 输入面板高度状态和拖拽处理函数。
 */
export function useComposerPanelResize(): UseComposerPanelResizeResult {
    // minComposerPanelHeight: 输入区最小高度，保证工具栏、标签和两行文本仍可正常显示。
    const minComposerPanelHeight = 132;
    // maxComposerPanelHeight: 输入区最大高度，避免小屏幕上挤空消息列表。
    const maxComposerPanelHeight = 420;
    // composerPanelHeight: 默认接近参考图的中等输入区高度，用户可通过顶部手柄调整。
    const composerPanelHeight = ref(184);
    // isComposerResizing: 拖拽期间给页面添加稳定光标和禁选状态。
    const isComposerResizing = ref(false);
    // resizeStartY: 拖拽开始时的指针纵坐标。
    let resizeStartY = 0;
    // resizeStartHeight: 拖拽开始时的输入区高度。
    let resizeStartHeight = composerPanelHeight.value;

    const composerPanelStyle = computed(() => {
        return {
            "--composer-panel-height": `${composerPanelHeight.value}px`,
        };
    });

    /**
     * clampComposerPanelHeight：把用户拖拽高度限制在可用范围内。
     *
     * @param nextHeight 拖拽计算出的候选高度。
     * @returns 限制后的输入面板高度。
     */
    function clampComposerPanelHeight(nextHeight: number): number {
        return Math.min(
            maxComposerPanelHeight,
            Math.max(
                minComposerPanelHeight,
                nextHeight,
            ),
        );
    }

    /**
     * updateComposerResize：根据指针移动更新输入面板高度。
     *
     * @param event 浏览器指针事件。
     * @returns 没有返回值。
     */
    function updateComposerResize(event: PointerEvent): void {
        if (!isComposerResizing.value) {
            return;
        }
        // deltaY: 手柄在输入区顶部，向上拖动应该增高，向下拖动应该降低。
        const deltaY = resizeStartY - event.clientY;
        composerPanelHeight.value = clampComposerPanelHeight(resizeStartHeight + deltaY);
    }

    /**
     * stopComposerResize：结束拖拽并释放 document 监听。
     *
     * @returns 没有返回值。
     */
    function stopComposerResize(): void {
        if (!isComposerResizing.value) {
            return;
        }
        isComposerResizing.value = false;
        document.removeEventListener(
            "pointermove",
            updateComposerResize,
        );
        document.removeEventListener(
            "pointerup",
            stopComposerResize,
        );
        document.removeEventListener(
            "pointercancel",
            stopComposerResize,
        );
    }

    /**
     * startComposerResize：记录拖拽起点并监听后续指针移动。
     *
     * @param event 输入区顶部手柄 pointerdown 事件。
     * @returns 没有返回值。
     */
    function startComposerResize(event: PointerEvent): void {
        event.preventDefault();
        resizeStartY = event.clientY;
        resizeStartHeight = composerPanelHeight.value;
        isComposerResizing.value = true;
        document.addEventListener(
            "pointermove",
            updateComposerResize,
        );
        document.addEventListener(
            "pointerup",
            stopComposerResize,
        );
        document.addEventListener(
            "pointercancel",
            stopComposerResize,
        );
    }

    return {
        composerPanelHeight,
        isComposerResizing,
        composerPanelStyle,
        composerResizeHandleLabel: "拖动调整输入框高度",
        startComposerResize,
        stopComposerResize,
    };
}
