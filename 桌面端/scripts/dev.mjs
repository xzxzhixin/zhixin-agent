import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

// rendererUrl：桌面端主进程开发期固定加载的 Vite 地址。
const rendererUrl = "http://127.0.0.1:5173";
// childProcesses：记录本脚本拉起的子进程，退出时统一清理。
const childProcesses = [];
// isShuttingDown：避免多个退出信号重复清理进程。
let isShuttingDown = false;

/**
 * runOnce：执行一次性命令，失败时把退出码透传给当前开发脚本。
 * @param {string} command 要执行的命令名。
 * @param {string[]} args 命令参数，按数组传递避免命令行拼接歧义。
 * @returns {Promise<void>} 命令成功退出时完成。
 */
async function runOnce(command, args) {
  // child：一次性构建命令直接继承终端输出，方便在 IDEA Terminal 中排查失败原因。
  const child = spawn(
    command,
    args,
    {
      stdio: "inherit",
      shell: true,
    },
  );
  // close：等待命令结束并读取退出码。
  const [code] = await once(child, "close");
  // code：非 0 表示构建失败，开发环境不能继续启动。
  if (code !== 0) {
    process.exitCode = typeof code === "number" ? code : 1;
    throw new Error(`${command} ${args.join(" ")} 执行失败`);
  }
}

/**
 * spawnManaged：启动需要长期运行的开发进程，并纳入退出清理。
 * @param {string} command 要执行的命令名。
 * @param {string[]} args 命令参数，按数组传递避免路径空格问题。
 * @returns {import("node:child_process").ChildProcess} 已启动的子进程。
 */
function spawnManaged(command, args) {
  // child：长期进程继承输出，用户可以直接看到 Vite 和 Electron 日志。
  const child = spawn(
    command,
    args,
    {
      stdio: "inherit",
      shell: true,
    },
  );
  // childProcesses：记录进程引用，避免脚本退出后开发进程残留。
  childProcesses.push(child);
  // close：任一长期进程异常退出时结束整个开发环境，避免只剩半套服务。
  child.on("close", (code) => {
    // isShuttingDown：主动退出期间不再触发二次退出流程。
    if (!isShuttingDown && code !== 0) {
      process.exitCode = typeof code === "number" ? code : 1;
      void shutdown();
    }
  });
  return child;
}

/**
 * killProcessTree：结束一个由开发启动器创建的进程树。
 * @param {import("node:child_process").ChildProcess} child 需要清理的子进程。
 * @returns {Promise<void>} 清理命令完成或进程已经退出时完成。
 */
async function killProcessTree(child) {
  // pid：只有已经成功创建的子进程才有系统进程号。
  if (typeof child.pid !== "number") {
    return;
  }
  // exitCode：已有退出码说明进程自然结束，不需要重复清理。
  if (child.exitCode !== null) {
    return;
  }
  // windows：pnpm/electron 通过 shell 启动时会产生子进程，必须清理整棵进程树避免端口残留。
  if (process.platform === "win32") {
    // taskkill：只针对本脚本记录的 pid，不扫描或清理用户其他进程。
    const killer = spawn(
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
    // close：taskkill 找不到已退出进程时也允许继续关闭流程。
    await once(killer, "close");
    return;
  }
  // kill：非 Windows 平台没有 shell 子树问题时使用默认信号结束子进程。
  child.kill();
}

/**
 * waitForRenderer：等待 Vite 渲染服务可访问后再启动 Electron。
 * @returns {Promise<void>} 渲染服务响应后完成。
 */
async function waitForRenderer() {
  // deadline：最长等待 30 秒，避免端口被占用或 Vite 启动失败时无限挂起。
  const deadline = Date.now() + 30_000;
  // loop：轮询 HTTP 响应，比固定 sleep 更能适配不同机器启动速度。
  while (Date.now() < deadline) {
    try {
      // response：只要 Vite 有响应就允许 Electron 加载页面。
      const response = await fetch(rendererUrl);
      // ok：Vite 开发服务正常响应 HTML。
      if (response.ok) {
        return;
      }
    } catch {
      // catch：Vite 尚未监听端口时会连接失败，继续等待。
    }
    // delay：短间隔轮询，兼顾响应速度和资源占用。
    await delay(300);
  }
  throw new Error(`等待 Vite 开发服务超时：${rendererUrl}`);
}

/**
 * shutdown：结束脚本拉起的长期开发进程。
 * @returns {Promise<void>} 清理完成后结束。
 */
async function shutdown() {
  // isShuttingDown：标记清理中，避免 close 回调重复进入。
  isShuttingDown = true;
  // childProcesses：逐个结束 Vite 和 Electron，避免开发进程残留。
  for (const child of childProcesses) {
    // killProcessTree：开发脚本只清理自己记录的子进程树，避免误伤用户其他进程。
    await killProcessTree(child);
  }
}

// SIGINT：支持 Ctrl+C 停止完整桌面端开发环境。
process.on("SIGINT", () => {
  void shutdown().finally(() => process.exit(process.exitCode ?? 0));
});
// SIGTERM：支持外部终止时清理子进程。
process.on("SIGTERM", () => {
  void shutdown().finally(() => process.exit(process.exitCode ?? 0));
});

try {
  // vite：启动桌面端渲染层开发服务。
  spawnManaged(
    "pnpm",
    [
      "run",
      "dev:renderer",
    ],
  );
  // wait：等 Vite 准备好后再打开 Electron，避免窗口加载失败。
  await waitForRenderer();
  // electron：启动未打包 Electron，源码启动壳会通过 tsx 直接加载主进程 TS 源码。
  spawnManaged(
    "electron",
    [
      ".",
    ],
  );
} catch (error) {
  // message：把可读失败原因输出到终端，便于用户定位开发环境问题。
  console.error(error instanceof Error ? error.message : error);
  await shutdown();
  process.exit(process.exitCode ?? 1);
}
