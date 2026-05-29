<script setup lang="ts">
import { Paperclip, Search } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { computed, ref, watch } from "vue";
import { ContextReference, ExecutionMode, MessageAttachment } from "@zhixin/shared";
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
// selectedPermission：当前输入框权限模式，首版仅作为 UI 选择状态。
const selectedPermission = ref("full-access");
// selectedReasoningDepth：当前输入框推理程度，首版随 UI 保存本地选择。
const selectedReasoningDepth = ref("medium");
// permissionOptions：权限下拉选项，后续可接入中心服务审批策略。
const permissionOptions = [
  {
    // label：完全自动权限，允许按当前执行模式直接处理。
    label: "完全访问权限",
    // value：本地 UI 协议值。
    value: "full-access",
  },
  {
    // label：编辑前需要确认的权限策略。
    label: "编辑前确认",
    // value：本地 UI 协议值。
    value: "edit-review",
  },
  {
    // label：只读权限策略。
    label: "只读",
    // value：本地 UI 协议值。
    value: "read-only",
  },
];
// executionModeOptions：执行模式下拉框选项，值使用共享协议枚举，标签使用中文展示。
const executionModeOptions: Array<{
  // label：展示给用户的中文模式名。
  label: string;
  // value：中心服务保存的执行模式协议值。
  value: ExecutionMode;
}> = [
  {
    label: "建议模式",
    value: "suggest",
  },
  {
    label: "自动编辑",
    value: "auto-edit",
  },
  {
    label: "全自动",
    value: "full-auto",
  },
];

// normalSessions：普通对话列表。
const normalSessions = computed(() => appStore.sessions.filter((session) => session.type === "normal"));
// projectSessions：项目对话列表。
const projectSessions = computed(() => appStore.sessions.filter((session) => session.type === "project"));
// projectSessionGroups：项目对话按项目分组展示，项目本身可折叠。
const projectSessionGroups = computed(() => appStore.projects.map((project) => ({
  // project：中心服务登记的项目信息。
  project,
  // sessions：当前项目下的项目会话列表。
  sessions: projectSessions.value.filter((session) => session.projectId === project.projectId),
})));
// commandMode：输入以 / 开头时进入 skill 检索模式。
const commandMode = computed(() => inputText.value.startsWith("/"));
// projectReferenceMode：项目会话中输入 @ 时展示文件检索弹框。
const projectReferenceMode = computed(() => Boolean(currentProjectId.value && inputText.value.includes("@")));
// currentProjectId：当前会话所属项目 ID，普通会话为空。
const currentProjectId = computed(() => appStore.sessions.find((session) => session.id === activeSessionId.value)?.projectId ?? "");
// activeProvider：当前供应商选择，用于读取可用推理程度。
const activeProvider = computed(() => appStore.providers.find((item) => item.id === appStore.selectedProviderId));
// reasoningDepthOptions：推理程度优先来自供应商配置；无供应商时保留 medium 占位，避免猜测多套协议字段。
const reasoningDepthOptions = computed(() => {
  // depths：供应商协议中明确的推理深度列表。
  const depths = activeProvider.value?.reasoningDepths ?? [];
  // fallback：未连接供应商时仅展示固定 medium 占位。
  const fallback = ["medium"];
  // source：有供应商推理深度时使用供应商数据，否则使用占位值。
  const source = depths.length > 0 ? depths : fallback;
  // options：Element Plus 下拉框选项。
  return source.map((depth) => ({
    label: depth,
    value: depth,
  }));
});
// hasRunningTask：存在运行中任务时发送按钮切换为停止按钮。
const hasRunningTask = computed(() => appStore.tasks.some((task) => task.status === "running"));
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

// handleExecutionModeChange：保存输入框中选择的执行模式。
async function handleExecutionModeChange(mode: ExecutionMode): Promise<void> {
  // saveExecutionMode：执行模式按客户端类型保存，不跨桌面端、Web端和 IDEA 插件同步。
  await appStore.saveExecutionMode(mode);
}

