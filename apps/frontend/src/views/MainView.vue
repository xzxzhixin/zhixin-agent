<script setup lang="ts">
import {
  computed,
} from "vue";
import {
  useRoute,
  useRouter,
} from "vue-router";

import {
  useAppStore,
} from "@stores/app";
import WorkspaceRouteHost from "@views/WorkspaceRouteHost.vue";

/**
 * WorkspacePage：顶部工作台页面协议值。
 *
 * 来源：前端真实路由路径。
 * 含义：控制公共头部菜单高亮和跳转。
 * 格式：固定字符串枚举。
 * 默认值：chat。
 * 约束：页面业务不放在公共壳里，必须由各 RouterIndex.vue 承载。
 */
type WorkspacePage =
    | "chat"
    | "agent-management"
    | "providers"
    | "proxies"
    | "runtimes"
    | "usage"
    | "plugins"
    | "mcp"
    | "skills"
    | "center";

/**
 * WorkspaceMenuItem：公共顶部菜单项。
 *
 * 来源：需求中的工作台主导航。
 * 含义：定义页面路由、中文文案和宿主可见性。
 * 格式：页面值、标签和本机壳限定标记。
 * 默认值：无。
 * 约束：中心服务启停入口只能在桌面壳展示。
 */
interface WorkspaceMenuItem {
  /**
   * page: 页面协议值，和真实路由一一对应。
   */
  page: WorkspacePage;

  /**
   * label: 顶部菜单中文文案。
   */
  label: string;

  /**
   * desktopOnly: 是否只允许桌面壳展示。
   */
  desktopOnly: boolean;
}

// appStore：公共壳只读取运行时能力、连接状态和主题状态，不承载页面业务数据。
const appStore = useAppStore();
// route：当前真实路由，用于菜单高亮。
const route = useRoute();
// router：菜单切换写入 hash URL，保证刷新和直达可用。
const router = useRouter();
// activePage：由真实路由推导的当前页面，不使用 initial-page 传参。
const activePage = computed<WorkspacePage>(() => resolveWorkspacePageFromRoute(route.path));
// workspaceMenuItems：顶部主菜单，中心服务项受桌面壳能力限制。
const workspaceMenuItems: WorkspaceMenuItem[] = [
  {
    page: "chat",
    label: "对话",
    desktopOnly: false,
  },
  {
    page: "agent-management",
    label: "智能体管理",
    desktopOnly: false,
  },
  {
    page: "providers",
    label: "供应商",
    desktopOnly: false,
  },
  {
    page: "proxies",
    label: "网络代理",
    desktopOnly: false,
  },
  {
    page: "runtimes",
    label: "运行环境",
    desktopOnly: false,
  },
  {
    page: "usage",
    label: "用量统计",
    desktopOnly: false,
  },
  {
    page: "plugins",
    label: "插件",
    desktopOnly: false,
  },
  {
    page: "mcp",
    label: "MCP",
    desktopOnly: false,
  },
  {
    page: "skills",
    label: "skill",
    desktopOnly: false,
  },
  {
    page: "center",
    label: "中心服务",
    desktopOnly: true,
  },
];
// visibleMenuItems：Web 端不展示中心服务管理入口，避免误导用户可以在浏览器启停中心服务。
const visibleMenuItems = computed(() => workspaceMenuItems.filter((item) => {
  return !item.desktopOnly || appStore.runtime.capabilities.canManageCenterService;
}));

/**
 * switchPage：切换顶部工作台页面。
 *
 * @param page 目标页面。
 * @returns 切换完成后没有返回值。
 */
async function switchPage(page: WorkspacePage): Promise<void> {
  const targetPath = resolveWorkspacePagePath(page);
  if (route.path === targetPath) {
    return;
  }

  await router.push(targetPath);
  if (appStore.runtime.capabilities.canManageCenterService) {
    // Electron WebContents 在部分环境中会出现 hash 和菜单高亮已变、二级主体仍复用旧 DOM 的情况。
    // 桌面壳管理页面切换频率低，开发期和桌面端优先保证页面事实一致，因此以目标 hash 触发轻量重载兜底。
    window.location.reload();
  }
}

