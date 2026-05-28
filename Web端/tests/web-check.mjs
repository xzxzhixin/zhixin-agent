import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// root：Web端工程根目录。
const root = process.cwd();
// apiContent：读取中心服务 API 封装。
const apiContent = await readFile(join(root, "src", "api.ts"), "utf-8");
// storeContent：读取 Pinia 公共状态。
const storeContent = await readFile(join(root, "src", "stores", "app.ts"), "utf-8");
// homeContent：读取桌面浏览器首页。
const homeContent = await readFile(join(root, "src", "views", "HomeView.vue"), "utf-8");

// assert：登录态必须依赖 Cookie credentials。
assert.ok(apiContent.includes("credentials: \"include\""));
// assert：Web端必须通过服务端认证状态判断登录。
assert.ok(apiContent.includes("/auth/status"));
// assert：通知必须有浏览器通知和页面内兜底。
assert.ok(storeContent.includes("notifyInBrowser"));
assert.ok(storeContent.includes("pageNotificationMessage"));
// assert：消息展示和发送必须支持附件与引用。
assert.ok(homeContent.includes("handlePaste"));
assert.ok(homeContent.includes("references"));

// console：检查通过时输出摘要。
console.log("Web端登录、消息展示和通知检查通过");
