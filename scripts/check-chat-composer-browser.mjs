/**
 * 对话输入区浏览器布局回归检查。
 *
 * 用途：验证输入区固定在底部且参与 flex 回流，拖拽手柄改变输入区高度后不遮挡消息列表。
 * 关键逻辑：连接正在运行的前端页面，用真实 DOM 尺寸检查消息列表和输入区边界。
 * 参数：可选 `CHAT_URL` 环境变量，默认检查 `http://127.0.0.1:5173/#/chat`。
 * 返回值：通过时退出码为 0，失败时退出码为 1。
 */
import {
  chromium,
} from "playwright";

// chatUrl: 浏览器检查目标地址，开发期默认使用 Vite HMR 对话页。
const chatUrl = process.env.CHAT_URL ?? "http://127.0.0.1:5173/#/chat";

/**
 * fail：输出失败原因并设置退出码。
 *
 * @param {string} message 失败说明。
 * @returns {void}
 */
function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

/**
 * getLayoutState：读取对话区与输入区真实边界。
 *
 * @param {import("playwright").Page} page 浏览器页面。
 * @returns {Promise<{
 *   composerHeight: number;
 *   messageBottom: number;
 *   composerTop: number;
 *   composerBottom: number;
 *   viewportHeight: number;
 * }>} 布局尺寸。
 */
async function getLayoutState(page) {
  return page.evaluate(() => {
    const messageList = document.querySelector(".chat-page-host .message-list");
    const composer = document.querySelector(".chat-page-host .composer");
    if (!(messageList instanceof HTMLElement) || !(composer instanceof HTMLElement)) {
      throw new Error("对话消息列表或输入区 DOM 不存在。");
    }
    const messageRect = messageList.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    return {
      composerHeight: composerRect.height,
      messageBottom: messageRect.bottom,
      composerTop: composerRect.top,
      composerBottom: composerRect.bottom,
      viewportHeight: window.innerHeight,
    };
  });
}

const browser = await chromium.launch({
  headless: true,
});

try {
  const page = await browser.newPage({
    viewport: {
      width: 1280,
      height: 780,
    },
  });
  await page.goto(
    chatUrl,
    {
      waitUntil: "networkidle",
      timeout: 30000,
    },
  );
  await page.waitForSelector(
    ".chat-page-host .composer-resize-handle",
    {
      timeout: 15000,
    },
  );

  const before = await getLayoutState(page);
  if (before.messageBottom > before.composerTop + 1) {
    fail(`消息列表与输入区发生重叠：messageBottom=${before.messageBottom}, composerTop=${before.composerTop}`);
  }
  if (before.composerBottom > before.viewportHeight + 1) {
    fail(`输入区溢出视口底部：composerBottom=${before.composerBottom}, viewportHeight=${before.viewportHeight}`);
  }

  const handleBox = await page.locator(".chat-page-host .composer-resize-handle").boundingBox();
  if (!handleBox) {
    fail("输入区拖拽手柄无法计算位置。");
  } else {
    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;
    await page.mouse.move(
      startX,
      startY,
    );
    await page.mouse.down();
    await page.mouse.move(
      startX,
      startY - 70,
      {
        steps: 8,
      },
    );
    await page.mouse.up();
  }

  await page.waitForTimeout(120);
  const after = await getLayoutState(page);
  if (after.composerHeight <= before.composerHeight + 20) {
    fail(`拖拽后输入区高度没有明显增加：before=${before.composerHeight}, after=${after.composerHeight}`);
  }
  if (after.messageBottom > after.composerTop + 1) {
    fail(`拖拽后消息列表与输入区发生重叠：messageBottom=${after.messageBottom}, composerTop=${after.composerTop}`);
  }
  if (after.composerBottom > after.viewportHeight + 1) {
    fail(`拖拽后输入区溢出视口底部：composerBottom=${after.composerBottom}, viewportHeight=${after.viewportHeight}`);
  }
} finally {
  await browser.close();
}
