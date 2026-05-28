import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { CENTER_DIRECTORY_NAMES, DEFAULT_CENTER_PORT, PRIMARY_AGENT_NAME, } from "@zhixin/shared";
import { buildCenterDirectoryMap } from "./config.js";
import { FileRepository } from "./repository.js";
// CenterStorage：负责中心目录初始化和本地固化数据读写。
export class CenterStorage {
    // config：中心服务端口与中心目录配置。
    config;
    // directoryMap：中心目录子目录名称到绝对路径的映射。
    directoryMap;
    // repository：统一 JSON、Markdown 追加和扫描仓储能力。
    repository;
    // constructor：保存配置并提前生成目录映射。
    constructor(config) {
        // config：运行期不可变，避免请求处理中被意外修改。
        this.config = config;
        // directoryMap：供后续初始化和文件定位复用。
        this.directoryMap = buildCenterDirectoryMap(config.centerDirectory);
        // repository：集中处理文件读写模式。
        this.repository = new FileRepository();
    }
    // initialize：确保中心目录和所有需求规定的子目录存在。
    async initialize() {
        // mkdir：先创建中心目录，recursive 允许目录已经存在。
        await mkdir(this.config.centerDirectory, {
            recursive: true,
        });
        // directories：逐个创建中文子目录，保证迁移结构稳定。
        const directories = Object.values(this.directoryMap);
        // Promise.all：不同子目录互不依赖，可以并行创建。
        await Promise.all(directories.map((directory) => mkdir(directory, {
            recursive: true,
        })));
        // ensureSeedFiles：初始化首版固定配置、索引和主智能体定义。
        await this.ensureSeedFiles();
    }
    // getRepository：暴露文件仓储能力给日志和后续任务执行模块。
    getRepository() {
        // repository：返回同一个实例，减少重复封装。
        return this.repository;
    }
    // getCenterDirectory：返回当前中心目录绝对路径。
    getCenterDirectory() {
        // centerDirectory：客户端健康检查需要展示这个路径。
        return this.config.centerDirectory;
    }
    // getDirectoryMap：返回中心目录子目录映射，便于客户端展示。
    getDirectoryMap() {
        // spread：返回浅拷贝，避免外部修改内部缓存。
        return {
            ...this.directoryMap,
        };
    }
    // getCenterDirectoryNames：返回需求固定的中心目录名称列表。
    getCenterDirectoryNames() {
        // CENTER_DIRECTORY_NAMES：供设置页和迁移检查展示。
        return CENTER_DIRECTORY_NAMES;
    }
    // readProviders：读取供应商配置列表。
    async readProviders() {
        // providers：供应商配置保存在“供应商/providers.json”。
        return this.repository.readJson(this.providerFilePath(), []);
    }
    // saveProviders：保存供应商配置列表。
    async saveProviders(providers) {
        // writeJson：统一缩进，方便用户审查和迁移。
        await this.repository.writeJson(this.providerFilePath(), providers);
    }
    // readRuntimes：读取运行环境配置列表。
    async readRuntimes() {
        // runtimes：运行环境配置保存在“运行环境/runtimes.json”。
        return this.repository.readJson(this.runtimeFilePath(), []);
    }
    // saveRuntimes：保存运行环境配置列表。
    async saveRuntimes(runtimes) {
        // writeJson：统一由中心服务持久化，避免多端直接写文件。
        await this.repository.writeJson(this.runtimeFilePath(), runtimes);
    }
    // readProxies：读取网络代理配置列表。
    async readProxies() {
        // proxies.json：网络代理配置保存在中心目录“供应商”下，供供应商请求复用。
        return this.repository.readJson(this.proxyFilePath(), []);
    }
    // saveProxies：保存网络代理配置列表。
    async saveProxies(proxies) {
        // writeJson：代理可见配置不包含用户名和密码明文。
        await this.repository.writeJson(this.proxyFilePath(), proxies);
    }
    // readLocalConfig：读取中心服务本机配置。
    async readLocalConfig() {
        // defaultConfig：端口和中心目录来自当前启动配置。
        const defaultConfig = this.createDefaultLocalConfig();
        // readJson：配置文件缺失时返回默认结构。
        return this.repository.readJson(this.localConfigFilePath(), defaultConfig);
    }
    // saveLocalConfig：保存中心服务本机配置。
    async saveLocalConfig(config) {
        // writeJson：本机配置属于配置写，允许整体覆盖。
        await this.repository.writeJson(this.localConfigFilePath(), config);
    }
    // readClientPreferences：读取按客户端类型保存的通知和执行模式。
    async readClientPreferences() {
        // readJson：客户端偏好保存在会话目录下的 client-preferences.json。
        return this.repository.readJson(this.clientPreferenceFilePath(), this.createDefaultClientPreferences());
    }
    // saveClientPreferences：保存客户端偏好配置。
    async saveClientPreferences(preferences) {
        // writeJson：执行模式和通知配置按客户端类型整体保存。
        await this.repository.writeJson(this.clientPreferenceFilePath(), preferences);
    }
    // readProjects：读取项目登记列表。
    async readProjects() {
        // projects.json：项目状态归属于中心目录“会话”。
        return this.repository.readJson(this.projectsFilePath(), []);
    }
    // saveProjects：保存项目登记列表。
    async saveProjects(projects) {
        // writeJson：项目路径、别名和最近打开时间由中心服务统一保存。
        await this.repository.writeJson(this.projectsFilePath(), projects);
    }
    // readSessions：读取会话列表。
    async readSessions() {
        // sessions.json：普通会话和项目会话共用会话索引。
        return this.repository.readJson(this.sessionsFilePath(), []);
    }
    // saveSessions：保存会话列表。
    async saveSessions(sessions) {
        // writeJson：会话索引整体写入，消息内容独立按会话保存。
        await this.repository.writeJson(this.sessionsFilePath(), sessions);
    }
    // readMessages：读取指定会话消息。
    async readMessages(sessionId) {
        // messagesFilePath：每个会话独立消息文件，减少单文件膨胀。
        return this.repository.readJson(this.messagesFilePath(sessionId), []);
    }
    // saveMessages：保存指定会话消息。
    async saveMessages(sessionId, messages) {
        // writeJson：消息追加后整体写回当前会话消息文件。
        await this.repository.writeJson(this.messagesFilePath(sessionId), messages);
    }
    // readAgents：读取智能体定义列表。
    async readAgents() {
        // agents.json：保存主智能体和团队智能体结构化定义。
        return this.repository.readJson(this.agentsFilePath(), this.createDefaultAgents());
    }
    // saveAgents：保存智能体定义列表。
    async saveAgents(agents) {
        // writeJson：智能体结构化索引用于 UI 管理，Markdown 定义另行固化。
        await this.repository.writeJson(this.agentsFilePath(), agents);
    }
    // readCollaborations：读取智能体协作记录。
    async readCollaborations() {
        // collaborations.json：记录管线和群聊协作状态。
        return this.repository.readJson(this.collaborationsFilePath(), []);
    }
    // saveCollaborations：保存智能体协作记录。
    async saveCollaborations(records) {
        // writeJson：协作记录用于 UI 查看、介入和管理。
        await this.repository.writeJson(this.collaborationsFilePath(), records);
    }
    // readTasks：读取任务记录列表。
    async readTasks() {
        // tasks.json：任务记录保存当时运行环境快照。
        return this.repository.readJson(this.tasksFilePath(), []);
    }
    // resolveRuntimeSelection：为插件、MCP、skill 或命令任务选择运行环境。
    async resolveRuntimeSelection(runtimeType, runtimeId) {
        // runtimes：运行环境只从中心服务登记配置中读取，不能临时猜测系统 PATH。
        const runtimes = await this.readRuntimes();
        // specified：调用方显式指定运行环境时优先使用该 ID。
        const specified = runtimeId ? runtimes.find((runtime) => runtime.id === runtimeId) : undefined;
        // selected：未指定时使用同类型默认启用环境。
        const selected = specified ?? runtimes.find((runtime) => runtime.type === runtimeType && runtime.enabled && runtime.default);
        // missing：没有可用环境时返回明确错误，任务不能绕过中心服务环境配置。
        if (!selected) {
            throw new Error(`未找到可用运行环境：${runtimeType}`);
        }
        // disabled：显式指定但未启用时也拒绝执行。
        if (!selected.enabled) {
            throw new Error(`运行环境未启用：${selected.name}`);
        }
        // result：返回环境快照和选择来源，任务记录后续保存该快照。
        return {
            runtime: selected,
            source: specified ? "specified" : "default",
        };
    }
    // saveTasks：保存任务记录列表。
    async saveTasks(tasks) {
        // writeJson：任务状态由中心服务统一更新。
        await this.repository.writeJson(this.tasksFilePath(), tasks);
    }
    // readExtensions：读取扩展能力清单。
    async readExtensions() {
        // extensions.json：插件、MCP 和 skill 使用统一索引。
        return this.repository.readJson(this.extensionsFilePath(), []);
    }
    // readExtensionCalls：读取扩展能力调用记录。
    async readExtensionCalls() {
        // calls.json：所有插件、MCP 和 skill 调用统一进入审计文件。
        return this.repository.readJson(this.extensionCallsFilePath(), []);
    }
    // appendExtensionCall：追加扩展能力调用记录。
    async appendExtensionCall(record) {
        // records：首版用 JSON 数组追加保存，保持审计数据可读。
        const records = await this.readExtensionCalls();
        // writeJson：追加后整体写回，后续可替换为 append-only 日志。
        await this.repository.writeJson(this.extensionCallsFilePath(), [...records, record]);
    }
    // saveExtensions：保存扩展能力清单。
    async saveExtensions(extensions) {
        // writeJson：扩展能力启用状态和权限声明由中心服务保存。
        await this.repository.writeJson(this.extensionsFilePath(), extensions);
    }
    // readMcpConfig：读取全局 MCP 配置。
    async readMcpConfig() {
        // mcp.json：根字段固定为 mcpServers。
        return this.repository.readJson(this.mcpConfigFilePath(), {
            mcpServers: {},
        });
    }
    // saveMcpConfig：保存全局 MCP 配置。
    async saveMcpConfig(config) {
        // writeJson：MCP Server 配置由中心服务统一管理。
        await this.repository.writeJson(this.mcpConfigFilePath(), config);
    }
    // readNotifications：读取通知事件列表。
    async readNotifications() {
        // notifications.json：保存中心服务生成并同步过的通知事件。
        return this.repository.readJson(this.notificationsFilePath(), []);
    }
    // readPendingMessages：读取等待用户确认的本地排队消息。
    async readPendingMessages() {
        // pending-messages.json：恢复连接后不能自动发送，只能展示给用户确认。
        return this.repository.readJson(this.pendingMessagesFilePath(), []);
    }
    // savePendingMessages：保存等待用户确认的本地排队消息。
    async savePendingMessages(messages) {
        // writeJson：排队消息属于会话状态，由中心服务统一保存。
        await this.repository.writeJson(this.pendingMessagesFilePath(), messages);
    }
    // saveAttachment：保存会话图片附件原始文件并返回附件协议对象。
    async saveAttachment(request) {
        // id：附件 ID 由中心服务生成，避免不同客户端冲突。
        const id = randomUUID();
        // safeFileName：保留原文件名但替换路径分隔符，防止越过会话附件目录。
        const safeFileName = request.fileName.replace(/[\\/]/g, "_");
        // storagePath：附件按会话和消息分层保存，便于历史对话迁移。
        const storagePath = join(this.directoryMap["会话"], "attachments", request.sessionId, request.messageId, `${id}-${safeFileName}`);
        // buffer：客户端提交 base64 原始内容，中心服务写入中心目录。
        const buffer = Buffer.from(request.base64Data, "base64");
        // mkdir：确保附件目录存在。
        await mkdir(dirname(storagePath), {
            recursive: true,
        });
        // writeFile：图片原始文件按二进制写入。
        await writeFile(storagePath, buffer);
        // attachment：返回消息附件协议，storagePath 由中心服务控制。
        return {
            id,
            fileName: request.fileName,
            mimeType: request.mimeType,
            size: request.size,
            width: request.width,
            height: request.height,
            storagePath,
            sessionId: request.sessionId,
            messageId: request.messageId,
        };
    }
    // readAttachmentContent：读取中心目录受控附件内容。
    async readAttachmentContent(attachmentId) {
        // sessions：附件索引来自所有会话消息，避免直接暴露任意文件路径读取。
        const sessions = await this.readSessions();
        // for：逐会话扫描消息附件，找到匹配 ID 后读取其受控路径。
        for (const session of sessions) {
            // messages：只读取中心服务消息文件，不扫描用户任意目录。
            const messages = await this.readMessages(session.id);
            // attachment：按明确附件 ID 定位。
            const attachment = messages.flatMap((message) => message.attachments).find((item) => item.id === attachmentId);
            // found：找到后读取受控路径内容。
            if (attachment) {
                return Buffer.from(await readFile(attachment.storagePath));
            }
        }
        // null：未找到附件时交给 API 返回 404。
        return null;
    }
    // saveNotifications：保存通知事件列表。
    async saveNotifications(events) {
        // writeJson：通知事件用于客户端未读和跳转定位。
        await this.repository.writeJson(this.notificationsFilePath(), events);
    }
    // appendMemory：按永久记忆 Markdown 格式追加一段记忆。
    async appendMemory(record) {
        // occurredAt：记忆路径按对话完成日期分层。
        const occurredAt = new Date(record.occurredAt);
        // year：永久记忆年目录。
        const year = String(occurredAt.getFullYear());
        // month：永久记忆月目录，补零保持排序稳定。
        const month = String(occurredAt.getMonth() + 1).padStart(2, "0");
        // day：永久记忆日文件名，补零保持排序稳定。
        const day = String(occurredAt.getDate()).padStart(2, "0");
        // filePath：中心目录“记忆/智能体名字/年/月/日.md”。
        const filePath = join(this.directoryMap["记忆"], record.agentName, year, month, `${day}.md`);
        // content：严格使用需求约定的永久记忆段落格式。
        const content = [
            `# 时间：${record.occurredAt}`,
            "",
            "## 关键词",
            "",
            record.keywords.join("、"),
            "",
            "## 总结",
            "",
            record.summary,
            "",
            "## 使用的电脑",
            "",
            record.computerName,
            "",
            "## 用户说的",
            "",
            record.userText,
            "",
            "## 回答的",
            "",
            record.assistantText,
            "",
            "## 附件",
            "",
            record.attachmentIds?.join("、") ?? "",
            "",
        ].join("\n");
        // appendMarkdown：记忆只能追加，不能覆盖或插入旧内容。
        await this.repository.appendMarkdown(filePath, content);
    }
    // appendUserMemory：追加用户记忆到中心目录“记忆/user.md”。
    async appendUserMemory(content) {
        // filePath：用户记忆在一台中心电脑上只有一份。
        const filePath = join(this.directoryMap["记忆"], "user.md");
        // appendMarkdown：用户记忆同样追加写入，避免覆盖旧记忆。
        await this.repository.appendMarkdown(filePath, `${content}\n`);
    }
    // readMemories：并发读取记忆目录下的 Markdown 文件。
    async readMemories() {
        // root：记忆统一从中心目录“记忆”读取。
        const root = this.directoryMap["记忆"];
        // files：递归扫描 Markdown 文件路径。
        const files = await this.collectMarkdownFiles(root);
        // Promise.all：不同智能体记忆读取可以并行。
        return Promise.all(files.map(async (filePath) => ({
            path: filePath,
            content: await this.repository.readText(filePath),
        })));
    }
    // migrateCenterDirectory：把中心目录当前固化文件复制到目标目录。
    async migrateCenterDirectory(targetDirectory) {
        // files：迁移以中心目录下 Markdown 和 JSON 固化文件为核心，附件二进制通过复制目录保留。
        const files = await this.collectAllFiles(this.config.centerDirectory);
        // Promise.all：不同文件互不依赖，可以并行复制。
        await Promise.all(files.map(async (filePath) => {
            // relative：目标位置保留中心目录相对结构。
            const relative = filePath.slice(this.config.centerDirectory.length).replace(/^[\\/]/, "");
            // targetPath：迁移后的目标文件路径。
            const targetPath = join(targetDirectory, relative);
            // copyFile：复制而不删除源目录，避免迁移预检破坏当前中心。
            await this.repository.copyFile(filePath, targetPath);
        }));
    }
    // readUsageRecords：读取模型调用用量记录。
    async readUsageRecords() {
        // usage.json：用量统计只追加记录，不回改历史。
        return this.repository.readJson(this.usageFilePath(), []);
    }
    // appendUsageRecord：追加模型调用用量记录。
    async appendUsageRecord(record) {
        // records：读取已有记录后追加。
        const records = await this.readUsageRecords();
        // writeJson：保留原始供应商用量返回，便于审计。
        await this.repository.writeJson(this.usageFilePath(), [...records, record]);
    }
    // summarizeUsage：按供应商、模型、项目和时间范围聚合用量。
    async summarizeUsage(filters) {
        // records：用量只从历史追加记录中计算，不受当前供应商配置变更影响。
        const records = await this.readUsageRecords();
        // filtered：按明确筛选字段过滤，不猜测候选字段。
        const filtered = records.filter((record) => {
            // providerMatched：供应商筛选。
            const providerMatched = !filters.providerId || record.providerId === filters.providerId;
            // modelMatched：模型筛选。
            const modelMatched = !filters.model || record.model === filters.model;
            // projectMatched：项目筛选，普通会话 projectId 为空。
            const projectMatched = filters.projectId === undefined || record.projectId === filters.projectId;
            // startMatched：开始时间筛选。
            const startMatched = !filters.startAt || record.calledAt >= filters.startAt;
            // endMatched：结束时间筛选。
            const endMatched = !filters.endAt || record.calledAt <= filters.endAt;
            // return：所有筛选条件都满足才参与聚合。
            return providerMatched && modelMatched && projectMatched && startMatched && endMatched;
        });
        // groups：用供应商、模型和项目 ID 作为稳定聚合键。
        const groups = new Map();
        // forEach：逐条累计 token 和调用次数。
        filtered.forEach((record) => {
            // key：普通非项目会话使用 global 标识，只用于内部聚合键。
            const key = `${record.providerId}|${record.model}|${record.projectId ?? "global"}`;
            // current：没有聚合项时创建初始结构。
            const current = groups.get(key) ?? {
                providerId: record.providerId,
                providerName: record.providerName,
                model: record.model,
                projectId: record.projectId,
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
                cacheHitTokens: null,
                cacheMissTokens: null,
                callCount: 0,
                successCount: 0,
                failureCount: 0,
            };
            // numbers：基础 token 永远来自明确记录值。
            current.inputTokens += record.inputTokens;
            current.outputTokens += record.outputTokens;
            current.totalTokens += record.totalTokens;
            // cacheHitTokens：供应商未提供时保持 null；有提供时才累计。
            current.cacheHitTokens = record.cacheHitTokens === null
                ? current.cacheHitTokens
                : (current.cacheHitTokens ?? 0) + record.cacheHitTokens;
            // cacheMissTokens：供应商未提供时保持 null；有提供时才累计。
            current.cacheMissTokens = record.cacheMissTokens === null
                ? current.cacheMissTokens
                : (current.cacheMissTokens ?? 0) + record.cacheMissTokens;
            // counts：调用成功和失败分开统计。
            current.callCount += 1;
            current.successCount += record.status === "success" ? 1 : 0;
            current.failureCount += record.status === "failed" ? 1 : 0;
            // set：写回聚合项。
            groups.set(key, current);
        });
        // values：返回聚合列表。
        return [...groups.values()];
    }
    // createProviderDraft：按当前时间生成一个供应商配置草稿。
    createProviderDraft() {
        // now：供应商更新时间使用 ISO 字符串，跨端解析一致。
        const now = new Date().toISOString();
        // draft：API Key 明文不返回给客户端，首版只记录是否已保存。
        return {
            id: randomUUID(),
            name: "新供应商",
            type: "openai-compatible",
            baseUrl: "",
            apiKeyStored: false,
            models: [],
            defaultModel: "",
            reasoningDepths: [],
            defaultReasoningDepth: "",
            enabled: false,
            proxyMode: "global",
            updatedAt: now,
        };
    }
    // ensureSeedFiles：创建首版固定配置文件，已有文件不会覆盖。
    async ensureSeedFiles() {
        // providers：供应商首版为空数组，由用户在 UI 中添加。
        await this.ensureJsonFile(this.providerFilePath(), []);
        // proxies：网络代理首版为空数组，代理认证信息另行保存摘要标记。
        await this.ensureJsonFile(this.proxyFilePath(), []);
        // runtimes：运行环境内置常见类型模板，路径留空等待用户配置。
        await this.ensureJsonFile(this.runtimeFilePath(), this.createRuntimeTemplates());
        // localConfig：中心服务本机端口、中心目录和 Web 访问配置。
        await this.ensureJsonFile(this.localConfigFilePath(), this.createDefaultLocalConfig());
        // preferences：按客户端类型保存执行模式和通知配置。
        await this.ensureJsonFile(this.clientPreferenceFilePath(), this.createDefaultClientPreferences());
        // projects：中心服务登记的项目索引。
        await this.ensureJsonFile(this.projectsFilePath(), []);
        // sessions：普通会话、项目会话和团队智能体会话索引。
        await this.ensureJsonFile(this.sessionsFilePath(), []);
        // tasks：任务执行记录索引。
        await this.ensureJsonFile(this.tasksFilePath(), []);
        // agents：结构化智能体定义索引。
        await this.ensureJsonFile(this.agentsFilePath(), this.createDefaultAgents());
        // collaborations：智能体管线和群聊协作记录。
        await this.ensureJsonFile(this.collaborationsFilePath(), []);
        // extensions：插件、MCP 和 skill 统一索引。
        await this.ensureJsonFile(this.extensionsFilePath(), []);
        // extensionCalls：扩展能力调用记录审计文件。
        await this.ensureJsonFile(this.extensionCallsFilePath(), []);
        // mcpConfig：全局 MCP 配置文件，根字段固定为 mcpServers。
        await this.ensureJsonFile(this.mcpConfigFilePath(), {
            mcpServers: {},
        });
        // notifications：通知事件持久化文件。
        await this.ensureJsonFile(this.notificationsFilePath(), []);
        // pendingMessages：断线排队且待用户确认的消息。
        await this.ensureJsonFile(this.pendingMessagesFilePath(), []);
        // usageRecords：模型调用用量记录。
        await this.ensureJsonFile(this.usageFilePath(), []);
        // primaryAgentPath：主智能体定义用 Markdown 固化，符合需求里智能体 md 固化方向。
        const primaryAgentPath = join(this.directoryMap["智能体"], `${PRIMARY_AGENT_NAME}.md`);
        // primaryAgentMarkdown：主智能体不可删除的初始定义。
        const primaryAgentMarkdown = `# ${PRIMARY_AGENT_NAME}\n\n## 角色\n\n直接和用户对话的主智能体。\n\n## 功能\n\n派发任务给子智能体，或创建团队智能体协作。\n\n## 约束\n\n主智能体可以修改，但是不能删除。\n`;
        // ensureTextFile：已有主智能体定义不覆盖，保护用户修改。
        await this.ensureTextFile(primaryAgentPath, primaryAgentMarkdown);
    }
    // createRuntimeTemplates：生成运行环境默认模板。
    createRuntimeTemplates() {
        // types：需求要求内置的常用运行环境类型，包含 Maven。
        const types = ["node", "python", "java", "maven", "git"];
        // map：每个模板默认禁用，等用户填写路径后启用。
        return types.map((type) => ({
            id: randomUUID(),
            name: `${type} 默认环境`,
            type,
            executablePath: "",
            rootPath: "",
            version: "",
            env: {},
            pathEntries: [],
            default: true,
            enabled: false,
            remark: "系统内置模板，填写可执行文件路径后启用。",
        }));
    }
    // createDefaultLocalConfig：生成中心服务本机配置默认值。
    createDefaultLocalConfig() {
        // now：配置初始化时间。
        const now = new Date().toISOString();
        // config：端口和中心目录来自当前进程启动配置。
        return {
            port: this.config.port || DEFAULT_CENTER_PORT,
            centerDirectory: this.config.centerDirectory,
            webAccount: "",
            webPasswordHash: "",
            systemNotificationPermission: "unknown",
            updatedAt: now,
        };
    }
    // createDefaultClientPreferences：生成三类客户端默认偏好。
    createDefaultClientPreferences() {
        // clientTypes：需求规定的客户端类型集合。
        const clientTypes = ["desktop", "web", "idea"];
        // map：默认执行模式为全自动，通知默认开启但仅作配置保存。
        return clientTypes.map((clientType) => ({
            clientType,
            executionMode: "full-auto",
            notificationConfig: this.createDefaultNotificationConfig(clientType),
        }));
    }
    // createDefaultNotificationConfig：生成单个客户端类型通知配置。
    createDefaultNotificationConfig(clientType) {
        // config：覆盖普通对话、项目对话、团队智能体和失败处理通知开关。
        return {
            clientType,
            enabled: true,
            inactiveOnly: true,
            notifyNormalChat: true,
            notifyProjectChat: true,
            notifyTeamAgentChat: true,
            notifyFailures: true,
        };
    }
    // createDefaultAgents：生成主智能体结构化定义。
    createDefaultAgents() {
        // now：智能体定义初始化时间。
        const now = new Date().toISOString();
        // primary：主智能体不可删除，名称固定为“致心”。
        return [
            {
                id: "primary-zhixin",
                name: PRIMARY_AGENT_NAME,
                kind: "primary",
                status: "idle",
                removable: false,
                description: "直接和用户对话的主智能体，可派发任务和创建协作者。",
                updatedAt: now,
            },
        ];
    }
    // providerFilePath：返回供应商配置文件路径。
    providerFilePath() {
        // join：中文目录名必须和磁盘真实文件名一致。
        return join(this.directoryMap["供应商"], "providers.json");
    }
    // proxyFilePath：返回网络代理配置文件路径。
    proxyFilePath() {
        // join：代理配置归属于供应商访问能力，存放在“供应商/proxies.json”。
        return join(this.directoryMap["供应商"], "proxies.json");
    }
    // runtimeFilePath：返回运行环境配置文件路径。
    runtimeFilePath() {
        // join：运行环境配置统一在中心目录“运行环境”下。
        return join(this.directoryMap["运行环境"], "runtimes.json");
    }
    // localConfigFilePath：返回本机配置文件路径。
    localConfigFilePath() {
        // join：本机配置保存在中心目录根部，方便启动时读取。
        return join(this.config.centerDirectory, "config.json");
    }
    // clientPreferenceFilePath：返回客户端偏好配置文件路径。
    clientPreferenceFilePath() {
        // join：客户端执行模式和通知配置属于会话级公共状态。
        return join(this.directoryMap["会话"], "client-preferences.json");
    }
    // projectsFilePath：返回项目登记文件路径。
    projectsFilePath() {
        // join：项目配置归属于会话目录，不作为中心目录顶层项目目录。
        return join(this.directoryMap["会话"], "projects.json");
    }
    // sessionsFilePath：返回会话索引文件路径。
    sessionsFilePath() {
        // join：所有会话索引统一存放在“会话”目录。
        return join(this.directoryMap["会话"], "sessions.json");
    }
    // messagesFilePath：返回指定会话消息文件路径。
    messagesFilePath(sessionId) {
        // join：按 sessionId 拆分消息文件，避免单文件过大。
        return join(this.directoryMap["会话"], "messages", `${sessionId}.json`);
    }
    // agentsFilePath：返回结构化智能体索引文件路径。
    agentsFilePath() {
        // join：结构化索引和 Markdown 定义都存放在“智能体”目录。
        return join(this.directoryMap["智能体"], "agents.json");
    }
    // collaborationsFilePath：返回智能体协作记录文件路径。
    collaborationsFilePath() {
        // join：协作记录归属于会话状态。
        return join(this.directoryMap["会话"], "collaborations.json");
    }
    // tasksFilePath：返回任务记录文件路径。
    tasksFilePath() {
        // join：任务记录归属于会话目录。
        return join(this.directoryMap["会话"], "tasks.json");
    }
    // extensionsFilePath：返回扩展能力索引文件路径。
    extensionsFilePath() {
        // join：全局扩展索引放在插件目录，覆盖插件、MCP 和 skill 的统一清单。
        return join(this.directoryMap["插件"], "extensions.json");
    }
    // mcpConfigFilePath：返回全局 MCP 配置文件路径。
    mcpConfigFilePath() {
        // join：MCP 配置统一放在“MCP”目录。
        return join(this.directoryMap["MCP"], "mcp.json");
    }
    // extensionCallsFilePath：返回扩展能力调用记录路径。
    extensionCallsFilePath() {
        // join：调用记录放在插件目录统一审计。
        return join(this.directoryMap["插件"], "extension-calls.json");
    }
    // notificationsFilePath：返回通知事件文件路径。
    notificationsFilePath() {
        // join：通知事件属于会话同步数据。
        return join(this.directoryMap["会话"], "notifications.json");
    }
    // pendingMessagesFilePath：返回排队消息文件路径。
    pendingMessagesFilePath() {
        // join：排队消息属于会话状态。
        return join(this.directoryMap["会话"], "pending-messages.json");
    }
    // usageFilePath：返回模型用量统计文件路径。
    usageFilePath() {
        // join：用量统计和供应商强相关，放在供应商目录。
        return join(this.directoryMap["供应商"], "usage.json");
    }
    // collectMarkdownFiles：递归收集 Markdown 记忆文件。
    async collectMarkdownFiles(directoryPath) {
        // entries：目录不存在时返回空列表。
        const entries = await this.repository.listDirectory(directoryPath);
        // results：递归收集到的 Markdown 文件。
        const results = [];
        // for：逐个目录项判断文件或子目录。
        for (const entry of entries) {
            // fullPath：目录项绝对路径。
            const fullPath = join(directoryPath, entry);
            try {
                // readText：能按文本读取且后缀是 md 时加入结果。
                if (entry.endsWith(".md")) {
                    results.push(fullPath);
                    continue;
                }
                // childFiles：非 md 项按目录继续扫描；不是目录时 listDirectory 会返回空。
                const childFiles = await this.collectMarkdownFiles(fullPath);
                // push：合并子目录文件。
                results.push(...childFiles);
            }
            catch {
                // ignore：无法读取的条目跳过，避免单个损坏文件阻断记忆查看。
            }
        }
        // results：返回收集结果。
        return results;
    }
    // collectAllFiles：递归收集中心目录下全部文件。
    async collectAllFiles(directoryPath) {
        // entries：目录不存在时返回空列表。
        const entries = await this.repository.listDirectory(directoryPath);
        // results：递归文件列表。
        const results = [];
        // for：逐个目录项处理。
        for (const entry of entries) {
            // fullPath：目录项绝对路径。
            const fullPath = join(directoryPath, entry);
            try {
                // readFile：能读取说明是文件，加入迁移列表。
                await readFile(fullPath);
                // push：记录文件路径。
                results.push(fullPath);
            }
            catch {
                // childFiles：读取失败时按目录继续扫描。
                const childFiles = await this.collectAllFiles(fullPath);
                // push：合并子目录文件。
                results.push(...childFiles);
            }
        }
        // results：返回中心目录文件列表。
        return results;
    }
    // ensureJsonFile：如果 JSON 文件不存在则创建。
    async ensureJsonFile(filePath, value) {
        // readFile：能读到说明文件已存在，不做覆盖。
        try {
            await readFile(filePath, "utf-8");
        }
        catch {
            // writeJson：不存在或不可读时写入首版内容。
            await this.repository.writeJson(filePath, value);
        }
    }
    // ensureTextFile：如果文本文件不存在则创建。
    async ensureTextFile(filePath, value) {
        // readFile：已有用户内容必须保留。
        try {
            await readFile(filePath, "utf-8");
        }
        catch {
            // mkdir：先确保父目录存在。
            await mkdir(dirname(filePath), {
                recursive: true,
            });
            // writeFile：Markdown 使用 UTF-8，避免中文乱码。
            await writeFile(filePath, value, "utf-8");
        }
    }
}
