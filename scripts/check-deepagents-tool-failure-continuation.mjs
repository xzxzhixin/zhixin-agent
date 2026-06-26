/**
 * Deep Agents 工具失败继续执行回归检查。
 *
 * 用途：防止普通工具失败从工具观测流冒泡成整轮失败。
 * 关键逻辑：只读取源码信号，不运行 TypeScript 编译器，也不启动中心服务。
 */
import {
    readFileSync,
} from "node:fs";
import {
    join,
} from "node:path";

// root: 当前项目根目录。
const root = process.cwd();
// failures: 收集所有失败信号，便于一次性看到缺口。
const failures = [];

/**
 * readProjectFile：读取项目内 UTF-8 文本文件。
 *
 * @param {string} relativePath 项目相对路径。
 * @returns {string} 文件文本。
 */
function readProjectFile(relativePath) {
    return readFileSync(
        join(
            root,
            relativePath,
        ),
        "utf-8",
    );
}

/**
 * assertIncludes：断言源码包含指定信号。
 *
 * @param {string} source 源码文本。
 * @param {string} signal 必须存在的源码信号。
 * @param {string} message 失败说明。
 * @returns {void}
 */
function assertIncludes(
    source,
    signal,
    message,
) {
    if (!source.includes(signal)) {
        failures.push(message);
    }
}

/**
 * assertNotIncludes：断言源码不包含指定信号。
 *
 * @param {string} source 源码文本。
 * @param {string} signal 禁止存在的源码信号。
 * @param {string} message 失败说明。
 * @returns {void}
 */
function assertNotIncludes(
    source,
    signal,
    message,
) {
    if (source.includes(signal)) {
        failures.push(message);
    }
}

// deepAgentsAgent: Deep Agents 原生入口，负责工具观测流和轮次终态。
const deepAgentsAgent = readProjectFile("services/center/src/deepagents-agent.ts");
// design: 已确认的工具失败继续执行设计事实源。
const design = readProjectFile("docs/superpowers/specs/2026-06-25-deepagents-tool-failure-continuation-design.md");

assertIncludes(
    design,
    "普通 MCP 工具失败：展示失败过程卡片，回填模型，轮次继续。",
    "设计事实源必须明确普通 MCP 工具失败不能直接终止轮次。",
);
assertIncludes(
    deepAgentsAgent,
    "handleDeepAgentToolStreamError",
    "Deep Agents 工具观测流必须有专用错误处理边界。",
);
assertIncludes(
    deepAgentsAgent,
    "工具观测流失败不代表 Deep Agents ReAct loop 结束",
    "工具观测流错误处理必须注释说明不能打断 Deep Agents 原生循环。",
);
assertIncludes(
    deepAgentsAgent,
    "recordDeepAgentOutputObservationError",
    "Deep Agents 最终输出投影异常必须只记录观测失败，不能直接升级为整轮失败。",
);
assertIncludes(
    deepAgentsAgent,
    "model.output.observer.failed",
    "Deep Agents 最终输出投影异常必须有独立事件，便于和真实轮次失败区分。",
);
assertIncludes(
    deepAgentsAgent,
    "visibleStreamText",
    "Deep Agents 最终输出缺失时必须复用已流出的助手文本，避免空回复触发失败收尾。",
);
assertNotIncludes(
    deepAgentsAgent,
    `        throw error;\n    }\n    throwIfTurnRuntimeAborted(context.runtimeSignal);`,
    "collectDeepAgentToolCalls 不能把普通工具观测流异常继续抛给整轮失败收尾。",
);

if (failures.length > 0) {
    console.error("Deep Agents 工具失败继续执行回归检查失败：");
    for (const failure of failures) {
        console.error(`- ${failure}`);
    }
    process.exit(1);
}

console.log("Deep Agents 工具失败继续执行回归检查通过。");
