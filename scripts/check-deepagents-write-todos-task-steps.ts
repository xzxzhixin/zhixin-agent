import {strict as assert} from "node:assert";

import {convertDeepAgentsWriteTodosForTaskStepsTest} from "../services/center/src/deepagents-agent.js";

/**
 * main：验证 Deep Agents 原生 write_todos 结构化结果会被桥接为用户可见任务步骤输入。
 *
 * 约束：该脚本只验证纯转换边界，不启动中心服务，不调用真实模型。
 */
async function main(): Promise<void> {
    const bridgeItems = convertDeepAgentsWriteTodosForTaskStepsTest({
        toolName: "write_todos",
        output: {
            update: {
                todos: [
                    {
                        content: "打开并复用 GitHub Trending 页面",
                        status: "in_progress",
                    },
                    {
                        content: "筛选今天 AI 开发相关的新技术",
                        status: "pending",
                    },
                    {
                        content: "总结技术栈和结论",
                        status: "completed",
                    },
                ],
            },
        },
    });

    assert.deepEqual(
        bridgeItems,
        [
            {
                title: "打开并复用 GitHub Trending 页面",
                status: "running",
                stepOrder: 1,
            },
            {
                title: "筛选今天 AI 开发相关的新技术",
                status: "queued",
                stepOrder: 2,
            },
            {
                title: "总结技术栈和结论",
                status: "completed",
                stepOrder: 3,
            },
        ],
        "Deep Agents write_todos 必须转换为 task_steps 可消费的用户可见步骤",
    );

    assert.deepEqual(
        convertDeepAgentsWriteTodosForTaskStepsTest({
            toolName: "builtin.deepagents.write_todos",
            output: {
                update: {
                    todos: [
                        {
                            content: "旧包装工具不能桥接",
                            status: "pending",
                        },
                    ],
                },
            },
        }),
        [],
        "旧中心服务 todoList 包装工具不能被桥接恢复",
    );
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
