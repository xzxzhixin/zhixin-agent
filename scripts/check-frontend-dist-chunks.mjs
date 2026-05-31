/**
 * 前端构建产物分包检查。
 *
 * 用途：验证 Vite 构建结果确实拆出了页面 chunk 和第三方 vendor chunk。
 * 关键逻辑：检查 dist/assets 文件名与主入口大小，避免源码规则存在但产物退化。
 */
import {
  readdirSync,
  statSync,
} from "node:fs";
import {
  join,
} from "node:path";

// assetsPath: 前端 Vite 构建产物目录。
const assetsPath = join(
  process.cwd(),
  "apps",
  "frontend",
  "dist",
  "assets",
);
// assetNames: dist/assets 下的产物文件名列表。
const assetNames = readdirSync(assetsPath);

/**
 * hasChunk：检查是否存在指定前缀的 JS chunk。
 *
 * @param prefix 产物文件名前缀。
 * @returns 存在对应 JS chunk 时返回 true。
 */
function hasChunk(prefix) {
  return assetNames.some((assetName) => (
    assetName.startsWith(prefix) &&
    assetName.endsWith(".js")
  ));
}

/**
 * readChunkSize：读取指定前缀 JS chunk 的字节大小。
 *
 * @param prefix 产物文件名前缀。
 * @returns 文件字节大小；不存在时返回 0。
 */
function readChunkSize(prefix) {
  // assetName: 命中的 JS chunk 文件名。
  const assetName = assetNames.find((currentAssetName) => (
    currentAssetName.startsWith(prefix) &&
    currentAssetName.endsWith(".js")
  ));

  if (assetName === undefined) {
    return 0;
  }

  return statSync(join(
    assetsPath,
    assetName,
  )).size;
}

for (const chunkPrefix of [
  "MainView-",
  "LoginView-",
  "vendor-vue-",
  "vendor-element-plus-",
  "vendor-vant-",
  "vendor-markdown-",
]) {
  if (!hasChunk(chunkPrefix)) {
    console.error(`前端构建产物缺少 ${chunkPrefix} JS chunk。`);
    process.exitCode = 1;
  }
}

// mainChunkSize: 主入口 JS 文件大小，目标是只保留应用引导和路由，不混入页面与三方大包。
const mainChunkSize = readChunkSize("main-");
// maxMainChunkSize: 主入口上限，当前构建约 18KB，留出增长余量但防止重新膨胀到大文件。
const maxMainChunkSize = 80 * 1024;

if (mainChunkSize === 0) {
  console.error("前端构建产物缺少 main JS chunk。");
  process.exitCode = 1;
} else if (mainChunkSize > maxMainChunkSize) {
  console.error(`前端 main JS chunk 过大：${mainChunkSize} 字节，必须继续拆分页面和三方依赖。`);
  process.exitCode = 1;
}
