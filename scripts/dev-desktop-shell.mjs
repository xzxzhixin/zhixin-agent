/**
 * 桌面端开发启动编排。
 *
 * 用途：确认独立 Vite 前端开发服务器已启动，再启动 Electron 桌面壳。
 * 关键逻辑：前端由 `dev:frontend` 独立管理，本脚本只负责桌面壳和桌面壳拉起的中心服务。
 */
import {
  spawn,
  spawnSync,
} from "node:child_process";

// frontendDevUrl: 桌面壳开发期固定连接本机前端服务。
const frontendDevUrl = "http://127.0.0.1:5173";
// children: 当前脚本拉起的子进程，退出时统一收尾。
const children = [];
// isShuttingDown: 防止多个退出信号重复收尾。
let isShuttingDown = false;

/**
 * startProcess：启动一个可继承终端输出的子进程。
 *
 * @param label 进程标签，用于错误提示。
 * @param command 启动命令。
 * @param args 命令参数。
 * @param env 追加环境变量。
 * @returns 子进程对象。
 */
function startProcess(label, command, args, env = {}) {
  // child: 使用当前终端展示输出，方便用户在 IDEA 运行窗口管理。
  const child = spawn(
    command,
    args,
    {
      env: {
        ...process.env,
        ...env,
      },
      shell: process.platform === "win32",
      stdio: "inherit",
    },
  );

  child.on("exit", (code) => {
    if (!isShuttingDown && code !== 0) {
      console.error(`${label} 已退出，退出码：${code ?? "未知"}`);
      shutdown(code ?? 1);
    }
  });

  children.push(child);
  return child;
}

/**
 * waitForFrontend：轮询独立前端开发服务器直到可访问。
 *
 * @returns 前端服务可访问后没有返回值。
 */
async function waitForFrontend() {
  // maxAttempts: Vite 冷启动通常很快，这里给足 30 秒避免机器慢时误判。
  const maxAttempts = 60;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      // response: 只要 HTTP 连接建立就说明 Electron 可以加载页面。
      const response = await fetch(frontendDevUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // 等待 Vite 首次监听端口，失败是启动过程中的正常状态。
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });
  }

  throw new Error(`前端开发服务器未就绪：请先运行 pnpm dev:frontend，再运行 pnpm dev:desktop-shell。目标地址：${frontendDevUrl}`);
}

/**
 * isFrontendAlreadyAvailable：判断本机 Vite 前端服务是否已经可访问。
 *
 * 关键逻辑：前端由 `dev:frontend` 独立拉起；本脚本只检查它是否存在，不启动第二个 Vite。
 *
 * @returns 已存在前端服务可访问时返回 true，否则返回 false。
 */
async function isFrontendAlreadyAvailable() {
  try {
    // response: 只校验本机开发入口是否可建立 HTTP 响应，不解析页面内容以减少耦合。
    const response = await fetch(frontendDevUrl);
    return response.ok;
  } catch {
    // 连接失败说明当前没有可复用的前端开发服务器，后续由本脚本启动 Vite。
    return false;
  }
}

/**
 * shutdown：停止当前脚本管理的开发子进程。
 *
 * @param exitCode 当前编排脚本退出码。
 * @returns 没有返回值。
 */
function shutdown(exitCode = 0) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  for (const child of children) {
    stopProcessTree(child);
  }

  process.exit(exitCode);
}

/**
 * stopProcessTree：停止开发脚本启动的子进程树。
 *
 * @param child 子进程对象。
 * @returns 没有返回值。
 */
function stopProcessTree(child) {
  if (child.killed) {
    return;
  }

  if (process.platform === "win32" && typeof child.pid === "number") {
    // Windows 下 pnpm 通过 shell 启动，必须结束进程树才能避免 Vite 或 Electron 残留。
    spawnSync(
      "taskkill",
      [
        "/pid",
        String(child.pid),
        "/t",
        "/f",
      ],
      {
        stdio: "ignore",
        windowsHide: true,
      },
    );
    return;
  }

  child.kill();
}

process.on("SIGINT", () => {
  shutdown(0);
});
process.on("SIGTERM", () => {
  shutdown(0);
});

try {
  if (!await isFrontendAlreadyAvailable()) {
    throw new Error(`前端开发服务器未启动：请先运行 pnpm dev:frontend。目标地址：${frontendDevUrl}`);
  }

  await waitForFrontend();
  startProcess(
    "Electron 桌面壳",
    "pnpm",
    [
      "--filter",
      "@zhixin/desktop-shell",
      "dev",
    ],
    {
      ZHIXIN_FRONTEND_DEV_URL: frontendDevUrl,
      ZHIXIN_CENTER_NODE_EXECUTABLE: process.execPath,
    },
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "桌面端开发启动失败");
  shutdown(1);
}
