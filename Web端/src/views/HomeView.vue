<script setup lang="ts">
import { Paperclip, Search } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { marked } from "marked";
import { computed, onMounted, ref, watch } from "vue";
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
// reconnectStoppedWarned：记录重连停止提示是否已展示，避免重复弹出。
const reconnectStoppedWarned = ref(false);
// pageNotificationShown：记录已展示的页面内通知内容，避免重复弹出。
const pageNotificationShown = ref("");

// onMounted：Web 首页右侧展示用量摘要时单独拉取统计，不混入全局状态刷新。
onMounted(() => {
  // loadUsageSummary：用量聚合属于重接口，只在需要展示的页面按需读取。
  void appStore.loadUsageSummary().catch(() => {
    // ignore：中心服务未连接时由全局连接状态提示，这里不额外制造未处理异常。
  });
});

// renderedMarkdown：大模型 Markdown 内容预览，使用 GitHub Markdown 样式容器渲染。
const renderedMarkdown = computed(() => marked.parse("## 致心\n\n欢迎使用 **致心智能体**。\n\n- 中心服务是唯一事实源\n- 桌面端、Web端和IDE插件实时同步\n- Markdown 使用 GitHub 样式渲染"));

// projectSessions：项目会话列表。
const projectSessions = computed(() => appStore.sessions.filter((session) => session.type === "project"));
// commandMode：输入以 / 开头时进入 skill 检索模式。
const commandMode = computed(() => inputText.value.startsWith("/"));
// currentProjectId：当前会话所属项目 ID。
const currentProjectId = computed(() => appStore.sessions.find((session) => session.id === activeSessionId.value)?.projectId ?? projectSessions.value[0]?.projectId ?? "");
// projectReferenceMode：项目会话中输入 @ 时展示项目引用弹框。
const projectReferenceMode = computed(() => Boolean(currentProjectId.value && inputText.value.includes("@")));
// skillOptions：同时展示全局 skill 和当前项目 skill，项目级同名优先。
const skillOptions = computed(() => {
  // skills：只取启用的 skill 扩展。
  const skills = appStore.extensions.filter((extension) => extension.type === "skill" && extension.enabled);
  // merged：同名 skill 项目级覆盖全局。
  const merged = new Map<string, typeof skills[number]>();
  // global：先放全局 skill。
  skills.filter((skill) => skill.scope === "global").forEach((skill) => {
    merged.set(skill.name, skill);
  });
  // project：再放当前项目 skill。
  skills.filter((skill) => skill.scope === "project" && skill.projectId === currentProjectId.value).forEach((skill) => {
    merged.set(skill.name, skill);
  });
  // values：返回候选列表。
  return [...merged.values()];
});
// projectReferenceOptions：项目引用候选，首版使用已登记项目根作为文件夹引用。
const projectReferenceOptions = computed<ContextReference[]>(() => {
  // project：普通非项目会话不展示项目文件检索。
  const project = appStore.projects.find((item) => item.projectId === currentProjectId.value);
  if (!project) {
    return [];
  }
  // rootReference：项目根引用保留完整路径。
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

// ensureSession：没有会话时创建普通 Web 会话。
async function ensureSession(): Promise<string> {
  // existing：优先使用当前选择或第一条会话。
  const existing = activeSessionId.value || appStore.sessions[0]?.id;
  if (existing) {
    return existing;
  }
  // session：由中心服务创建，默认主智能体处理。
  const session = await createSession({
    type: "normal",
    title: "新的 Web 对话",
    clientType: "web",
  });
  // activeSessionId：保存当前会话。
  activeSessionId.value = session.id;
  // loadCenterState：刷新中心状态。
  await appStore.loadCenterState();
  // return：返回会话 ID。
  return session.id;
}

// fileToBase64：读取图片文件为 base64。
function fileToBase64(file: File): Promise<string> {
  // Promise：封装 FileReader 事件。
  return new Promise((resolve, reject) => {
    // reader：浏览器读取本地剪贴板图片。
    const reader = new FileReader();
    // onload：只提交 data URL 逗号后的 base64。
    reader.onload = () => {
      const value = String(reader.result);
      resolve(value.slice(value.indexOf(",") + 1));
    };
    // onerror：读取失败返回错误。
    reader.onerror = () => reject(reader.error);
    // readAsDataURL：读取图片。
    reader.readAsDataURL(file);
  });
}

// handlePaste：支持剪贴板图片粘贴和附件预览。
async function handlePaste(event: ClipboardEvent): Promise<void> {
  // imageItem：查找剪贴板图片。
  const imageItem = Array.from(event.clipboardData?.items ?? []).find((item) => item.type.startsWith("image/"));
  // missing：无图片时保留默认文本粘贴。
  if (!imageItem) {
    return;
  }
  // file：读取剪贴板图片文件。
  const file = imageItem.getAsFile();
  if (!file) {
    return;
  }
  // preventDefault：图片由附件系统接管。
  event.preventDefault();
  // sessionId：附件必须归属会话。
  const sessionId = await ensureSession();
  // messageId：预生成消息 ID。
  const messageId = crypto.randomUUID();
  // base64Data：图片原始内容。
  const base64Data = await fileToBase64(file);
  // attachment：中心服务保存图片。
  const attachment = await uploadAttachment({
    sessionId,
    messageId,
    fileName: file.name || "剪贴板图片.png",
    mimeType: file.type,
    size: file.size,
    base64Data,
  });
  // attachments：加入预览。
  attachments.value.push(attachment);
}

// insertReference：插入项目文件、文件夹或代码引用。
function insertReference(reference: ContextReference): void {
  // references：引用标签保留完整结构。
  references.value.push(reference);
  // inputText：移除 @ 触发符。
  inputText.value = inputText.value.replace("@", "");
}

// handleComposerKeydown：支持 @ 检索键盘操作。
function handleComposerKeydown(event: KeyboardEvent): void {
  // inactive：非 @ 模式不处理。
  if (!projectReferenceMode.value) {
    return;
  }
  // ArrowDown：下移候选。
  if (event.key === "ArrowDown") {
    event.preventDefault();
    highlightIndex.value = Math.min(highlightIndex.value + 1, projectReferenceOptions.value.length - 1);
  }
  // ArrowUp：上移候选。
  if (event.key === "ArrowUp") {
    event.preventDefault();
    highlightIndex.value = Math.max(highlightIndex.value - 1, 0);
  }
  // Enter：确认候选。
  if (event.key === "Enter" && projectReferenceOptions.value[highlightIndex.value]) {
    event.preventDefault();
    insertReference(projectReferenceOptions.value[highlightIndex.value]);
  }
  // Escape：关闭弹框。
  if (event.key === "Escape") {
    inputText.value = inputText.value.replace("@", "");
  }
}

// sendMessage：发送消息到中心服务。
async function sendMessage(): Promise<void> {
  // sessionId：确保目标会话存在。
  const sessionId = await ensureSession();
  // provider：当前选择供应商或第一个启用供应商。
  const provider = appStore.providers.find((item) => item.id === appStore.selectedProviderId)
    ?? appStore.providers.filter((item) => item.enabled)[0];
  // imageBlocked：模型不支持图片时禁止发送。
  if (attachments.value.length > 0 && !provider?.supportsImageInput) {
    ElMessage.error("当前供应商或模型未声明支持图片输入，不能发送图片附件。");
    return;
  }
  try {
    // appendMessage：消息内容进入中心服务事实源。
    await appendMessage({
      sessionId,
      role: "user",
      content: inputText.value,
      attachments: attachments.value,
      references: references.value,
    });
    // reset：发送成功后清理输入。
    inputText.value = "";
    attachments.value = [];
    references.value = [];
    // loadCenterState：刷新同步数据。
    await appStore.loadCenterState();
  } catch {
    // savePendingMessage：断线时保存为待用户确认，不自动重发。
    await savePendingMessage({
      clientType: "web",
      sessionId,
      content: inputText.value,
      attachments: attachments.value,
      references: references.value,
    });
    // loadCenterState：刷新待确认列表。
    await appStore.loadCenterState();
  }
}

// watch：浏览器通知不可用时使用 ElMessage 展示页面内通知。
watch(
  () => appStore.pageNotificationMessage,
  (message) => {
    // missing：无通知内容时不处理。
    if (!message) {
      return;
    }
    // duplicate：同一条通知只提示一次。
    if (message === pageNotificationShown.value) {
      return;
    }
    // pageNotificationShown：记录已经提示的通知。
    pageNotificationShown.value = message;
    // info：按用户要求使用 ElMessage，不使用 el-alert。
    ElMessage.info(message);
  },
);

// watch：断线重连停止时使用 ElMessage 提示，不在输入框内显示 el-alert。
watch(
  () => appStore.reconnectStopped,
  (stopped) => {
    // reset：恢复连接后允许下次停止时再次提示。
    if (!stopped) {
      reconnectStoppedWarned.value = false;
      return;
    }
    // duplicate：同一次停止状态只提示一次。
    if (reconnectStoppedWarned.value) {
      return;
    }
    // reconnectStoppedWarned：记录已经提示。
    reconnectStoppedWarned.value = true;
    // warning：按用户要求使用 ElMessage，不使用 el-alert。
    ElMessage.warning("中心服务重连已停止，未发送消息会等待你确认。");
  },
);
</script>

<template>
  <section class="content-grid">
    <article class="chat-surface">
      <section class="session-strip">
        <el-tag
          v-for="session in projectSessions"
          :key="session.id"
          effect="plain"
        >
          {{ session.title }}
        </el-tag>
        <el-tag
          v-if="projectSessions.length === 0"
          effect="plain"
        >
          全部对话
        </el-tag>
      </section>

      <section class="message-list">
        <div class="message-row user">
          帮我检查项目状态
        </div>
        <div
          class="message-row assistant markdown-body"
          v-html="renderedMarkdown"
        />
      </section>
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

      <h2>通知</h2>
      <el-empty
        v-if="appStore.notifications.length === 0"
        description="暂无通知"
      />
      <el-table
        v-else
        :data="appStore.notifications"
        size="small"
      >
        <el-table-column
          prop="title"
          label="标题"
        />
        <el-table-column
          prop="requiresAction"
          label="需处理"
          width="90"
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
    </section>
    <el-button
      type="primary"
      @click="sendMessage"
    >
      发送
    </el-button>
  </footer>
</template>
