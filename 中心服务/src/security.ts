import { createHash, randomBytes, randomUUID } from "node:crypto";

// WebSessionRecord：中心服务内存中的 Web 登录态记录。
interface WebSessionRecord {
  // token：登录态令牌。
  token: string;
  // expiresAt：过期时间毫秒时间戳。
  expiresAt: number;
}

// WebSessionIssue：中心服务内部签发结果，token 只用于写入 HttpOnly Cookie。
export interface WebSessionIssue {
  // token：中心服务签发的登录态令牌，不返回给 Web 前端 JavaScript。
  token: string;
  // expiresAt：登录态过期时间，ISO 8601 字符串。
  expiresAt: string;
  // maxAgeSeconds：Cookie Max-Age 秒数，和内存登录态有效期保持一致。
  maxAgeSeconds: number;
}

// WebSessionValidation：中心服务内部 Cookie 校验结果。
export interface WebSessionValidation {
  // valid：Cookie 中的登录态是否存在且未过期。
  valid: boolean;
  // expiresAt：有效登录态的过期时间，ISO 8601 字符串；无效时为空。
  expiresAt?: string;
}

// hashSecret：对账号密码或 API Key 做不可逆摘要。
export function hashSecret(value: string): string {
  // createHash：使用 SHA-256 保存摘要，避免中心服务配置中出现密码明文。
  return createHash("sha256").update(value, "utf-8").digest("hex");
}

// createApiKeyMarker：把 API Key 明文保存为摘要标记，当前骨架不回传明文。
export function createApiKeyMarker(apiKey: string): string {
  // randomBytes：加入盐值避免相同 API Key 摘要完全一致。
  const salt = randomBytes(16).toString("hex");
  // hashSecret：摘要只用于判断已保存和后续接入真实密钥库。
  return `${salt}:${hashSecret(`${salt}:${apiKey}`)}`;
}

// createSecretMarker：对代理用户名、代理密码等敏感值生成摘要标记。
export function createSecretMarker(value: string): string {
  // empty：空用户名或空密码是合法的无认证代理配置，保存为空标记。
  if (value === "") {
    return "";
  }
  // salt：非空敏感值加入盐值，避免相同内容摘要完全一致。
  const salt = randomBytes(16).toString("hex");
  // hashSecret：只保存摘要，不保存明文。
  return `${salt}:${hashSecret(`${salt}:${value}`)}`;
}

// WebSessionManager：管理 Web端非本机访问登录态。
export class WebSessionManager {
  // sessions：首版使用内存登录态，后续可迁移到中心目录会话配置。
  private readonly sessions = new Map<string, WebSessionRecord>();

  // issue：签发新的 Web 登录态。
  issue(): WebSessionIssue {
    // token：使用 UUID 生成不可预测令牌。
    const token = randomUUID();
    // maxAgeSeconds：需求要求登录态有明确过期策略，首版固定 7 天。
    const maxAgeSeconds = 7 * 24 * 60 * 60;
    // expiresAt：默认 7 天有效，后续可从中心服务配置读取。
    const expiresAt = Date.now() + maxAgeSeconds * 1000;
    // set：保存到内存态，用于后续校验。
    this.sessions.set(token, {
      token,
      expiresAt,
    });
    // WebSessionIssue：token 只给中心服务写 Cookie，避免前端脚本保存登录令牌。
    return {
      token,
      expiresAt: new Date(expiresAt).toISOString(),
      maxAgeSeconds,
    };
  }

  // verify：校验登录态是否存在且未过期。
  verify(token: string): WebSessionValidation {
    // record：没有记录说明未登录或服务重启后登录态失效。
    const record = this.sessions.get(token);
    // exists：无记录直接失败。
    if (!record) {
      return {
        valid: false,
      };
    }
    // expired：过期后删除，避免内存长期增长。
    if (record.expiresAt < Date.now()) {
      this.sessions.delete(token);
      return {
        valid: false,
      };
    }
    // valid：登录态有效。
    return {
      valid: true,
      expiresAt: new Date(record.expiresAt).toISOString(),
    };
  }
}
