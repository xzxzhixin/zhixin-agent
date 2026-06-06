import {
  computed,
} from "vue";

import type {
  useAppStore,
} from "@stores/app";
import {
  formatContextUsageTooltip,
  formatContextWindowLimit,
} from "@views/Chat/chat-view-helpers";

/**
 * useComposerContextUsage：封装输入区上下文 token 用量展示。
 *
 * @param appStore 前端全局状态容器，提供模型窗口、token 统计、引用和附件数量。
 * @returns 输入区和智能体弹窗复用的百分比、进度值、明细和 tooltip。
 */
export function useComposerContextUsage(
  appStore: ReturnType<typeof useAppStore>,
) {
  // composerContextPercentText：当前窗口上下文占用百分比，外层只展示百分比避免输入区底栏过长。
  const composerContextPercentText = computed(() => {
    const limitTokens = appStore.composerSelectedModelContextWindowTokens;
    if (!Number.isFinite(limitTokens) || limitTokens <= 0) {
      return "0.0%";
    }

    const usedTokens = Number.isFinite(appStore.composerSettings.contextUsedTokens)
      ? appStore.composerSettings.contextUsedTokens
      : 0;
    return `${((usedTokens / limitTokens) * 100).toFixed(1)}%`;
  });

  // composerContextProgressValue：Element Plus 进度组件只接收数字百分比，外显文案仍保留一位小数。
  const composerContextProgressValue = computed(() => {
    const limitTokens = appStore.composerSelectedModelContextWindowTokens;
    if (!Number.isFinite(limitTokens) || limitTokens <= 0) {
      return 0;
    }

    const usedTokens = Number.isFinite(appStore.composerSettings.contextUsedTokens)
      ? appStore.composerSettings.contextUsedTokens
      : 0;
    // actualPercent：Element Plus 圆形进度只接受 0-100；真实超窗比例继续由右侧百分比文本展示。
    const actualPercent = Number(((usedTokens / limitTokens) * 100).toFixed(1));
    return Math.min(
      100,
      Math.max(
        0,
        actualPercent,
      ),
    );
  });

  // composerContextUsageText：当前窗口上下文占用明细，供智能体弹窗或可访问标题复用。
  const composerContextUsageText = computed(() => {
    const limitTokens = appStore.composerSelectedModelContextWindowTokens;
    if (!Number.isFinite(limitTokens) || limitTokens <= 0) {
      return `${composerContextPercentText.value} · 0 / 未配置窗口 上下文`;
    }

    const usedTokens = Number.isFinite(appStore.composerSettings.contextUsedTokens)
      ? appStore.composerSettings.contextUsedTokens
      : 0;
    const usedTokenText = usedTokens > 0
      ? formatContextWindowLimit(usedTokens)
      : "0";
    const limitTokenText = formatContextWindowLimit(limitTokens);
    return `${composerContextPercentText.value} · ${usedTokenText} / ${limitTokenText} 上下文`;
  });

  // contextUsageTooltip：展示真实 token 统计明细，但隐藏 tokenizer 实现名称。
  const contextUsageTooltip = computed(() => {
    const usedTokens = Number.isFinite(appStore.composerSettings.contextUsedTokens)
      ? appStore.composerSettings.contextUsedTokens
      : 0;
    const limitTokens = appStore.composerSelectedModelContextWindowTokens;
    return formatContextUsageTooltip({
      usedTokens,
      limitTokens,
      percentText: composerContextPercentText.value,
      modelId: appStore.composerSettings.selectedModel,
      referenceCount: appStore.draft.references.length,
      attachmentCount: appStore.draft.attachments.length,
      source: appStore.composerSettings.contextTokenizerSource
        ? "中心服务 token 统计"
        : "中心服务 token 统计待返回",
    });
  });

  return {
    composerContextPercentText,
    composerContextProgressValue,
    composerContextUsageText,
    contextUsageTooltip,
  };
}
