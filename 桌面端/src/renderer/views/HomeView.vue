<script setup lang="ts">
import { Paperclip, Search } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { marked } from "marked";
import { computed, ref } from "vue";
import { ContextReference, MessageAttachment } from "@zhixin/shared";
import { appendMessage, createSession, savePendingMessage, uploadAttachment } from "../api";
import { useAppStore } from "../stores/app";

// appStore：读取会话、项目、供应商和运行环境公共状态。
const appStore = useAppStore();
// inputText：对话输入框文本内容。
const inputText = ref("");
// attachments：当前输入框粘贴的图片附件预览。
const attachments = ref<MessageAttachment[]>([]);
// references：当前输入框插入的项目上下文引用标签。
const references = ref<ContextReference[]>([]);
// activeSessionId：当前发送目标会话 ID。
const activeSessionId = ref("");
// highlightIndex：@ 检索键盘选择索引。
const highlightIndex = ref(0);

// renderedMarkdown：大模型 Markdown 内容预览，容器使用 GitHub Markdown 样式。
const renderedMarkdown = computed(() => marked.parse("## 致心\n\n桌面端负责启动、停止、重启和监控中心服务。\n\n```md\n/ 搜索 skill\n@ 引用项目文件\n```"));

// normalSessions：普通对话列表。
const normalSessions = computed(() => appStore.sessions.filter((session) => session.type === "normal"));
// commandMode：输入以 / 开头时进入 skill 检索模式。
const commandMode = computed(() => inputText.value.startsWith("/"));
// projectReferenceMode：项目会话中输入 @ 时展示文件检索弹框。
const projectReferenceMode = computed(() => Boolean(currentProjectId.value && inputText.value.includes("@")));
// currentProjectId：当前会话所属项目 ID，普通会话为空。
const currentProjectId = computed(() => appStore.sessions.find((session) => session.id === activeSessionId.value)?.projectId ?? "");
// skillOptions：同时展示全局 skill 和当前项目 skill，项目级同名优先。
const skillOptions = computed(() => {
  // skills：只取 skill 类型扩展。
  const skills = appStore.extensions.filter((extension) => extension.type === "skill" && extension.enabled);
  // merged：按名称去重，项目级覆盖全局。
  const merged = new Map<string, typeof skills[number]>();
  // global：先放全局 skill。
  skills.filter((skill) => skill.scope === "global").forEach((skill) => {
    merged.set(skill.name, skill);
  });
  // project：项目级同名优先。
  skills.filter((skill) => skill.scope === "project" && skill.projectId === currentProjectId.value).forEach((skill) => {
    merged.set(skill.name, skill);
  });
  // values：返回可选 skill。
  return [...merged.values()];
});
// projectReferenceOptions：项目文件检索首版基于项目根和已登记项目生成入口，不猜测未扫描文件。
const projectReferenceOptions = computed<ContextReference[]>(() => {
  // project：必须是项目会话才展示 @ 检索。
  const project = appStore.projects.find((item) => item.projectId === currentProjectId.value);
  // missing：普通会话不展示项目文件检索能力。
  if (!project) {
    return [];
  }
  // rootReference：项目根目录引用，后续 IDEA 插件可填充精确文件和代码行。
  return [
    {
      id: `${project.projectId}-root`,
      type: "directory",
      projectId: project.projectId,
      absolutePath: project.rootPath,
      relativePath: ".",
      displayText: project.alias || project.displayName,
    },
  ];
});

// ensureSession：没有会话时创建一个普通会话。
async function ensureSession(): Promise<string> {
  // existing：优先使用当前选择或第一条普通会话。
  const existing = activeSessionId.value || normalSessions.value[0]?.id;
  if (existing) {
    return existing;
  }
  // session：中心服务创建会话并选择默认智能体。
  const session = await createSession({
    type: "normal",
    title: "新的对话",
    clientType: "desktop",
  });
  // activeSessionId：记录本地当前会话。
  activeSessionId.value = session.id;
  // loadCenterState：刷新会话列表。
  await appStore.loadCenterState();
  // return：返回新会话 ID。
  return session.id;
}

