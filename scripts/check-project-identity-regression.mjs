/**
 * 项目身份文件回归检查。
 *
 * 用途：确保桌面端、浏览器端和 IDE 插件端新增项目对话都以 `致心项目ID.md` 作为项目身份来源。
 * 关键逻辑：静态检查前端不再用目录名伪造项目 ID，桌面壳提供项目目录身份桥接，浏览器端写入身份文件。
 */
import {
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

/**
 * readProjectFile：读取项目内源码文件。
 *
 * @param {string} relativePath 项目相对路径。
 * @returns {string} 文件内容。
 */
function readProjectFile(relativePath) {
  return readFileSync(
    join(
      process.cwd(),
      relativePath,
    ),
    "utf-8",
  );
}

/**
 * assertIncludes：检查源码包含必要片段。
 *
 * @param {string} source 源码文本。
 * @param {string} fragment 必须存在的片段。
 * @param {string} message 失败说明。
 * @returns {void}
 */
function assertIncludes(
  source,
  fragment,
  message,
) {
  if (!source.includes(fragment)) {
    throw new Error(message);
  }
}

/**
 * assertNotIncludes：检查源码不包含禁止片段。
 *
 * @param {string} source 源码文本。
 * @param {string} fragment 禁止出现的片段。
 * @param {string} message 失败说明。
 * @returns {void}
 */
function assertNotIncludes(
  source,
  fragment,
  message,
) {
  if (source.includes(fragment)) {
    throw new Error(message);
  }
}

const projectActions = readProjectFile("apps/frontend/src/stores/app-project-actions.ts");
const preload = readProjectFile("apps/desktop-shell/src/preload.ts");
const desktopMain = readProjectFile("apps/desktop-shell/src/main.ts");
const ideaIdentity = readProjectFile("plugins/idea/src/main/java/top/xzxsrq/agent/ProjectIdentityService.java");

assertIncludes(
  projectActions,
  "PROJECT_ID_FILE_NAME",
  "前端项目选择逻辑必须显式使用致心项目ID.md 文件名常量。",
);
assertIncludes(
  projectActions,
  "致心项目ID.md",
  "前端项目选择逻辑必须读取或创建致心项目ID.md。",
);
assertIncludes(
  projectActions,
  "showDirectoryPicker({",
  "浏览器端新增项目对话必须继续使用目录选择能力。",
);
assertIncludes(
  projectActions,
  'mode: "readwrite"',
  "浏览器端选择项目文件夹必须请求 readwrite 权限以创建致心项目ID.md。",
);
assertIncludes(
  projectActions,
  "getFileHandle(PROJECT_ID_FILE_NAME",
  "浏览器端必须通过目录句柄读取或创建致心项目ID.md。",
);
assertIncludes(
  projectActions,
  "createWritable()",
  "浏览器端在身份文件缺失时必须写入致心项目ID.md。",
);
assertIncludes(
  projectActions,
  "crypto.randomUUID()",
  "浏览器端身份文件缺失时必须生成 UUID，不得使用目录名伪 ID。",
);
assertNotIncludes(
  projectActions,
  "browser-folder-${displayName}",
  "浏览器端不能再用目录名伪造 browser-folder-* 项目 ID。",
);

assertIncludes(
  preload,
  "selectProjectDirectoryAndEnsureIdentity",
  "桌面 preload 必须暴露选择项目目录并确保身份文件的桥接能力。",
);
assertIncludes(
  preload,
  "zhixin:project-directory-select",
  "桌面 preload 必须通过白名单 IPC 调用项目目录选择能力。",
);
assertIncludes(
  desktopMain,
  "selectProjectDirectoryAndEnsureIdentity",
  "桌面主进程必须实现项目目录身份文件读写函数。",
);
assertIncludes(
  desktopMain,
  "dialog.showOpenDialog",
  "桌面主进程必须通过原生目录选择对话框选择项目目录。",
);
assertIncludes(
  desktopMain,
  "致心项目ID.md",
  "桌面主进程必须读取或创建致心项目ID.md。",
);
assertIncludes(
  desktopMain,
  "randomUUID()",
  "桌面主进程在身份文件缺失时必须生成 UUID。",
);

assertIncludes(
  ideaIdentity,
  "PROJECT_ID_FILE_NAME = \"致心项目ID.md\"",
  "IDEA 插件必须继续固定使用致心项目ID.md。",
);
assertIncludes(
  ideaIdentity,
  "UUID.fromString",
  "IDEA 插件读取项目身份时必须校验 UUID 格式，避免损坏文件进入中心服务。",
);

console.log("项目身份文件回归检查通过。");
