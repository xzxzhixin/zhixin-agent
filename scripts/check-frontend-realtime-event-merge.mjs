import fs from "node:fs";

const storePath = "apps/frontend/src/stores/app-conversation-actions.ts";
const appStorePath = "apps/frontend/src/stores/app.ts";
const store = fs.readFileSync(storePath, "utf8");
const appStore = fs.readFileSync(appStorePath, "utf8");
const combinedStore = `${store}\n${appStore}`;

if (!store.includes("replaceRealtimeEvent(event)")) {
  throw new Error("WebSocket event.appended 必须立即合并实时事件。");
}

if (!store.includes("resolveEventSessionId(event)")) {
  throw new Error("WebSocket event.appended 必须通过统一函数解析事件所属会话，不能只依赖 EventRecord 顶层 sessionId。");
}

if (!store.includes("payload.sessionId")) {
  throw new Error("turn.state.changed 等终态事件的明确 sessionId 在 payload 中，前端不能因为顶层 sessionId 缺失而丢弃。");
}

if (!combinedStore.includes("mergeSnapshotEvents")) {
  throw new Error("快照事件必须和实时事件合并，不能用旧快照覆盖运行中事件。");
}

if (!store.includes("event.sequence")) {
  throw new Error("实时事件合并必须保留 sequence 排序。");
}

if (!store.includes("EVENT_TYPES.MODEL_STREAM_COMPLETED")) {
  throw new Error("模型流结束仍需要通过共享事件常量触发快照兜底。");
}
