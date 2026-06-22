# 桌面端托管中心服务生命周期实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 桌面壳进程在开发版或发布版中非正常消失时，中心服务能自动优雅退出并释放端口和中心目录锁。

**架构：** 桌面壳启动中心服务时传递桌面托管生命周期环境变量和管理者 PID。中心服务启动后在 `desktop-managed` 模式下创建管理者监护定时器，定时检查桌面壳 PID 是否存活，管理者消失时调用现有 `service.close()` 并退出。正常退出和开发脚本停止保留现有清理路径。

**技术栈：** Node.js、TypeScript、Electron、tsx、Fastify、PowerShell/Node 回归检查脚本。

---

## 文件结构

- 修改：`apps/desktop-shell/src/main.ts`
  - 职责：桌面壳启动中心服务时传入 `ZHIXIN_CENTER_LIFECYCLE_MODE`、`ZHIXIN_CENTER_MANAGER_PID` 和检查间隔环境变量。
- 创建：`services/center/src/manager-lifecycle-watch.ts`
  - 职责：解析桌面托管生命周期配置、跨平台检查管理者 PID、在管理者消失时触发中心服务关闭。
- 修改：`services/center/src/index.ts`
  - 职责：中心服务 CLI 启动后安装管理者监护，并保证关闭流程只执行一次。
- 修改：`services/center/src/startup-lock.ts`
  - 职责：如需复用进程判活逻辑，则导出 `isProcessAlive`，保持 `EPERM` 判活语义一致。
- 创建：`scripts/check-desktop-managed-center-lifecycle.mjs`
  - 职责：静态和轻量运行检查生命周期环境变量、中心服务监护安装点、非托管模式不启用监护的代码路径。
- 修改：`package.json`
  - 职责：新增 `check:desktop-managed-lifecycle` 脚本入口。
- 修改：`需求.md`
  - 职责：补充桌面壳非正常消失时中心服务自动退出的产品口径。
- 修改：`设计.md`
  - 职责：补充“桌面壳退出与中心服务生命周期设计”的管理者监护设计与验收。
- 修改：`架构.md`
  - 职责：补充桌面壳传递管理者 PID、中心服务托管模式监护的技术边界。
- 修改：`功能清单与关系.md`
  - 职责：补充桌面壳开发启动与退出链路的强杀回归范围。

### 任务 1：补充失败检查脚本

**文件：**
- 创建：`scripts/check-desktop-managed-center-lifecycle.mjs`
- 修改：`package.json`

- [ ] **步骤 1：编写失败的检查脚本**

创建 `scripts/check-desktop-managed-center-lifecycle.mjs`，检查以下事实：

```js
import {
  readFileSync,
} from "node:fs";

function assertIncludes(source, expected, message) {
  if (!source.includes(expected)) {
    throw new Error(message);
  }
}

const desktopMain = readFileSync(
  "apps/desktop-shell/src/main.ts",
  "utf-8",
);
const centerIndex = readFileSync(
  "services/center/src/index.ts",
  "utf-8",
);

assertIncludes(
  desktopMain,
  "ZHIXIN_CENTER_LIFECYCLE_MODE",
  "桌面壳启动中心服务时必须声明生命周期模式。",
);
assertIncludes(
  desktopMain,
  "ZHIXIN_CENTER_MANAGER_PID",
  "桌面壳启动中心服务时必须传递管理者 PID。",
);
assertIncludes(
  centerIndex,
  "installDesktopManagedLifecycleWatch",
  "中心服务 CLI 启动后必须安装桌面托管生命周期监护。",
);
```

在 `package.json` 的 `scripts` 中新增：

```json
"check:desktop-managed-lifecycle": "node scripts/check-desktop-managed-center-lifecycle.mjs"
```

- [ ] **步骤 2：运行检查确认失败**

运行：

```bash
pnpm check:desktop-managed-lifecycle
```

