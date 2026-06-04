/**
 * 供应商发送模型选择回归检查。
 *
 * 用途：验证已刷新模型列表存在时，中心服务不能继续使用过期默认模型发送真实请求。
 * 关键逻辑：直接读取中心服务源码，确认发送模型选择优先使用已保存模型列表中的可用模型。
 * 参数：无。
 * 返回值：检查通过时正常退出；任一断言失败时抛错并返回非零退出码。
 */
import {readFileSync} from "node:fs";
import {join} from "node:path";

/**
 * assert：最小断言工具。
 *
 * @param {boolean} condition 需要满足的条件。
 * @param {string} message 失败时输出的中文原因。
 * @returns {void}
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const sourcePath = join(
  process.cwd(),
  "services",
  "center",
  "src",
  "provider-domain.ts",
);
const source = readFileSync(sourcePath, "utf-8");

assert(
  source.includes("resolveProviderModelSelection"),
  "中心服务必须保留供应商发送模型选择函数。",
);

assert(
  !source.includes("? preferredModel.trim()\n        : modelList.models[0] ?? provider.defaultModel"),
  "发送模型选择不能在已刷新模型列表存在时继续优先使用过期默认模型。",
);

assert(
  source.includes("modelList.models.includes(trimmedPreferredModel)"),
  "发送模型选择必须检查默认模型是否仍存在于已刷新模型列表。",
);

assert(
  source.includes("modelList.models[0]"),
  "发送模型选择必须在默认模型过期时回退到模型列表首项。",
);

console.log("provider model selection check passed");
