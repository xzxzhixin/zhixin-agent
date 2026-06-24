import {strict as assert} from "node:assert";
import {readFileSync} from "node:fs";

/**
 * main：验证前端收到任务步骤事件后会延迟刷新会话快照，让任务入口实时读取 task_steps。
 *
 * 约束：task.step 事件只触发事实快照刷新，不应恢复为消息流过程卡片；延迟刷新用于避开事件先于步骤表可读的竞态。
 */
async function main(): Promise<void> {
    const source = readFileSync(
        "apps/frontend/src/stores/app-conversation-actions.ts",
        "utf8",
    );

    assert.match(
        source,
        /event\.eventType\.startsWith\("task\.step\."\)[\s\S]{0,260}window\.setTimeout\([\s\S]{0,180}loadActiveSessionSnapshot\(\)[\s\S]{0,80}100/u,
        "WebSocket 收到 task.step.* 后必须延迟刷新会话快照，确保 task_steps 能实时进入任务面板。",
    );
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
