import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { CENTER_DIRECTORY_NAMES, DEFAULT_CENTER_DIRECTORY_NAME, DEFAULT_CENTER_PORT } from "@zhixin/shared";
// readCenterServiceConfig：从环境变量读取中心服务配置，缺省时使用需求约定默认值。
export function readCenterServiceConfig() {
    // rawPort：允许桌面端启动中心服务时通过环境变量覆盖端口。
    const rawPort = process.env.ZHIXIN_CENTER_PORT;
    // port：端口必须是合法数字，否则回退到 8866。
    const port = rawPort ? Number.parseInt(rawPort, 10) : DEFAULT_CENTER_PORT;
    // rawCenterDirectory：允许桌面端或用户配置中心目录位置。
    const rawCenterDirectory = process.env.ZHIXIN_CENTER_DIR;
    // centerDirectory：未配置时使用用户主目录下的“中心”。
    const centerDirectory = rawCenterDirectory
        ? resolve(rawCenterDirectory)
        : join(homedir(), DEFAULT_CENTER_DIRECTORY_NAME);
    // 返回值：对外只暴露已经规范化的端口和目录。
    return {
        port: Number.isFinite(port) ? port : DEFAULT_CENTER_PORT,
        centerDirectory,
    };
}
// buildCenterDirectoryMap：生成中心目录各子目录的绝对路径映射。
export function buildCenterDirectoryMap(centerDirectory) {
    // entries：需求中规定的中心目录子目录名称和绝对路径。
    const entries = CENTER_DIRECTORY_NAMES.map((directoryName) => [
        directoryName,
        join(centerDirectory, directoryName),
    ]);
    // Object.fromEntries：保持目录名为中文，便于审查和迁移。
    return Object.fromEntries(entries);
}