预期：失败，提示缺少 `ZHIXIN_CENTER_LIFECYCLE_MODE` 或 `installDesktopManagedLifecycleWatch`。

### 任务 2：实现中心服务管理者监护

**文件：**
- 创建：`services/center/src/manager-lifecycle-watch.ts`
- 修改：`services/center/src/startup-lock.ts`
- 修改：`services/center/src/index.ts`

- [ ] **步骤 1：导出进程判活函数**

修改 `services/center/src/startup-lock.ts`，把现有 `isProcessAlive` 导出：

```ts
export function isProcessAlive(pid: number): boolean {
    if (pid === process.pid) {
        return true;
    }

    try {
        // process.kill(pid, 0) 不发送信号，只做存在性和权限检查；Windows 和类 Unix 均支持。
        process.kill(pid, 0);
        return true;
    } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error
            ? String((error as {code?: unknown}).code)
            : "";
        return code === "EPERM";
    }
}
```

- [ ] **步骤 2：创建管理者监护模块**

创建 `services/center/src/manager-lifecycle-watch.ts`：

```ts
import type {CenterLogger} from "./logger.js";
import {isProcessAlive} from "./startup-lock.js";

const DESKTOP_MANAGED_MODE = "desktop-managed";
const DEFAULT_MANAGER_CHECK_INTERVAL_MS = 1000;
const MIN_MANAGER_CHECK_INTERVAL_MS = 300;

export interface DesktopManagedLifecycleWatchOptions {
    /** logger: 中心服务文件日志实例，用于记录管理者消失和关闭失败。 */
    logger: CenterLogger;
    /** closeService: 关闭中心服务资源的函数，来源于当前 CLI 启动的 service.close。 */
    closeService: () => Promise<void>;
}

export interface DesktopManagedLifecycleWatchHandle {
    /** stop: 停止管理者监护定时器，用于中心服务正常退出时释放资源。 */
    stop: () => void;
}

interface DesktopManagedLifecycleConfig {
    /** managerPid: 桌面壳主进程 PID，来源于 ZHIXIN_CENTER_MANAGER_PID。 */
    managerPid: number;
    /** checkIntervalMs: 管理者判活检查间隔，单位毫秒。 */
    checkIntervalMs: number;
}

export function installDesktopManagedLifecycleWatch(
    options: DesktopManagedLifecycleWatchOptions,
): DesktopManagedLifecycleWatchHandle | null {
    const config = readDesktopManagedLifecycleConfig();
    if (!config) {
        return null;
    }

    let isClosing = false;
    const timer = setInterval(() => {
        if (isClosing || isProcessAlive(config.managerPid)) {
            return;
        }

        isClosing = true;
        clearInterval(timer);
        void options.logger.info("桌面端管理者进程消失，中心服务自动退出", {
            managerPid: config.managerPid,
            checkIntervalMs: config.checkIntervalMs,
        }).finally(async () => {
            try {
                await options.closeService();
                process.exit(0);
            } catch (error) {
                await options.logger.error("桌面端管理者消失后中心服务关闭失败", {
                    errorMessage: error instanceof Error ? error.message : String(error),
                    errorStack: error instanceof Error ? error.stack ?? null : null,
                });
                process.exit(1);
            }
        });
    }, config.checkIntervalMs);

    return {
        stop: () => {
            clearInterval(timer);
        },
    };
}

function readDesktopManagedLifecycleConfig(): DesktopManagedLifecycleConfig | null {
    if (process.env.ZHIXIN_CENTER_LIFECYCLE_MODE !== DESKTOP_MANAGED_MODE) {
        return null;
    }

    const managerPid = Number.parseInt(process.env.ZHIXIN_CENTER_MANAGER_PID ?? "", 10);
    if (!Number.isInteger(managerPid) || managerPid <= 0 || managerPid === process.pid) {
        return null;
    }

    const configuredInterval = Number.parseInt(
        process.env.ZHIXIN_CENTER_MANAGER_CHECK_INTERVAL_MS ?? "",
        10,
    );
    const checkIntervalMs = Number.isInteger(configuredInterval)
        ? Math.max(configuredInterval, MIN_MANAGER_CHECK_INTERVAL_MS)
        : DEFAULT_MANAGER_CHECK_INTERVAL_MS;

    return {
        managerPid,
        checkIntervalMs,
    };
}
```

