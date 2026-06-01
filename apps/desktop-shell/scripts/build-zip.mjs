/**
 * 绿色版 zip 构建脚本。
 *
 * 用途：生成包含桌面壳、中心服务入口、前端资源和图标的绿色版目录，并在系统存在 tar 时打包 zip。
 * 关键逻辑：不引入额外打包器，先形成可验收的交付目录结构。
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  join,
  resolve,
} from "node:path";

// repoRoot: 仓库根目录。
const repoRoot = resolve(process.cwd(), "..", "..");
// outputRoot: 桌面壳构建输出根目录。
const outputRoot = join(process.cwd(), "dist");
// portableRoot: 绿色版目录。
const portableRoot = join(outputRoot, "zhixin-agent-portable");
// centerSourceRoot: 中心服务源码包根目录，桌面打包阶段从这里动态装配运行入口。
const centerSourceRoot = join(repoRoot, "services", "center");
// centerResourceRoot: Electron resources 下的随包中心服务目录，生产期不能再指回仓库源码。
const centerResourceRoot = join(portableRoot, "resources", "center");

rmSync(outputRoot, {
  force: true,
  recursive: true,
});
mkdirSync(portableRoot, {
  recursive: true,
});

cpSync(
  join(repoRoot, "apps", "frontend", "dist"),
  join(portableRoot, "resources", "frontend"),
  {
    recursive: true,
  },
);
cpSync(
  join(repoRoot, "assets", "app-icon"),
  join(portableRoot, "resources", "assets", "app-icon"),
  {
    recursive: true,
  },
);
cpSync(
  join(repoRoot, "assets", "ui-icons"),
  join(portableRoot, "resources", "assets", "ui-icons"),
  {
    recursive: true,
  },
);

for (const pluginName of [
  "builtin-model-openai-compatible",
  "builtin-model-anthropic-messages",
  "builtin-automation",
  "builtin-browser-collector",
  "builtin-office-integration",
  "builtin-file-organizer",
]) {
  // pluginName: 架构规定随桌面绿色版交付的系统内置插件目录。
  cpSync(
    join(repoRoot, "plugins", pluginName),
    join(portableRoot, "resources", "plugins", pluginName),
    {
      recursive: true,
    },
  );
}

mkdirSync(centerResourceRoot, {
  recursive: true,
});
cpSync(
  join(centerSourceRoot, "package.json"),
  join(centerResourceRoot, "package.json"),
);
cpSync(
  join(centerSourceRoot, "src"),
  join(centerResourceRoot, "src"),
  {
    recursive: true,
  },
);
writeFileSync(
  join(centerResourceRoot, "index.js"),
  [
    "/**",
    " * 随包中心服务入口。",
    " *",
    " * 用途：从绿色版 resources/center 内部加载中心服务源码入口，避免生产包回跳仓库源码路径。",
    " * 关键逻辑：中心服务当前由 tsx/Node 运行源码，桌面打包阶段先复制运行入口到本目录。",
    " */",
    "import './src/index.ts';",
    "",
  ].join("\n"),
  "utf-8",
);
writeFileSync(
  join(portableRoot, "README.txt"),
  [
    "致心智能体绿色版目录结构已生成。",
    "当前目录包含前端资源、中心服务入口、内置插件、应用图标和界面图标。",
    "正式 Electron 二进制打包将在安装包阶段接入。",
    "默认中心目录为本目录下 center-data。",
    "",
  ].join("\n"),
  "utf-8",
);

const zipPath = join(outputRoot, "zhixin-agent-portable.zip");
const zipResult = spawnSync(
  "tar",
  [
    "-a",
    "-c",
    "-f",
    zipPath,
    "-C",
    outputRoot,
    "zhixin-agent-portable",
  ],
  {
    stdio: "ignore",
    windowsHide: true,
  },
);

if (zipResult.status !== 0) {
  console.warn("未能通过 tar 生成 zip，已保留绿色版目录。");
}
