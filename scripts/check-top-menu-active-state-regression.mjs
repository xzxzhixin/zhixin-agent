/**
 * 顶部菜单激活态回归检查。
 *
 * 用途：防止工作台顶部菜单点击或直达路由后，当前菜单没有明确激活样式。
 * 关键逻辑：静态检查公共工作台壳的路由映射、按钮可观测属性和高对比激活样式。
 * 参数：无。
 * 返回值：检查通过时正常退出；缺少任一激活态信号时返回非零退出码。
 */
import {
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

// mainViewPath: 顶部菜单公共工作台壳源码路径。
const mainViewPath = join(
  process.cwd(),
  "apps",
  "frontend",
  "src",
  "views",
  "MainView.vue",
);

// routerPath: 前端路由源码路径，用于确认刷新直达 URL 仍命中公共壳和对应页面。
const routerPath = join(
  process.cwd(),
  "apps",
  "frontend",
  "src",
  "router.ts",
);

// mainView: 公共工作台壳源码文本。
const mainView = readFileSync(
  mainViewPath,
  "utf-8",
);

// routerSource: 路由源码文本。
const routerSource = readFileSync(
  routerPath,
  "utf-8",
);

/**
 * assertIncludes：检查源码中必须存在的明确文本。
 *
 * @param source 源码文本。
 * @param pattern 必须存在的文本。
 * @param message 缺失时输出的错误说明。
 * @returns 没有返回值。
 */
function assertIncludes(
  source,
  pattern,
  message,
) {
  if (!source.includes(pattern)) {
    console.error(message);
    process.exitCode = 1;
  }
}

// routeMappings: 顶部菜单页面和真实路由的一一对应关系。
const routeMappings = [
  [
    "chat",
    "Chat",
  ],
  [
    "agent-management",
    "AgentManagement",
  ],
  [
    "providers",
    "Providers",
  ],
  [
    "proxies",
    "Proxies",
  ],
  [
    "runtimes",
    "Runtimes",
  ],
  [
    "usage",
    "Usage",
  ],
  [
    "plugins",
    "Plugins",
  ],
  [
    "mcp",
    "Mcp",
  ],
  [
    "skills",
    "Skills",
  ],
  [
    "center",
    "Center",
  ],
];

assertIncludes(
  routerSource,
  "component: () => import(\"@views/MainView.vue\")",
  "工作台父路由必须挂载 MainView，顶部菜单刷新后才能保留公共壳。",
);
assertIncludes(
  routerSource,
  "redirect: \"/chat\"",
  "根路由必须重定向到 /chat，默认打开后应高亮“对话”。",
);
assertIncludes(
  mainView,
  "resolveWorkspacePageFromRoute(route.path)",
  "顶部菜单激活页必须从真实 route.path 推导，不能依赖临时本地状态。",
);
assertIncludes(
  mainView,
  ":class=\"{ active: activePage === item.page }\"",
  "顶部菜单按钮必须根据当前路由设置 active 类。",
);
assertIncludes(
  mainView,
  ":aria-current=\"activePage === item.page ? 'page' : undefined\"",
  "顶部菜单当前项必须设置 aria-current=page，便于浏览器自动化验证当前页。",
);
assertIncludes(
  mainView,
  ":data-active-page=\"activePage === item.page ? 'true' : 'false'\"",
  "顶部菜单当前项必须暴露 data-active-page，便于刷新后确认激活态仍正确。",
);
assertIncludes(
  mainView,
  ":data-route-path=\"resolveWorkspacePagePath(item.page)\"",
  "顶部菜单按钮必须暴露对应路由路径，便于验证点击菜单和 URL 一致。",
);
assertIncludes(
  mainView,
  "border-bottom: 2px solid var(--zhixin-accent);",
  "顶部菜单激活样式必须有清晰下划线，不能只靠弱背景色。",
);
assertIncludes(
  mainView,
  "box-shadow: inset 0 -2px 0 var(--zhixin-accent);",
  "顶部菜单激活样式必须有内侧强调线，保证暗色主题下可辨识。",
);
assertIncludes(
  mainView,
  "font-weight: 700;",
  "顶部菜单激活样式必须提升字重，保证截图中当前菜单明确。",
);

for (const [
  routePath,
  pageDirectory,
] of routeMappings) {
  assertIncludes(
    routerSource,
    `path: "${routePath}"`,
    `顶部菜单路由 ${routePath} 必须可直达。`,
  );
  assertIncludes(
    routerSource,
    `component: () => import("@views/${pageDirectory}/RouterIndex.vue")`,
    `顶部菜单路由 ${routePath} 必须加载 ${pageDirectory}/RouterIndex.vue。`,
  );
  if (routePath === "chat") {
    assertIncludes(
      mainView,
      "return \"chat\";",
      "顶部菜单激活映射必须把默认工作台页面识别为“对话”。",
    );
    assertIncludes(
      mainView,
      "return \"/chat\";",
      "顶部菜单“对话”跳转路径必须固定为 /chat。",
    );
    continue;
  }

  assertIncludes(
    mainView,
    `pagePath === "${routePath}"`,
    `顶部菜单激活映射必须识别 /${routePath}。`,
  );
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log("顶部菜单激活态回归检查通过。");
