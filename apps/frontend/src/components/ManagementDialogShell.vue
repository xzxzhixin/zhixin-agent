<script setup lang="ts">
/**
 * ManagementDialogShell：管理页配置弹框共享外壳。
 *
 * 用途：统一管理页弹框的视口高度、内容区滚动和底部操作区固定。
 * 关键逻辑：业务表单通过默认插槽进入滚动 body，保存、取消、刷新等按钮通过 footer 插槽固定到底部。
 */
withDefaults(defineProps<{
  /** modelValue: 弹框显隐状态，来源于页面本地 ref。 */
  modelValue: boolean;
  /** title: 弹框标题，来源于页面业务语义。 */
  title: string;
  /** width: Element Plus 弹框宽度，默认管理页使用 80vw。 */
  width?: string;
  /** dialogClass: 业务弹框类名，用于保留既有测试和局部样式选择器。 */
  dialogClass?: string;
  /** destroyOnClose: 关闭时是否销毁内容，长表单默认销毁避免旧草稿残留。 */
  destroyOnClose?: boolean;
}>(), {
  width: "80vw",
  dialogClass: "",
  destroyOnClose: true,
});

const emit = defineEmits<{
  /** update:modelValue: Element Plus v-model 桥接事件。 */
  "update:modelValue": [
    value: boolean,
  ];
}>();

/**
 * updateVisible：把 Element Plus 弹框显隐变化传回页面。
 *
 * @param value 下一次显隐状态。
 * @returns 没有返回值。
 */
function updateVisible(value: boolean): void {
  emit(
    "update:modelValue",
    value,
  );
}
</script>

<template>
  <el-dialog
      :model-value="modelValue"
      append-to-body
      :class="['management-config-dialog', 'management-dialog-shell', dialogClass]"
      :title="title"
      :width="width"
      :destroy-on-close="destroyOnClose"
      @update:model-value="updateVisible"
  >
    <section class="management-dialog-shell__layout">
      <div class="management-dialog-shell__body">
        <slot />
      </div>
      <footer class="management-dialog-shell__footer">
        <slot name="footer" />
      </footer>
    </section>
  </el-dialog>
</template>

<style scoped>
.management-dialog-shell__layout {
  display: flex;
  flex-direction: column;
  max-height: calc(80vh - 72px);
  min-height: 0;
}

.management-dialog-shell__body {
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding-right: 4px;
}

.management-dialog-shell__footer {
  align-items: center;
  border-top: 1px solid var(--el-border-color);
  display: flex;
  flex-shrink: 0;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 16px;
  padding-top: 16px;
}
</style>