- [ ] **步骤 3：在中心服务 CLI 安装监护**

修改 `services/center/src/index.ts`：

```ts
import {installDesktopManagedLifecycleWatch} from "./manager-lifecycle-watch.js";
```

在 `listenResult.reusedExisting` 分支之后创建关闭函数和监护：

```ts
    let isShuttingDown = false;
    let lifecycleWatch: {stop: () => void} | null = null;

    const shutdown = async (exitCode = 0): Promise<void> => {
        if (isShuttingDown) {
            return;
        }
        isShuttingDown = true;
        lifecycleWatch?.stop();
        await service.close();
        process.exit(exitCode);
    };

    lifecycleWatch = installDesktopManagedLifecycleWatch({
        logger,
        closeService: () => shutdown(0),
    });
```

把 `SIGINT` 和 `SIGTERM` 处理改为调用同一个 `shutdown(0)`，避免重复关闭。

- [ ] **步骤 4：运行检查观察仍失败或进入下一缺口**

运行：

```bash
pnpm check:desktop-managed-lifecycle
```

预期：如果桌面壳尚未传环境变量，检查仍失败在桌面壳部分。

### 任务 3：桌面壳传递生命周期环境变量

**文件：**
- 修改：`apps/desktop-shell/src/main.ts`

- [ ] **步骤 1：增加检查间隔常量**

在中心服务停止等待常量附近新增：

```ts
// CENTER_MANAGER_CHECK_INTERVAL_MS：中心服务监护桌面壳进程的检查间隔，强杀场景下用于尽快释放端口。
const CENTER_MANAGER_CHECK_INTERVAL_MS = 1000;
```

- [ ] **步骤 2：启动中心服务时传递托管环境变量**

在 `startCenterService()` 的 `spawn` 环境变量中加入：

```ts
      ZHIXIN_CENTER_LIFECYCLE_MODE: "desktop-managed",
      ZHIXIN_CENTER_MANAGER_PID: String(process.pid),
      ZHIXIN_CENTER_MANAGER_CHECK_INTERVAL_MS: String(CENTER_MANAGER_CHECK_INTERVAL_MS),
```

- [ ] **步骤 3：运行检查确认通过**

运行：

```bash
pnpm check:desktop-managed-lifecycle
```

预期：检查通过，退出码为 `0`。

### 任务 4：补充更完整的回归检查

**文件：**
- 修改：`scripts/check-desktop-managed-center-lifecycle.mjs`

- [ ] **步骤 1：扩展脚本检查非托管模式不会启用监护**

在脚本中补充读取 `services/center/src/manager-lifecycle-watch.ts`，断言：

```js
const lifecycleWatch = readFileSync(
  "services/center/src/manager-lifecycle-watch.ts",
  "utf-8",
);

assertIncludes(
  lifecycleWatch,
  "ZHIXIN_CENTER_LIFECYCLE_MODE",
  "中心服务管理者监护必须读取生命周期模式环境变量。",
);
assertIncludes(
  lifecycleWatch,
  "desktop-managed",
  "中心服务管理者监护只允许 desktop-managed 模式启用。",
);
assertIncludes(
  lifecycleWatch,
  "ZHIXIN_CENTER_MANAGER_PID",
  "中心服务管理者监护必须读取管理者 PID。",
);
assertIncludes(
  lifecycleWatch,
  "isProcessAlive(config.managerPid)",
  "中心服务管理者监护必须基于管理者 PID 判活。",
);
assertIncludes(
  lifecycleWatch,
  "closeService",
  "中心服务管理者消失后必须调用统一关闭函数。",
);
```

