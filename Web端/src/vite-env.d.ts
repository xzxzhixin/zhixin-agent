/// <reference types="vite/client" />

// vue：允许 TypeScript 识别单文件组件导入。
declare module "*.vue" {
  // DefineComponent：Vue 单文件组件的通用类型。
  import type { DefineComponent } from "vue";
  // component：组件默认导出。
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  // export：让 .vue 文件可以被 TS 正常导入。
  export default component;
}
