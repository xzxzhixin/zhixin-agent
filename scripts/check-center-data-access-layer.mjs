/**
 * 中心服务数据访问层边界检查。
 *
 * 用途：确认 Node 端 SQLite 访问已从领域代码收敛到轻量 repository，作为不引入 ORM 依赖的 MyBatisPlus 平替边界。
 * 关键逻辑：静态检查智能体领域不再直接散落 agents_index SQL，repository 只复用 CenterDatabase 连接。
 * 参数：无。
 * 返回值：检查通过时退出码为 0；发现边界回退时退出码为 1。
 */
import {
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";

/**
 * readProjectFile：读取项目文件。
 *
 * @param {string} pathInProject 仓库相对路径。
 * @returns {string} 文件文本。
 */
function readProjectFile(pathInProject) {
  return readFileSync(
    join(
      process.cwd(),
      pathInProject,
    ),
    "utf-8",
  );
}

// repositorySource: 智能体数据访问层源码，必须是 SQLite SQL 的主要承载位置。
const repositorySource = readProjectFile("services/center/src/data-access/agent-repository.ts");
const sessionRepositorySource = readProjectFile("services/center/src/data-access/session-repository.ts");
// agentDomainSource: 智能体领域源码，只允许通过 AgentRepository 访问 agents_index 高频查询。
const agentDomainSource = readProjectFile("services/center/src/agent-domain.ts");
// sessionDomainSource: 会话领域源码，应通过 SessionRepository 承载会话、任务和事件复杂查询。
const sessionDomainSource = readProjectFile("services/center/src/session-domain.ts");

const requiredRepositorySignals = [
  "export class AgentRepository",
  "private readonly database: CenterDatabase",
  "insertAgent(",
  "upsertAgent(",
  "findAgentById(",
  "updateAgent(",
  "disableAgent(",
  "deleteAgentIndexes(",
  "listAgents()",
  "agents_index",
];

for (const signal of requiredRepositorySignals) {
  if (!repositorySource.includes(signal)) {
    console.error(`智能体数据访问层缺少边界信号：${signal}`);
    process.exitCode = 1;
  }
}

if (repositorySource.includes("new Database(")
    || repositorySource.includes("better-sqlite3")) {
  console.error("数据访问层不能创建新的 SQLite 连接，必须复用 CenterDatabase 持有的唯一连接。");
  process.exitCode = 1;
}

if (!agentDomainSource.includes("new AgentRepository(database)")) {
  console.error("智能体领域必须通过 AgentRepository 访问 agents_index。");
  process.exitCode = 1;
}

const directAgentSqlPattern = /database\.connection\(\)[\s\S]{0,120}\.prepare\("[^"]*agents_index/u;
if (directAgentSqlPattern.test(agentDomainSource)) {
  console.error("智能体领域不能继续直接散落 agents_index SQL，应收敛到 AgentRepository。");
  process.exitCode = 1;
}

const requiredSessionRepositorySignals = [
  "export class SessionRepository",
  "private readonly database: CenterDatabase",
  "findSession(",
  "listSessions(",
  "listMessages(",
  "listTurns(",
  "listTasks(",
  "listTaskSteps(",
  "listEvents(",
  "FROM sessions",
  "FROM task_steps",
  "FROM events",
];

for (const signal of requiredSessionRepositorySignals) {
  if (!sessionRepositorySource.includes(signal)) {
    console.error(`会话数据访问层缺少边界信号：${signal}`);
    process.exitCode = 1;
  }
}

if (sessionRepositorySource.includes("new Database(")
    || sessionRepositorySource.includes("better-sqlite3")) {
  console.error("会话数据访问层不能创建新的 SQLite 连接，必须复用 CenterDatabase 持有的唯一连接。");
  process.exitCode = 1;
}

if (!sessionDomainSource.includes("new SessionRepository(database)")) {
  console.error("会话领域必须通过 SessionRepository 访问高频会话、任务和事件查询。");
  process.exitCode = 1;
}

const directSessionQueryPattern = /export function (findSession|listSessions|listMessages|listTurns|listTasks|listTaskSteps|listEvents)[\s\S]{0,500}database\.connection\(\)[\s\S]{0,200}\.prepare/u;
if (directSessionQueryPattern.test(sessionDomainSource)) {
  console.error("会话领域高频查询函数不能继续直接散落复杂 SQL，应委托 SessionRepository。");
  process.exitCode = 1;
}
