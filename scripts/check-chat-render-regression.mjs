/**
 * 对话页渲染白屏回归检查。
 *
 * 用途：覆盖 T01 进入 /chat 首屏时读取项目引用 getter 导致 Vue render error 的白屏根因。
 * 关键逻辑：Chat 页面会在模板中读取 canUseProjectReferences，因此 app store 必须导入该 getter 依赖的
 * resolveComposerProjectId，避免运行时 ReferenceError 中断 #app 渲染。
 */
import {
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

// appStorePath: 前端统一 Pinia 状态容器源码。
const appStorePath = join(
  process.cwd(),
  "apps",
  "frontend",
  "src",
  "stores",
  "app.ts",
);
// appHelpersPath: app store 使用的辅助函数源码。
const appHelpersPath = join(
  process.cwd(),
  "apps",
  "frontend",
  "src",
  "stores",
  "app-helpers.ts",
);
// chatPagePath: 浏览器端对话页路由入口源码。
const chatPagePath = join(
  process.cwd(),
  "apps",
  "frontend",
  "src",
  "views",
  "Chat",
  "RouterIndex.vue",
);

// appStoreSource: 用于检查 getter 依赖导入和调用关系的源码文本。
const appStoreSource = readFileSync(
  appStorePath,
  "utf-8",
);
// appHelpersSource: 用于确认 helper 对外导出名称没有被误改的源码文本。
const appHelpersSource = readFileSync(
  appHelpersPath,
  "utf-8",
);
// chatPageSource: 用于确认白屏触发路径仍覆盖真实对话页模板的源码文本。
const chatPageSource = readFileSync(
  chatPagePath,
  "utf-8",
);

if (!chatPageSource.includes("appStore.canUseProjectReferences")) {
  console.error("Chat 页面必须通过 canUseProjectReferences 控制项目引用入口，本检查需随模板变更更新。");
  process.exitCode = 1;
}

if (!appHelpersSource.includes("export function resolveComposerProjectId")) {
  console.error("app-helpers.ts 必须导出 resolveComposerProjectId，供输入区解析明确项目上下文。");
  process.exitCode = 1;
}

if (!appStoreSource.includes("canUseProjectReferences(state): boolean")) {
  console.error("app.ts 必须保留 canUseProjectReferences getter，避免项目引用入口散落到页面模板。");
  process.exitCode = 1;
}

if (!appStoreSource.includes("resolveComposerProjectId(state)")) {
  console.error("canUseProjectReferences 必须继续复用 resolveComposerProjectId，保持项目上下文解析口径唯一。");
  process.exitCode = 1;
}

if (!/import\s*\{[\s\S]*\bresolveComposerProjectId\b[\s\S]*\}\s*from\s*"\.\/app-helpers"/u.test(appStoreSource)) {
  console.error("app.ts 使用 resolveComposerProjectId 前必须从 ./app-helpers 显式导入，避免 /chat 渲染期 ReferenceError 白屏。");
  process.exitCode = 1;
}
