/**
 * 阶段 5 桌面壳配置静态检查。
 *
 * 用途：验证桌面壳具备端口、中心目录、远程 Web 账号密码、通知权限和外部目录提示能力。
 * 关键逻辑：读取 Electron 主进程、preload 和统一前端源码，检查白名单 IPC、渲染桥接和 UI 文案。
 * 参数：无。
 * 返回值：检查通过时正常退出；任一断言失败时抛错并返回非零退出码。
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * assertIncludes：断言源码包含指定片段。
 *
 * @param source 源码文本。
 * @param fragment 必须出现的源码片段。
 * @param message 缺失时抛出的中文错误。
 * @returns 片段存在时没有返回值。
 */
function assertIncludes(source: string, fragment: string, message: string): void {
  if (!source.includes(fragment)) {
    throw new Error(message);
  }
}

/**
 * main：执行桌面壳配置检查。
 *
 * @returns 检查完成后没有返回值。
 */
async function main(): Promise<void> {
  // root: 检查脚本固定从仓库根目录执行。
  const root = process.cwd();
  // mainSource: Electron 主进程源码。
  const mainSource = await readFile(join(root, "apps", "desktop-shell", "src", "main.ts"), "utf-8");
  // preloadSource: Electron preload 源码。
  const preloadSource = await readFile(join(root, "apps", "desktop-shell", "src", "preload.ts"), "utf-8");
  // storeSource: 统一前端状态入口源码。
  const storeSource = await readFile(join(root, "apps", "frontend", "src", "stores", "app.ts"), "utf-8");
  // desktopActionsSource: 桌面壳动作拆分源码，保存中心服务配置和目录选择逻辑。
  const desktopActionsSource = await readFile(
    join(root, "apps", "frontend", "src", "stores", "app-desktop-actions.ts"),
    "utf-8",
  );
  // centerViewSource: 中心服务页面源码，进入页面后直接展示编辑面板。
  const centerViewSource = await readFile(
    join(root, "apps", "frontend", "src", "views", "Center", "RouterIndex.vue"),
    "utf-8",
  );

  assertIncludes(mainSource, "zhixin:center-config-update", "桌面壳缺少中心服务配置更新 IPC");
  assertIncludes(mainSource, "zhixin:access-account-save", "桌面壳缺少远程 Web 账号密码保存 IPC");
  assertIncludes(mainSource, "zhixin:notification-permission", "桌面壳缺少系统通知权限检测 IPC");
  assertIncludes(mainSource, "access.json", "桌面壳没有写入中心服务访问控制配置");
  assertIncludes(mainSource, "isExternalCenterDirectory", "桌面壳状态没有暴露外部中心目录标志");
  assertIncludes(preloadSource, "updateCenterConfig", "preload 没有暴露中心服务配置更新能力");
  assertIncludes(preloadSource, "saveAccessAccount", "preload 没有暴露远程 Web 账号密码保存能力");
  assertIncludes(preloadSource, "getNotificationPermission", "preload 没有暴露系统通知权限检测能力");
  assertIncludes(storeSource, "createDesktopActions", "前端状态入口没有挂载桌面壳动作集合");
  assertIncludes(desktopActionsSource, "syncDesktopStatus", "前端状态没有同步桌面壳中心服务配置");
  assertIncludes(desktopActionsSource, "saveDesktopConfig", "前端状态没有保存桌面壳配置");
  assertIncludes(desktopActionsSource, "selectCenterDirectory", "前端状态没有选择中心目录能力");
  assertIncludes(desktopActionsSource, "saveRemoteAccessAccount", "前端状态没有保存远程 Web 账号密码");
  assertIncludes(desktopActionsSource, "saveNotificationConfig", "前端状态没有把系统通知权限同步给中心服务");
  assertIncludes(centerViewSource, "中心服务", "中心服务页面没有中心服务配置入口");
  assertIncludes(centerViewSource, "center-service-form", "中心服务页面没有直接展示编辑面板");
  assertIncludes(centerViewSource, "选择中心目录", "中心服务页面没有中心目录选择入口");
  assertIncludes(centerViewSource, "外部中心目录不会随程序目录删除", "中心服务页面没有外部中心目录删除提示");
}

void main().catch((error) => {
  // catch: 输出原始错误，方便定位桌面壳配置缺口。
  console.error(error);
  // exitCode: 交给 pnpm 返回非零状态。
  process.exitCode = 1;
});
