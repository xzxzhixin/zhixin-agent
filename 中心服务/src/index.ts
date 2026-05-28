import { readCenterServiceConfig } from "./config.js";
import { CenterHttpServer } from "./server.js";
import { CenterStorage } from "./storage.js";

// main：中心服务进程入口。
async function main(): Promise<void> {
  // config：读取端口和中心目录，默认端口为 8866。
  const config = readCenterServiceConfig();
  // storage：中心目录固化数据读写能力。
  const storage = new CenterStorage(config);
  // server：首版中心服务 HTTP API。
  const server = new CenterHttpServer(config, storage);
  // listen：初始化目录后开始监听本机端口。
  await server.listen();
  // console：服务启动日志，后续会同步写入中心目录“日志”。
  console.log(`致心智能体中心服务已启动：http://127.0.0.1:${config.port}`);
}

// main().catch：入口错误明确输出并让进程失败退出。
main().catch((error) => {
  // message：保留原始错误，方便桌面端捕获启动失败原因。
  console.error(error);
  // exitCode：让进程管理器知道中心服务启动失败。
  process.exitCode = 1;
});
