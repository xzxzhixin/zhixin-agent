/**
 * 桌面窗口行为静态回归检查。
 *
 * 用途：覆盖桌面端启动默认最大化、关闭按钮退出/隐藏托盘选择和记忆关闭偏好的阻塞项。
 * 关键逻辑：只读取桌面壳主进程源码，检查窗口创建、关闭事件、托盘恢复和偏好持久化的必要信号。
 * 参数：无。
 * 返回值：检查通过时退出码为 0；缺少任一行为信号时退出码为 1。
 */
import {
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

// desktopMainPath: Electron 主进程源码路径，桌面窗口行为只允许在桌面壳内实现。
const desktopMainPath = join(
  process.cwd(),
  "apps",
  "desktop-shell",
  "src",
  "main.ts",
);

// desktopMainSource: 主进程源码文本，用于静态验证窗口和关闭链路。
const desktopMainSource = readFileSync(
  desktopMainPath,
  "utf-8",
);

/**
 * assertIncludes：断言源码包含指定行为信号。
 *
 * @param fragment 必须出现的源码片段。
 * @param message 缺失时输出的中文错误。
 * @returns 命中时没有返回值。
 */
function assertIncludes(fragment, message) {
  if (!desktopMainSource.includes(fragment)) {
    console.error(message);
    process.exitCode = 1;
  }
}

assertIncludes(
  "mainWindow.maximize()",
  "桌面端启动后必须主动最大化主窗口，不能停留在 Normal 1280x820。",
);

assertIncludes(
  "mainWindow.on(\"close\"",
  "桌面端必须接管窗口关闭事件，以便提供退出或隐藏托盘选择。",
);

assertIncludes(
  "event.preventDefault()",
  "窗口关闭选择隐藏托盘时必须阻止默认关闭，避免直接退出应用。",
);

assertIncludes(
  "closeActionPreference",
  "桌面端必须持久化关闭按钮偏好，支持记住直接退出或隐藏托盘。",
);

assertIncludes(
  "dialog.showMessageBox",
  "桌面端首次关闭窗口时必须弹出退出或隐藏托盘选择。",
);

assertIncludes(
  "mainWindow?.hide()",
  "桌面端关闭选择隐藏托盘时必须隐藏主窗口。",
);

assertIncludes(
  "mainWindow?.show()",
  "托盘菜单必须能重新显示已隐藏的主窗口。",
);
