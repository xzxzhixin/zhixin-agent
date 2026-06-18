# 监督预算与实时渲染修正设计

## 目标

- ⏳ 监督层三个预算 `maxSupervisorAttempts`、`continuationRetryBudget` 和 `toolFailureRetryBudget` 默认全部为 `6`。
- ⏳ 监督层在续跑成功后重置三个预算计数，让下一类问题重新获得完整 6 次预算。
- ⏳ 前端收到当前会话实时事件后立即刷新全局事件数组新引用，过程卡片不等最终快照才显示。

## 范围

- ⏳ 本设计覆盖中心服务 `agent-runtime` 监督预算计数、默认预算和前端实时事件合并。
- ⏳ 本设计不改变 Deep Agents 工具调用协议，不增加提示词解析，不写死具体工具名称。
- ⏳ 本设计不改变 WebSocket 协议和数据库结构。

## 设计要点

- ⏳ 默认预算对象固定返回 `{ maxSupervisorAttempts: 6, continuationRetryBudget: 6, toolFailureRetryBudget: 6 }`。
- ⏳ 监督层保存最近一次消耗预算的失败原因；下一次候选如果不再命中同一个预算失败原因，视为续跑成功并重置 `maxSupervisorAttempts` 当前窗口计数、`continuationRetryCount`、`toolFailureRetryCount` 和最近失败原因。
- ⏳ 如果候选继续命中同一个预算失败原因，则按原有逻辑递增对应计数，直到 6 次预算耗尽后进入等待用户或失败。
- ⏳ 预算重置只基于模型诊断、工具失败事件和候选结果，不根据用户提示词、工具名称或自然语言内容做硬编码判断。
- ⏳ 前端 `replaceRealtimeEvent` 合并事件时通过统一写入入口更新 `appStore.events` 新数组引用，并递增 `eventsRevision`，保证过程卡片和模型中途 Markdown 计算链路立即更新。
- ⏳ 快照事件继续通过 `mergeSnapshotEvents` 合并，旧快照不能覆盖已经收到的实时事件。

## 验收口径

- ⏳ 静态检查能看到三个默认监督预算值都是 `6`。
- ⏳ 监督层存在续跑成功后重置当前预算窗口计数和分类预算计数的独立方法或等价逻辑。
- ⏳ 同一失败原因连续出现时继续消耗对应预算，不会无限重置。
- ⏳ 前端实时事件合并后更新 `events` 新数组引用并递增 `eventsRevision`。
- ⏳ 过程卡片和模型中途 Markdown 仍直接消费实时事件，不依赖最终助手消息固化。