/**
 * resolveWorkspacePageFromRoute：把真实路由路径映射为顶部菜单页面。
 *
 * @param path 当前路由路径。
 * @returns 顶部菜单页面协议值。
 */
function resolveWorkspacePageFromRoute(path: string): WorkspacePage {
  const pagePath = path.replace(/^\//u, "");
  if (pagePath === "agent-management"
      || pagePath === "providers"
      || pagePath === "proxies"
      || pagePath === "runtimes"
      || pagePath === "usage"
      || pagePath === "plugins"
      || pagePath === "mcp"
      || pagePath === "skills"
      || pagePath === "center") {
    return pagePath;
  }

  return "chat";
}

/**
 * resolveWorkspacePagePath：把顶部菜单页面映射为真实路由路径。
 *
 * @param page 顶部菜单页面协议值。
 * @returns Vue Router 路径。
 */
function resolveWorkspacePagePath(page: WorkspacePage): string {
  if (page === "chat") {
    return "/chat";
  }

  return `/${page}`;
}

/**
 * formatConnectionState：把连接状态协议值转成中文。
 *
 * @param state 当前连接状态。
 * @returns 中文状态。
 */
function formatConnectionState(state: string): string {
  const labels: Record<string, string> = {
    connecting: "连接中",
    open: "已连接",
    retrying: "重连中",
    stopped: "已停止",
  };

  return labels[state] ?? "未知状态";
}
</script>

<template>
  <main class="app-shell workspace-shell">
    <section class="workspace">
      <header
          v-if="appStore.entryMode !== 'plugin-compact'"
          class="topbar"
      >
        <nav class="top-menu">
          <button
              v-for="item in visibleMenuItems"
              :key="item.page"
              class="top-menu-item"
              :class="{ active: activePage === item.page }"
              :aria-current="activePage === item.page ? 'page' : undefined"
              :data-active-page="activePage === item.page ? 'true' : 'false'"
              :data-route-path="resolveWorkspacePagePath(item.page)"
              type="button"
              @click="switchPage(item.page)"
          >
            {{ item.label }}
          </button>
        </nav>
        <div class="topbar-status">
          <strong>{{ formatConnectionState(appStore.connectionState) }}</strong>
          <button
              class="theme-toggle"
              type="button"
              :title="appStore.themeMode === 'dark' ? '切换亮色主题' : '切换暗黑主题'"
              @click="appStore.toggleTheme"
          >
            <span class="theme-icon">
              {{ appStore.themeMode === "dark" ? "☀" : "☾" }}
            </span>
          </button>
        </div>
      </header>

      <section class="workspace-slot">
        <WorkspaceRouteHost/>
      </section>
    </section>
  </main>
</template>

<style scoped>
.app-shell {
  height: 100vh;
  min-height: 0;
  overflow: hidden;
  background: var(--app-bg);
  color: var(--text-primary);
}

.workspace {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.topbar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 56px;
  padding: 0 18px;
  border-bottom: 1px solid var(--border-color);
  background: var(--panel-bg);
}

.top-menu {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow-x: auto;
}

.top-menu-item {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  height: 34px;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 6px;
  padding: 7px 10px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-weight: 500;
  line-height: 1;
}

.top-menu-item.active {
  border-bottom: 2px solid var(--zhixin-accent);
  background: color-mix(in srgb, var(--zhixin-accent) 18%, transparent);
  box-shadow: inset 0 -2px 0 var(--zhixin-accent);
  color: var(--text-primary);
  font-weight: 700;
}

.topbar-status {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 10px;
  color: var(--text-secondary);
  line-height: 1;
}

.theme-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--panel-bg);
  color: var(--text-primary);
  cursor: pointer;
  line-height: 1;
}

.theme-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1em;
  height: 1em;
  line-height: 1;
}

.workspace-slot {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

</style>
