/**
 * IDEA 插件静态检查。
 *
 * 用途：在缺少 Gradle Wrapper 和 IDEA 运行配置时，先覆盖项目 ID、右键引用、内部文件定位和 plugin.html 项目上下文桥接。
 * 关键逻辑：只读取源码和 plugin.xml，不执行 Gradle 构建，不修改文件。
 */
import {
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

/**
 * read：读取仓库内文本文件。
 *
 * @param {string} relativePath 仓库相对路径。
 * @returns {string} 文件文本。
 */
function read(relativePath) {
  return readFileSync(join(process.cwd(), relativePath), "utf-8");
}

/**
 * assertIncludes：断言源码包含固定片段。
 *
 * @param {string} source 源码文本。
 * @param {string} fragment 必须出现的片段。
 * @param {string} message 缺失时抛出的中文错误。
 * @returns {void}
 */
function assertIncludes(source, fragment, message) {
  if (!source.includes(fragment)) {
    throw new Error(message);
  }
}

const identityService = read("plugins/idea/src/main/java/top/xzxsrq/agent/ProjectIdentityService.java");
const contextFactory = read("plugins/idea/src/main/java/top/xzxsrq/agent/ContextReferenceFactory.java");
const sendAction = read("plugins/idea/src/main/java/top/xzxsrq/agent/SendContextToZhixinAction.java");
const fileLink = read("plugins/idea/src/main/java/top/xzxsrq/agent/InternalFileLink.java");
const bridge = read("plugins/idea/src/main/java/top/xzxsrq/agent/ZhixinPluginBridge.java");
const toolWindow = read("plugins/idea/src/main/java/top/xzxsrq/agent/ZhixinToolWindowFactory.java");
const pluginXml = read("plugins/idea/src/main/resources/META-INF/plugin.xml");

assertIncludes(identityService, "致心项目ID.md", "IDEA 插件没有读取或创建项目 ID 文件。");
assertIncludes(identityService, "UUID.randomUUID()", "IDEA 插件缺少项目 ID 自动创建逻辑。");
assertIncludes(contextFactory, "codeReference", "IDEA 插件缺少代码引用工厂。");
assertIncludes(contextFactory, "fileReference", "IDEA 插件缺少当前文件引用工厂。");
assertIncludes(contextFactory, "directoryReference", "IDEA 插件缺少文件夹引用工厂。");
assertIncludes(sendAction, "createEditorReference", "IDEA 插件缺少编辑器选区或当前行引用读取。");
assertIncludes(sendAction, "SelectionModel", "IDEA 插件缺少选区模型读取。");
assertIncludes(sendAction, "CommonDataKeys.VIRTUAL_FILE", "IDEA 插件缺少项目树或编辑器标签文件读取。");
assertIncludes(pluginXml, "EditorPopupMenu", "IDEA 插件右键动作没有覆盖编辑器菜单。");
assertIncludes(pluginXml, "ProjectViewPopupMenu", "IDEA 插件右键动作没有覆盖项目树菜单。");
assertIncludes(pluginXml, "EditorTabPopupMenu", "IDEA 插件右键动作没有覆盖编辑器标签菜单。");
assertIncludes(fileLink, "startLine", "IDEA 插件内部文件定位链接缺少起始行。");
assertIncludes(bridge, "openInternalFileLink", "IDEA 插件缺少内部文件定位能力。");
assertIncludes(bridge, "致心内部文件定位", "IDEA 插件缺少内部文件定位处理记录。");
assertIncludes(bridge, "projectId=", "IDEA 插件 plugin.html URL 没有携带项目 ID。");
assertIncludes(bridge, "projectName=", "IDEA 插件 plugin.html URL 没有携带项目名。");
assertIncludes(bridge, "projectPath=", "IDEA 插件 plugin.html URL 没有携带项目路径。");
assertIncludes(bridge, "updateConversationTabStatus", "IDEA 插件缺少会话页签状态桥接。");
assertIncludes(toolWindow, "pluginPageUrl()", "IDEA 插件工具窗口没有加载 plugin.html 地址。");
assertIncludes(pluginXml, "发送到致心对话框", "plugin.xml 缺少右键发送动作。");

console.log("IDEA 插件静态检查通过。");
