import type {CenterDatabase} from "../database.js";
import {AgentEditRepository} from "./agent-edit-repository.js";
import {AgentRepository} from "./agent-repository.js";
import {AgentTeamRepository} from "./agent-team-repository.js";
import {EventRepository} from "./event-repository.js";
import {ExtensionRepository} from "./extension-repository.js";
import {SessionRepository} from "./session-repository.js";
import {SystemRepository} from "./system-repository.js";
import {TokenizerRepository} from "./tokenizer-repository.js";
import {UsageRepository} from "./usage-repository.js";
import {WorkflowRepository} from "./workflow-repository.js";

/**
 * createDataAccess：创建中心服务数据访问层集合。
 *
 * 用途：为路由、领域服务和执行编排提供统一持久层入口。
 * 关键逻辑：所有 Repository 都复用同一个 CenterDatabase，不创建第二套 SQLite 连接。
 * 参数：database 为中心服务主进程唯一数据库包装。
 * 返回值：按数据域分组的 Repository 集合。
 */
export function createDataAccess(database: CenterDatabase): {
    /** agents: 智能体和记忆索引持久层。 */
    agents: AgentRepository;
    /** agentEdits: 智能体子对话和待确认编辑持久层。 */
    agentEdits: AgentEditRepository;
    /** agentTeams: 会话级 team 持久层。 */
    agentTeams: AgentTeamRepository;
    /** events: 事件日志持久层。 */
    events: EventRepository;
    /** extensions: 插件安装和扩展调用持久层。 */
    extensions: ExtensionRepository;
    /** sessions: 项目、会话、消息、轮次、任务和同步客户端持久层。 */
    sessions: SessionRepository;
    /** system: 中心服务系统表持久层。 */
    system: SystemRepository;
    /** tokenizer: tokenizer 上下文查询持久层。 */
    tokenizer: TokenizerRepository;
    /** usage: 用量、附件和审计持久层。 */
    usage: UsageRepository;
    /** workflow: Worker 编排、通知和个人事务持久层。 */
    workflow: WorkflowRepository;
} {
    return {
        agentEdits: new AgentEditRepository(database),
        agentTeams: new AgentTeamRepository(database),
        agents: new AgentRepository(database),
        events: new EventRepository(database),
        extensions: new ExtensionRepository(database),
        sessions: new SessionRepository(database),
        system: new SystemRepository(database),
        tokenizer: new TokenizerRepository(database),
        usage: new UsageRepository(database),
        workflow: new WorkflowRepository(database),
    };
}

export {AgentRepository} from "./agent-repository.js";
export {AgentEditRepository} from "./agent-edit-repository.js";
export {AgentTeamRepository} from "./agent-team-repository.js";
export {EventRepository} from "./event-repository.js";
export {ExtensionRepository} from "./extension-repository.js";
export {SessionRepository} from "./session-repository.js";
export {SystemRepository} from "./system-repository.js";
export {TokenizerRepository} from "./tokenizer-repository.js";
export {UsageRepository} from "./usage-repository.js";
export {WorkflowRepository} from "./workflow-repository.js";