// fileToBase64：读取剪贴板图片内容。
function fileToBase64(file: File): Promise<string> {
  // Promise：FileReader 是事件式 API，这里封装为 Promise。
  return new Promise((resolve, reject) => {
    // reader：读取图片为 data URL。
    const reader = new FileReader();
    // onload：去掉 data URL 前缀，只提交 base64。
    reader.onload = () => {
      const value = String(reader.result);
      resolve(value.slice(value.indexOf(",") + 1));
    };
    // onerror：读取失败交给调用方提示。
    reader.onerror = () => reject(reader.error);
    // readAsDataURL：浏览器侧读取本地剪贴板图片。
    reader.readAsDataURL(file);
  });
}

// handlePaste：处理剪贴板图片粘贴和附件预览。
async function handlePaste(event: ClipboardEvent): Promise<void> {
  // items：剪贴板可能包含多个条目。
  const items = Array.from(event.clipboardData?.items ?? []);
  // imageItem：只处理第一个图片条目，避免一次粘贴大量文件。
  const imageItem = items.find((item) => item.type.startsWith("image/"));
  // missing：没有图片时保留普通文本粘贴。
  if (!imageItem) {
    return;
  }
  // file：从剪贴板条目读取图片文件。
  const file = imageItem.getAsFile();
  if (!file) {
    return;
  }
  // preventDefault：图片由附件预览接管。
  event.preventDefault();
  // sessionId：附件必须归属会话。
  const sessionId = await ensureSession();
  // messageId：尚未发送消息时预生成消息 ID，发送时复用附件 messageId。
  const messageId = crypto.randomUUID();
  // base64Data：读取图片原始内容。
  const base64Data = await fileToBase64(file);
  // attachment：中心服务保存原始文件。
  const attachment = await uploadAttachment({
    sessionId,
    messageId,
    fileName: file.name || "剪贴板图片.png",
    mimeType: file.type,
    size: file.size,
    base64Data,
  });
  // attachments：加入预览列表。
  attachments.value.push(attachment);
}

// insertReference：把 @ 检索结果插入引用区。
function insertReference(reference: ContextReference): void {
  // references：引用标签保留完整路径和项目 ID。
  references.value.push(reference);
  // inputText：去掉触发检索的 @，避免继续打开弹框。
  inputText.value = inputText.value.replace("@", "");
}

// handleComposerKeydown：支持 @ 检索上下键、回车和 Esc。
function handleComposerKeydown(event: KeyboardEvent): void {
  // inactive：非 @ 检索模式不接管键盘。
  if (!projectReferenceMode.value) {
    return;
  }
  // ArrowDown：移动到下一个候选。
  if (event.key === "ArrowDown") {
    event.preventDefault();
    highlightIndex.value = Math.min(highlightIndex.value + 1, projectReferenceOptions.value.length - 1);
  }
  // ArrowUp：移动到上一个候选。
  if (event.key === "ArrowUp") {
    event.preventDefault();
    highlightIndex.value = Math.max(highlightIndex.value - 1, 0);
  }
  // Enter：确认当前候选。
  if (event.key === "Enter" && projectReferenceOptions.value[highlightIndex.value]) {
    event.preventDefault();
    insertReference(projectReferenceOptions.value[highlightIndex.value]);
  }
  // Escape：关闭 @ 检索。
  if (event.key === "Escape") {
    inputText.value = inputText.value.replace("@", "");
  }
}

// sendMessage：发送输入框消息。
async function sendMessage(): Promise<void> {
  // sessionId：确保存在会话。
  const sessionId = await ensureSession();
  // provider：当前选择供应商或唯一启用供应商。
  const provider = appStore.providers.find((item) => item.id === appStore.selectedProviderId)
    ?? appStore.providers.filter((item) => item.enabled)[0];
  // imageBlocked：当前供应商或模型不支持图片时禁止发送图片。
  if (attachments.value.length > 0 && !provider?.supportsImageInput) {
    ElMessage.error("当前供应商或模型未声明支持图片输入，不能发送图片附件。");
    return;
  }
  try {
    // message：消息正文、附件和引用一起进入中心服务。
    await appendMessage({
      sessionId,
      role: "user",
      content: inputText.value,
      attachments: attachments.value,
      references: references.value,
    });
    // reset：发送成功后清空本地输入。
    inputText.value = "";
    attachments.value = [];
    references.value = [];
    // loadCenterState：刷新会话和任务状态。
    await appStore.loadCenterState();
  } catch {
    // savePendingMessage：未成功发送到中心服务时进入待用户确认状态。
    await savePendingMessage({
      clientType: "desktop",
      sessionId,
      content: inputText.value,
      attachments: attachments.value,
      references: references.value,
    });
    // loadCenterState：刷新待确认消息列表。
    await appStore.loadCenterState();
  }
}
</script>

