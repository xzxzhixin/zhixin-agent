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
import {
  existsSync,
  readFileSync,
} from "node:fs";
import {
  join,
  resolve,
} from "node:path";
// frontendDevUrl: 桌面壳开发期固定连接本机前端服务。
const frontendDevUrl = "http://127.0.0.1:5173";
// repoRoot: 开发脚本从仓库根目录执行，中心目录默认位于仓库根目录 center-data。
const repoRoot = process.cwd();
// centerDirectory: dev:desktop-shell 对应的开发中心目录，必须和桌面壳开发期默认值一致。
const centerDirectory = resolve(
  repoRoot,
  "center-data",
);
// centerPort: dev:desktop-shell 使用的中心服务默认端口。
const centerPort = 8866;
// centerStartupLockPath: 中心服务启动锁，用于脚本被停止时兜底清理中心服务。
const centerStartupLockPath = join(
  centerDirectory,
  ".zhixin-center.lock",
);
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
  // childEnv: 继承用户环境但清理 Electron 调试残留变量；ELECTRON_RUN_AS_NODE 会让 electron . 被 Node 模式执行。
  const childEnv = {
    ...process.env,
    ...env,
  };
  delete childEnv.ELECTRON_RUN_AS_NODE;

  // child: 使用当前终端展示输出，方便用户在 IDEA 运行窗口管理。
  const child = spawn(
    command,
    args,
    {
      env: childEnv,
      shell: process.platform === "win32",
      stdio: [
        "inherit",
        "pipe",
        "pipe",
      ],
    },
  );

  child.stdout?.on("data", (chunk) => {
    forwardChildOutputChunk(
      process.stdout,
      chunk,
    );
  });
  child.stderr?.on("data", (chunk) => {
    forwardChildOutputChunk(
      process.stderr,
      chunk,
    );
  });
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
 * forwardChildOutputChunk：把 Electron 和中心服务输出转为当前 Node 控制台可写文本。
 *
 * 关键逻辑：子进程仍按 UTF-8 输出中文；开发脚本接管 stdout/stderr 后写入 JS 字符串，
 * 由 Node 控制台层按当前平台处理终端编码，避免把代码页切换命令暴露到用户启动命令。
 *
 * @param stream 当前脚本的 stdout 或 stderr。
 * @param chunk 子进程输出字节。
 * @returns 没有返回值。
 */
function forwardChildOutputChunk(
  stream,
  chunk,
) {
  stream.write(decodeChildOutputChunk(chunk));
}

/**
 * decodeChildOutputChunk：把子进程输出字节解码为可显示文本。
 *
 * @param chunk 子进程 stdout 或 stderr 原始字节。
 * @returns 解码后的文本。
 */
function decodeChildOutputChunk(chunk) {
  // utf8Text: 中心服务日志事实源固定 UTF-8，优先按 UTF-8 解码。
  const utf8Text = new TextDecoder("utf-8").decode(chunk);
  if (process.platform !== "win32" || !utf8Text.includes("\uFFFD")) {
    return utf8Text;
  }

  // gb18030Text: 少数 Windows 工具仍可能按系统代码页输出，出现替换字符时再降级识别。
  const gb18030Text = decodeWithEncoding(
    chunk,
    "gb18030",
  );
  if (gb18030Text && countReplacementCharacters(gb18030Text) < countReplacementCharacters(utf8Text)) {
    return gb18030Text;
  }

  return utf8Text;
}

/**
 * decodeWithEncoding：按指定编码尝试解码输出。
 *
 * @param chunk 原始字节。
 * @param encoding TextDecoder 支持的编码名。
 * @returns 解码文本；当前 Node 不支持该编码时返回 null。
 */
function decodeWithEncoding(
  chunk,
  encoding,
) {
  try {
    return new TextDecoder(encoding).decode(chunk);
  } catch {
    // catch: Node ICU 构建差异会影响 legacy encoding 支持，失败时继续使用 UTF-8。
    return null;
  }
}

/**
 * countReplacementCharacters：统计解码替换字符数量。
 *
 * @param text 已解码文本。
 * @returns Unicode 替换字符数量。
 */
function countReplacementCharacters(text) {
  return Array.from(text).filter((character) => {
    return character === "\uFFFD";
  }).length;
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

  stopReusableCenterService();
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

/**
 * stopReusableCenterService：停止 dev:desktop-shell 关联的中心服务。
 *
 * 关键逻辑：开发脚本在 Windows 上会强制结束 Electron 进程树，Electron before-quit 可能无法执行；
 * 因此脚本退出时必须按中心目录锁文件兜底停止当前开发中心服务。
 *
 * @returns 没有返回值。
 */
function stopReusableCenterService() {
  if (!isConfiguredCenterHealthy()) {
    return;
  }
  const centerPid = readCenterStartupLockPid();
  if (!centerPid) {
    return;
  }
  stopProcessIdTree(centerPid);
}

/**
 * isConfiguredCenterHealthy：确认当前端口服务属于本仓库开发中心目录。
 *
 * @returns 端口和中心目录都匹配时返回 true。
 */
function isConfiguredCenterHealthy() {
  try {
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        [
          "const port=Number(process.argv[1]);",
          "const expected=require('node:path').resolve(process.argv[2]);",
          "fetch(`http://127.0.0.1:${port}/api/health`).then(async(r)=>{",
          "if(!r.ok){process.exit(2);}",
          "const body=await r.json();",
          "const actual=require('node:path').resolve(body.data?.centerDirectory || '');",
          "process.exit(body.success===true && actual===expected ? 0 : 3);",
          "}).catch(()=>process.exit(4));",
        ].join(""),
        String(centerPort),
        centerDirectory,
      ],
      {
        stdio: "ignore",
        windowsHide: true,
      },
    );
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * readCenterStartupLockPid：读取中心服务锁文件中的进程 ID。
 *
 * @returns 有效 pid；无效或缺失时返回 null。
 */
function readCenterStartupLockPid() {
  if (!existsSync(centerStartupLockPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(centerStartupLockPath, "utf-8"));
    if (
      typeof parsed.pid !== "number"
      || !Number.isInteger(parsed.pid)
      || parsed.pid <= 0
    ) {
      return null;
    }
    return parsed.pid;
  } catch {
    return null;
  }
}

/**
 * stopProcessIdTree：按 pid 停止进程树。
 *
 * @param pid 目标进程 ID。
 * @returns 没有返回值。
 */
function stopProcessIdTree(pid) {
  if (process.platform === "win32") {
    spawnSync(
      "taskkill",
      [
        "/pid",
        String(pid),
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
  try {
    process.kill(pid);
  } catch {
    // catch: 中心服务可能已经被 Electron 退出流程关闭，忽略即可。
  }
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
    },
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "桌面端开发启动失败");
  shutdown(1);
}
