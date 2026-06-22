# 中心服务统一日志配置实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将中心服务日志改为统一管线，同步写控制台与文件，日志等级输出字符串且可通过中心服务配置动态调整。

**架构：** 中心服务新增配置文件读写模块，日志管线在每次写入时按运行环境和配置解析有效等级。API 暴露读取与保存日志配置，前端中心服务页面直接操作中心服务配置，不经过桌面壳本机配置。

**技术栈：** Node.js、TypeScript、Fastify、Vue 3、Pinia、Element Plus、IDEA MCP 静态检查。

---

## 文件结构

- 修改：`需求.md`、`设计.md`、`架构.md`、`功能清单与关系.md`，同步日志统一管线、配置入口和回归关系。
- 创建：`services/center/src/system-config.ts`，负责中心服务配置文件读取、写入、默认日志等级和日志等级校验。
- 修改：`services/center/src/logger.ts`，统一控制台和文件输出，脱敏敏感字段，输出字符串等级，移除流式硬过滤。
- 创建：`services/center/src/api/center-config-routes.ts`，注册日志配置读取与保存接口。
- 修改：`services/center/src/api/api-routes.ts`，挂载中心配置路由。
- 修改：`apps/frontend/src/stores/app-types.ts`、`apps/frontend/src/stores/app.ts`、`apps/frontend/src/stores/app-desktop-actions.ts`，增加日志配置草稿和读写动作。
- 修改：`apps/frontend/src/views/Center/RouterIndex.vue`，增加日志等级配置选项。

## 任务 1：文档事实源同步

**文件：**
- 修改：`需求.md`
- 修改：`设计.md`
- 修改：`架构.md`
- 修改：`功能清单与关系.md`

- [ ] **步骤 1：定位旧日志口径**

运行：`rg "日志|流式|控制台|文件日志|CenterLogger" 需求.md 设计.md 架构.md 功能清单与关系.md`

预期：能定位“控制台过滤中间态”“文件日志排除流式输出”等旧表述。

- [ ] **步骤 2：修订事实源**

将事实源改为：

```text
中心服务日志使用统一管线，同一条日志同步输出到控制台和中心目录 logs 文件。
日志 level 字段使用 debug/info/warn/error 字符串。
日志等级由中心服务配置系统配置文件保存，开发环境默认 debug，生产/打包默认 info。
开发环境默认值优先于打包默认值；用户显式配置可动态覆盖有效日志等级。
流式输出不再被日志管线硬过滤，只受日志等级控制。
配置入口位于中心服务页面，不写入 Electron desktop-config.json。
API Key、密码、token、authorization、cookie 等敏感字段必须脱敏。
```

- [ ] **步骤 3：回查文档一致性**

运行：`rg "不输出流式|排除流式|控制台.*过滤|level.*数字|desktop-config.*日志" 需求.md 设计.md 架构.md 功能清单与关系.md`

预期：不再存在与本次设计冲突的旧口径；如果保留历史背景，必须明确标注已废弃。

## 任务 2：中心服务配置文件模块

**文件：**
- 创建：`services/center/src/system-config.ts`

- [ ] **步骤 1：定义日志等级类型和配置结构**

新增类型：

```ts
export type CenterLogLevel = "debug" | "info" | "warn" | "error";

export interface CenterLogConfigView {
    configuredLevel: CenterLogLevel | null;
    effectiveLevel: CenterLogLevel;
    environmentDefaultLevel: CenterLogLevel;
    runtimeEnvironment: "development" | "production";
    updatedAt: string | null;
}
```

- [ ] **步骤 2：实现配置文件读写**

配置文件路径固定为：

```text
{centerDirectory}/config/system-config.json
```

写入时创建 `config` 目录。读取失败或 JSON 非法时返回默认配置，不抛出导致中心服务启动失败。

- [ ] **步骤 3：实现有效等级解析**

规则：

```text
ZHIXIN_LOG_LEVEL 合法时优先作为进程环境覆盖。
配置文件 configuredLevel 非 null 时作为用户显式配置。
NODE_ENV === "production" 时环境默认 info。
其他情况默认 debug。
```

注意：环境变量覆盖只影响运行时有效等级，不回写配置文件。

## 任务 3：统一日志管线

**文件：**
- 修改：`services/center/src/logger.ts`

- [ ] **步骤 1：扩展 CenterLogger 方法**

