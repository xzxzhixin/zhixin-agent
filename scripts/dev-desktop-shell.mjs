/**
 * 桌面端开发启动编排。
 *
 * 用途：先启动 Vite 前端开发服务器，再启动 Electron 桌面壳。
 * 关键逻辑：开发期不先构建前端，Electron 通过本机 dev server 获得热更新体验。
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
 * waitForFrontend：轮询前端开发服务器直到可访问。
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

  throw new Error(`前端开发服务器未在 30 秒内就绪：${frontendDevUrl}`);
}

/**
 * isFrontendAlreadyAvailable：判断本机 Vite 前端服务是否已经可访问。
 *
 * 关键逻辑：开发期可能已经手动启动过 `5173`，此时不能再用 strictPort 强行启动第二个 Vite，
 * 否则 pnpm 会退出并连带阻断 Electron 与中心服务 `8866` 启动。
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
  if (await isFrontendAlreadyAvailable()) {
    console.log(`复用已存在的前端开发服务器：${frontendDevUrl}`);
  } else {
    startProcess(
      "前端开发服务器",
      "pnpm",
      [
        "--filter",
        "@zhixin/frontend",
        "dev",
        "--",
        "--host",
        "127.0.0.1",
        "--strictPort",
      ],
    );
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