// stopCurrentTask：停止按钮首版只保留 UI 入口，后续接入中心服务任务停止接口。
function stopCurrentTask(): void {
  // warning：当前中心服务尚未暴露停止任务接口，避免静默假装已停止。
  ElMessage.warning("停止任务接口尚未接入中心服务。");
}

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
    <aside class="conversation-sidebar">
      <section class="conversation-group">
        <h2>项目</h2>
        <div class="conversation-group-body">
          <el-empty
            v-if="projectSessionGroups.length === 0"
            description="暂无项目"
          />
          <el-collapse
            v-else
            class="project-chat-collapse"
          >
            <el-collapse-item
              v-for="group in projectSessionGroups"
              :key="group.project.projectId"
              :name="group.project.projectId"
            >
              <template #title>
                <span class="conversation-title">
                  {{ group.project.alias || group.project.displayName }}
                </span>
              </template>
              <el-button
                v-for="session in group.sessions"
                :key="session.id"
                class="conversation-item"
                :type="activeSessionId === session.id ? 'primary' : 'default'"
                @click="activeSessionId = session.id"
              >
                <span>{{ session.title }}</span>
                <small>{{ session.status }}</small>
              </el-button>
              <div
                v-if="group.sessions.length === 0"
                class="conversation-empty"
              >
                暂无项目对话
              </div>
            </el-collapse-item>
          </el-collapse>
        </div>
      </section>

      <section class="conversation-group">
        <h2>对话</h2>
        <div class="conversation-group-body">
          <el-empty
            v-if="normalSessions.length === 0"
            description="暂无对话"
          />
          <el-button
            v-for="session in normalSessions"
            :key="session.id"
            class="conversation-item"
            :type="activeSessionId === session.id ? 'primary' : 'default'"
            @click="activeSessionId = session.id"
          >
            <span>{{ session.title }}</span>
            <small>{{ session.status }}</small>
          </el-button>
        </div>
      </section>
    </aside>

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

      <section class="message-list" />

      <footer class="composer">
        <section class="composer-shell">
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
          <section class="composer-input-row">
            <el-input
              v-model="inputText"
              class="composer-textarea"
              type="textarea"
              :autosize="{ minRows: 2, maxRows: 6 }"
              placeholder="/ 搜索 skill  @ 引用项目文件"
              @paste="handlePaste"
              @keydown="handleComposerKeydown"
            />
          </section>
          <section class="composer-toolbar">
            <div class="composer-tools">
              <el-button
                class="composer-tool-button"
                aria-label="添加附件或上下文"
              >
                添加
              </el-button>
            </div>
            <div class="composer-controls">
              <el-select
                v-model="selectedPermission"
                class="composer-permission-select"
                size="small"
              >
                <el-option
                  v-for="option in permissionOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
              <el-select
                class="composer-mode-select"
                :model-value="appStore.executionMode"
                size="small"
                @change="handleExecutionModeChange"
              >
                <el-option
                  v-for="option in executionModeOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
              <el-select
                v-model="selectedReasoningDepth"
                class="composer-reasoning-select"
                size="small"
              >
                <el-option
                  v-for="option in reasoningDepthOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
              <el-button
                v-if="!hasRunningTask"
                class="composer-send"
                type="primary"
                aria-label="发送"
                @click="sendMessage"
              >
                发送
              </el-button>
              <el-button
                v-else
                class="composer-send"
                type="danger"
                aria-label="停止"
                @click="stopCurrentTask"
              >
                停止
              </el-button>
            </div>
          </section>
          <div
            v-if="commandMode"
            class="floating-picker"
          >
            <div class="picker-title">
              <el-icon><Search /></el-icon>
              Skill
            </div>
            <el-button
              v-for="skill in skillOptions"
              :key="skill.id"
              @click="inputText = `/${skill.name} `"
            >
              {{ skill.name }}
            </el-button>
            <span v-if="skillOptions.length === 0">暂无可用 skill</span>
          </div>
          <div
            v-if="projectReferenceMode"
            class="floating-picker"
          >
            <div class="picker-title">@ 项目引用</div>
            <el-button
              v-for="(reference, index) in projectReferenceOptions"
              :key="reference.id"
              :type="index === highlightIndex ? 'primary' : 'default'"
              @click="insertReference(reference)"
            >
              {{ reference.displayText }}
            </el-button>
          </div>
        </section>
      </footer>
    </article>

    <aside class="config-panel">
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

    </aside>
  </section>
</template>
