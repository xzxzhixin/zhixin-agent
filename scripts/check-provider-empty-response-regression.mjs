/**
 * 供应商空文本误判静态回归检查。
 *
 * 用途：防止合法工具调用、合法空 content 工具响应或已有流式片段被误判为 PROVIDER_RESPONSE_TEXT_EMPTY。
 * 关键逻辑：只读取模型网关源码，不运行中心服务，不执行 TypeScript 编译器。
 */
import fs from "node:fs";
import path from "node:path";

/**
 * readText：读取项目内 UTF-8 文本。
 *
 * @param {string} relativePath 项目相对路径。
 * @returns {string} 文件内容。
 */
function readText(relativePath) {
  return fs.readFileSync(
    path.join(
      process.cwd(),
      relativePath,
    ),
    "utf8",
  );
}

/**
 * assertIncludes：检查文本包含稳定实现信号。
 *
 * @param {string} source 被检查文本。
 * @param {string} needle 必须存在的片段。
 * @param {string} message 失败说明。
 * @returns {void} 没有返回值。
 */
function assertIncludes(
    source,
    needle,
    message,
) {
  if (!source.includes(needle)) {
    console.error(message);
    console.error(`缺少片段：${needle}`);
    process.exit(1);
  }
}

// modelGatewayRuntime: 中心服务供应商模型调用网关。
const modelGatewayRuntime = readText("services/center/src/model-gateway-runtime.ts");

assertIncludes(
  modelGatewayRuntime,
  "hasStreamedAssistantContent",
  "模型网关必须记录已经收到的流式文本片段，不能流式阶段有内容仍抛 PROVIDER_RESPONSE_TEXT_EMPTY。",
);
assertIncludes(
  modelGatewayRuntime,
  "合法空 content 工具调用",
  "模型网关必须用中文注释说明 OpenAI 工具调用响应 content 为空是合法情况。",
);
assertIncludes(
  modelGatewayRuntime,
  "hasUsableAssistantOutput",
  "模型网关必须用统一函数判断助手输出是否可用，避免多处空文本条件漂移。",
);
assertIncludes(
  modelGatewayRuntime,
  "toolCalls.length > 0",
  "PROVIDER_RESPONSE_TEXT_EMPTY 判断必须保留结构化工具调用为可用输出。",
);

console.log("供应商空文本误判静态回归检查通过。");