- [ ] **步骤 2：运行回归检查确认通过**

运行：

```bash
pnpm check:desktop-managed-lifecycle
```

预期：通过，退出码为 `0`。

### 任务 5：同步事实源文档

**文件：**
- 修改：`需求.md`
- 修改：`设计.md`
- 修改：`架构.md`
- 修改：`功能清单与关系.md`

- [ ] **步骤 1：更新 `需求.md`**

在桌面端生命周期相关条目附近补充或修订为：

```md
- ⏳ 桌面端真正退出、桌面壳崩溃、IDEA 强制停止启动进程或任务管理器强杀 Electron 时，当前桌面端托管的中心服务必须自动退出并释放端口与中心目录锁；隐藏到托盘不属于退出，中心服务继续运行。
```

- [ ] **步骤 2：更新 `设计.md`**

在“桌面壳退出与中心服务生命周期设计”中补充：

```md
- ⏳ 桌面壳启动中心服务时通过环境变量传入 `desktop-managed` 生命周期模式和桌面壳主进程 PID。
- ⏳ 中心服务在桌面托管模式下启动管理者监护，定时检查桌面壳进程是否存活。
- ⏳ 管理者进程消失后，中心服务记录日志并调用统一关闭流程释放 HTTP 服务、SQLite、临时目录和 `.zhixin-center.lock`。
```

验收口径补充：

```md
- ⏳ IDEA 强制停止启动进程、任务管理器强杀 Electron 或桌面壳崩溃后，中心服务会在检查间隔后主动退出，`8866` 端口释放。
```

- [ ] **步骤 3：更新 `架构.md`**

在桌面壳开发服务器和中心服务生命周期说明处补充：

```md
桌面壳启动中心服务时必须传入 `ZHIXIN_CENTER_LIFECYCLE_MODE=desktop-managed` 和 `ZHIXIN_CENTER_MANAGER_PID`。中心服务只在该模式下启用管理者监护；当桌面壳主进程消失时，中心服务必须通过统一关闭流程自行退出。Web 端和 IDE 插件端不得传入该模式，也不得管理中心服务生命周期。
```

- [ ] **步骤 4：更新 `功能清单与关系.md`**

修订“桌面壳开发启动与退出链路”条目，最小回归范围加入：

```md
IDEA 强制停止启动进程、任务管理器强杀 Electron 或桌面壳崩溃后中心服务自动退出并释放 `8866` 和 `.zhixin-center.lock`
```

### 任务 6：最终验证和整理

**文件：**
- 检查：`apps/desktop-shell/src/main.ts`
- 检查：`services/center/src/index.ts`
- 检查：`services/center/src/manager-lifecycle-watch.ts`
- 检查：`scripts/check-desktop-managed-center-lifecycle.mjs`

- [ ] **步骤 1：运行新增回归检查**

运行：

```bash
pnpm check:desktop-managed-lifecycle
```

预期：通过，退出码为 `0`。

- [ ] **步骤 2：检索引用缺失**

运行：

```bash
rg -n "installDesktopManagedLifecycleWatch|ZHIXIN_CENTER_MANAGER_PID|ZHIXIN_CENTER_LIFECYCLE_MODE|manager-lifecycle-watch|isProcessAlive" apps services scripts package.json
```

预期：能看到桌面壳环境变量、中心服务安装点、监护模块和检查脚本引用。

- [ ] **步骤 3：静态自查文档同步**

运行：

```bash
rg -n "管理者进程|desktop-managed|强杀 Electron|IDEA 强制停止|桌面壳崩溃" 需求.md 设计.md 架构.md 功能清单与关系.md docs/superpowers/specs/2026-06-22-desktop-managed-center-lifecycle-design.md
```

预期：四个事实源文档和规格文件均覆盖该口径。

- [ ] **步骤 4：确认工作区变更**

运行：

```bash
git status --short
```

预期：只包含本计划涉及的代码、检查脚本和文档文件。