`CenterLogger` 保留 `info`、`error`，新增 `debug`、`warn`，所有方法调用同一个 `write`。

- [ ] **步骤 2：统一控制台和文件输出**

`write` 组装一行 JSON：

```ts
{
    level: "info",
    occurredAt: formatCenterLocalDateTime(),
    event,
    payload: sanitizeLogPayload(payload),
}
```

同一行同时写入 `process.stdout` 和 `RotatingCenterLogStream`。不再保留 `shouldSkipConsoleLog`、`shouldSkipFileLog`。

- [ ] **步骤 3：加入等级过滤**

等级顺序固定：

```text
debug < info < warn < error
```

低于有效等级的日志不输出。流式日志调用点如果使用 `debug`，则开发默认可见，生产默认不可见；生产配置成 debug 后可见。

- [ ] **步骤 4：实现敏感字段脱敏**

递归处理普通对象和数组，字段名包含下列片段时替换为 `"[已脱敏]"`：

```text
apiKey
apikey
authorization
cookie
password
token
secret
```

递归深度设置合理上限，超过后写 `"[日志字段过深已省略]"`。

- [ ] **步骤 5：保留 centerConsoleLogger 兼容入口**

`centerConsoleLogger.info/error` 内部调用全局或临时控制台 logger，但输出格式仍走统一 JSON 结构，避免现有调用点一次性大改。

## 任务 4：中心日志配置 API

**文件：**
- 创建：`services/center/src/api/center-config-routes.ts`
- 修改：`services/center/src/api/api-routes.ts`

- [ ] **步骤 1：新增读取接口**

注册：

```text
GET /api/center/log-config
```

返回统一响应包，data 为 `CenterLogConfigView`。

- [ ] **步骤 2：新增保存接口**

注册：

```text
POST /api/center/log-config
```

请求体：

```ts
{
    configuredLevel: "debug" | "info" | "warn" | "error" | null;
}
```

保存后返回最新 `CenterLogConfigView`。非法等级返回业务失败响应，不抛 500。

- [ ] **步骤 3：挂载路由**

在 `registerCenterApiRoutes` 中调用 `registerCenterConfigRoutes(context)`。

## 任务 5：前端中心服务页面配置

**文件：**
- 修改：`apps/frontend/src/stores/app-types.ts`
- 修改：`apps/frontend/src/stores/app.ts`
- 修改：`apps/frontend/src/stores/app-desktop-actions.ts`
- 修改：`apps/frontend/src/views/Center/RouterIndex.vue`

- [ ] **步骤 1：增加前端类型和状态**

新增日志配置草稿类型：

```ts
export type CenterLogLevelDraft = "" | "debug" | "info" | "warn" | "error";
```

`app.ts` 增加：

```ts
centerLogConfig: null,
centerLogConfigDraft: {
    configuredLevel: "",
}
```

- [ ] **步骤 2：增加加载与保存动作**

动作：

```ts
loadCenterLogConfig(): Promise<void>
saveCenterLogConfig(): Promise<void>
```

保存时把空字符串转换为 `null`，其余值原样提交。

- [ ] **步骤 3：中心服务页面加载和展示**

`onMounted` 同时调用 `syncDesktopStatus()` 和 `loadCenterLogConfig()`。

表单增加 `el-select`：

```text
默认（环境默认）
debug
info
warn
error
```

保存按钮调用 `saveCenterLogConfig()`。

## 任务 6：静态验证与引用检查

**文件：**
- 检查所有修改文件

- [ ] **步骤 1：引用检查**

运行：

```text
rg "shouldSkipConsoleLog|shouldSkipFileLog|centerConsoleLogger|new CenterLogger|log-config|CenterLogLevel" services apps packages
```

预期：旧过滤函数不存在；日志配置 API 和前端动作有真实调用方。

- [ ] **步骤 2：IDE 文件问题检查**

使用 IDEA MCP 对修改的 TypeScript/Vue 文件执行 `get_file_problems`。

预期：无 TypeScript/Vue 语法错误。若检查能力受限，最终说明具体未覆盖项。

- [ ] **步骤 3：最终文档同步自查**

运行：

```text
rg "日志等级|统一日志|流式输出|system-config" 需求.md 设计.md 架构.md 功能清单与关系.md services apps
```

预期：代码与文档口径一致。
