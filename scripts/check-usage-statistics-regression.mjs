import {readFileSync} from "node:fs";

/**
 * readText：读取源码文本用于静态回归检查。
 *
 * @param {string} path 仓库内文件路径。
 * @returns {string} UTF-8 文本内容。
 */
function readText(path) {
  return readFileSync(path, "utf-8");
}

/**
 * assertIncludes：检查源码必须包含关键实现片段。
 *
 * @param {string} text 被检查源码。
 * @param {string} expected 必须出现的片段。
 * @param {string} message 失败说明。
 * @returns {void}
 */
function assertIncludes(text, expected, message) {
  if (!text.includes(expected)) {
    console.error(message);
    process.exit(1);
  }
}

/**
 * assertMatches：检查源码必须匹配关键正则。
 *
 * @param {string} text 被检查源码。
 * @param {RegExp} pattern 必须匹配的正则。
 * @param {string} message 失败说明。
 * @returns {void}
 */
function assertMatches(text, pattern, message) {
  if (!pattern.test(text)) {
    console.error(message);
    process.exit(1);
  }
}

const sessionDomain = readText("services/center/src/session-domain.ts");
const workflowDomain = readText("services/center/src/workflow-domain.ts");
const usageDomain = readText("services/center/src/usage-domain.ts");
const usageRoutes = readText("services/center/src/usage-routes.ts");
const usageRepository = readText("services/center/src/data-access/usage-repository.ts");
const usagePage = readText("apps/frontend/src/views/Usage/RouterIndex.vue");
const appStore = readText("apps/frontend/src/stores/app.ts");
const managementActions = readText("apps/frontend/src/stores/app-management-actions.ts");
const apiClient = readText("packages/api-client/src/index.ts");

assertIncludes(
  sessionDomain,
  "recordModelUsageAfterTurn",
  "真实对话完成后必须把模型返回用量写入 usage_records，不能只把 usage 放在事件 payload。",
);
assertMatches(
  sessionDomain,
  /recordModelUsageAfterTurn\([\s\S]*modelResult\.usage[\s\S]*sent\.sessionId/u,
  "用量写入必须使用本轮真实模型 usage，并关联当前会话。",
);
assertIncludes(
  sessionDomain,
  "projectId: session.projectId",
  "用量写入必须使用会话绑定项目 ID，普通会话才归入全局。",
);
assertIncludes(
  sessionDomain,
  "refreshUsageDailyStats(database)",
  "真实模型调用写入原始用量后必须刷新日聚合统计。",
);
assertIncludes(
  workflowDomain,
  "usage.recorded",
  "用量写入必须追加 usage.recorded 事件，便于审计和前端断线补齐。",
);
assertIncludes(
  usageDomain + usageRepository,
  "summaryType",
  "用量聚合接口必须返回总量、供应商维度和项目维度，不能只返回单一分组。",
);
assertIncludes(
  usageDomain + usageRepository,
  "provider-summary",
  "用量聚合接口必须包含供应商维度分组。",
);
assertIncludes(
  usageDomain + usageRepository,
  "project-summary",
  "用量聚合接口必须包含项目维度分组。",
);
assertIncludes(
  appStore,
  "usageDailyStats",
  "前端状态必须保存中心服务刷新后的 usage_daily_stats 结果。",
);
assertIncludes(
  managementActions,
  "this.usageDailyStats = result.refreshedDailyStats",
  "前端加载聚合统计时必须保存刷新后的日统计，不能丢弃服务端聚合结果。",
);
assertIncludes(
  usagePage,
  "totalUsageSummary",
  "用量统计页总量概览必须从真实聚合数据计算展示。",
);
assertIncludes(
  usagePage,
  "providerUsageSummaries",
  "用量统计页供应商维度必须从真实聚合数据渲染。",
);
assertIncludes(
  usagePage,
  "projectUsageSummaries",
  "用量统计页项目维度必须从真实聚合数据渲染。",
);
assertIncludes(
  usagePage,
  "usage-empty-state",
  "用量统计页无真实数据时必须显示空状态，不能展示静态占位图。",
);
for (const forbiddenText of [
  "<h2 class=\"section-title\">\n        聚合统计",
  "<h2 class=\"section-title\">\n        原始记录",
  "formatUsageJson",
]) {
  if (usagePage.includes(forbiddenText)) {
    console.error(`用量统计页不得继续展示面向开发排查的 JSON 列表或标题：${forbiddenText}`);
    process.exit(1);
  }
}
assertMatches(
  usagePage,
  /v-for="\([\s\S]*providerUsageSummaries/u,
  "供应商维度图表区域必须循环渲染真实供应商聚合数据。",
);
assertMatches(
  usagePage,
  /v-for="\([\s\S]*projectUsageSummaries/u,
  "项目维度图表区域必须循环渲染真实项目聚合数据。",
);
for (const signal of [
  "providerName",
  "modelName",
  "projectName",
]) {
  assertIncludes(
    apiClient + usageRoutes + usageDomain + usageRepository + usagePage + managementActions,
    signal,
    `用量统计必须支持 ${signal} 单一来源筛选。`,
  );
}
assertIncludes(
  usageRoutes,
  "resolveProviderIdByProviderName",
  "供应商名称筛选必须在服务端解析为明确 providerId，不能让前端猜 ID。",
);
assertIncludes(
  usageRepository,
  "projects.display_name = ?",
  "项目名称筛选必须使用 projects.display_name 单一事实源。",
);

console.log("用量统计回归检查通过。");