<template>
  <section class="content-grid">
    <article class="chat-surface">
      <section class="session-strip">
        <el-tag
          v-for="session in normalSessions"
          :key="session.id"
          effect="plain"
        >
          {{ session.title }}
        </el-tag>
        <el-tag
          v-if="normalSessions.length === 0"
          effect="plain"
        >
          致心
        </el-tag>
      </section>

      <div class="message-row user">
        启动中心服务并读取当前状态
      </div>
      <div
        class="message-row assistant markdown-body"
        v-html="renderedMarkdown"
      />
    </article>

    <aside class="config-panel">
      <el-descriptions
        title="中心服务"
        :column="1"
        border
      >
        <el-descriptions-item label="中心目录">
          {{ appStore.health?.centerDirectory || "未连接" }}
        </el-descriptions-item>
        <el-descriptions-item label="启用供应商">
          {{ appStore.enabledProviderCount }} 个
        </el-descriptions-item>
        <el-descriptions-item label="项目数量">
          {{ appStore.projects.length }} 个
        </el-descriptions-item>
      </el-descriptions>

      <el-divider />

      <h2>任务状态</h2>
      <el-empty
        v-if="appStore.tasks.length === 0"
        description="暂无任务"
      />
      <el-table
        v-else
        :data="appStore.tasks"
        size="small"
      >
        <el-table-column
          prop="title"
          label="任务"
        />
        <el-table-column
          prop="status"
          label="状态"
          width="110"
        />
      </el-table>

      <el-divider />

      <h2>智能体状态</h2>
      <el-table
        :data="appStore.agents"
        size="small"
      >
        <el-table-column
          prop="name"
          label="智能体"
        />
        <el-table-column
          prop="status"
          label="状态"
          width="110"
        />
      </el-table>

      <el-divider />

      <h2>用量统计</h2>
      <el-table
        :data="appStore.usageSummary"
        size="small"
      >
        <el-table-column
          prop="providerName"
          label="供应商"
        />
        <el-table-column
          prop="totalTokens"
          label="Token"
          width="100"
        />
      </el-table>
    </aside>
  </section>

  <footer class="composer">
    <section class="composer-main">
      <div
        v-if="attachments.length || references.length"
        class="composer-tags"
      >
        <el-tag
          v-for="attachment in attachments"
          :key="attachment.id"
          :icon="Paperclip"
          closable
          @close="attachments = attachments.filter((item) => item.id !== attachment.id)"
        >
          {{ attachment.fileName }}
        </el-tag>
        <el-tag
          v-for="reference in references"
          :key="reference.id"
          closable
          @close="references = references.filter((item) => item.id !== reference.id)"
        >
          {{ reference.displayText }}
        </el-tag>
      </div>
      <el-input
        v-model="inputText"
        type="textarea"
        :autosize="{ minRows: 2, maxRows: 6 }"
        placeholder="输入消息，使用 / 检索 skill，项目会话中使用 @ 引用文件"
        @paste="handlePaste"
        @keydown="handleComposerKeydown"
      />
      <div
        v-if="commandMode"
        class="floating-picker"
      >
        <div class="picker-title">
          <el-icon><Search /></el-icon>
          Skill
        </div>
        <button
          v-for="skill in skillOptions"
          :key="skill.id"
          type="button"
          @click="inputText = `/${skill.name} `"
        >
          {{ skill.name }}
        </button>
        <span v-if="skillOptions.length === 0">暂无可用 skill</span>
      </div>
      <div
        v-if="projectReferenceMode"
        class="floating-picker"
      >
        <div class="picker-title">@ 项目引用</div>
        <button
          v-for="(reference, index) in projectReferenceOptions"
          :key="reference.id"
          type="button"
          :class="{ active: index === highlightIndex }"
          @click="insertReference(reference)"
        >
          {{ reference.displayText }}
        </button>
      </div>
      <el-alert
        v-if="appStore.reconnectStopped"
        type="warning"
        title="中心服务重连已停止，未发送消息会等待你确认。"
        show-icon
      />
    </section>
    <el-button
      type="primary"
      @click="sendMessage"
    >
      发送
    </el-button>
  </footer>
</template>
