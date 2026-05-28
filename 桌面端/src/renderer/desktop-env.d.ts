import { DesktopBridge } from "../main/preload";

declare global {
  interface Window {
    // zhixinDesktop：桌面端主进程白名单桥接能力。
    zhixinDesktop?: DesktopBridge;
  }
}

export {};
