/**
 * Google Drive OAuth 授权模块
 * 实现用户在网站内完成Google Drive授权
 * 每用户独立 OAuth 凭证（租户隔离）
 */

import crypto from "crypto";
import { getDb } from "./db";
import { googleTokens } from "../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";

// OAuth配置
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const SCOPES = ["https://www.googleapis.com/auth/drive"];

// 固定的部署域名（不使用动态的VITE_APP_ID，因为沙盒环境的ID会变化）
const PRODUCTION_DOMAIN = "feedmvp-i28qgefq.manus.space";

// OAuth state 签名密钥（防止伪造 userId）
const STATE_SECRET = process.env.OAUTH_STATE_SECRET || crypto.randomBytes(32).toString("hex");

// 根据环境选择回调URL
export function getRedirectUri(): string {
  // 生产环境：使用固定的部署域名
  if (process.env.NODE_ENV === "production" || process.env.VITE_APP_ID) {
    return `https://${PRODUCTION_DOMAIN}/api/google/callback`;
  }
  // 本地开发
  return "http://localhost:3000/api/google/callback";
}

/**
 * 生成 OAuth state 参数（HMAC 签名，编码 userId + 时间戳）
 */
export function encodeOAuthState(userId: number): string {
  const payload = JSON.stringify({ userId, ts: Date.now() });
  const hmac = crypto.createHmac("sha256", STATE_SECRET).update(payload).digest("hex");
  return Buffer.from(`${payload}.${hmac}`).toString("base64url");
}

/**
 * 验证并解码 OAuth state 参数
 */
export function decodeOAuthState(state: string): number {
  const decoded = Buffer.from(state, "base64url").toString();
  const lastDot = decoded.lastIndexOf(".");
  if (lastDot === -1) throw new Error("state 参数格式无效");
  const payload = decoded.slice(0, lastDot);
  const hmac = decoded.slice(lastDot + 1);
  const expected = crypto.createHmac("sha256", STATE_SECRET).update(payload).digest("hex");
  if (hmac !== expected) throw new Error("state 参数签名无效");
  const { userId, ts } = JSON.parse(payload);
  if (Date.now() - ts > 10 * 60 * 1000) throw new Error("state 已过期（10分钟）");
  return userId;
}

/**
 * 确保 google_tokens 表有 user_id 列（兼容旧表）
 */
let _googleTokensReady = false;
async function ensureGoogleTokensSchema(): Promise<void> {
  if (_googleTokensReady) return;
  const db = await getDb();
  if (!db) return;
  try {
    // safeAddColumn: 如果列不存在则添加
    await db.execute(sql`
      SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'google_tokens' AND COLUMN_NAME = 'user_id');
    `);
    await db.execute(sql`
      SET @add_col = IF(@col_exists = 0, 'ALTER TABLE google_tokens ADD COLUMN user_id INT NOT NULL DEFAULT 1', 'SELECT 1');
    `);
    await db.execute(sql`PREPARE stmt FROM @add_col`);
    await db.execute(sql`EXECUTE stmt`);
    await db.execute(sql`DEALLOCATE PREPARE stmt`);
  } catch {
    // 忽略错误（prepared statement 在某些 TiDB 版本不支持）
    // 如果列已存在，后续操作自然能工作
  }
  _googleTokensReady = true;
}

/**
 * 生成Google OAuth授权URL（带 userId 编码的 state）
 */
export function getAuthUrl(userId: number): string {
  const redirectUri = getRedirectUri();
  console.log("[Google OAuth] redirect_uri:", redirectUri);
  console.log("[Google OAuth] userId:", userId);
  const state = encodeOAuthState(userId);
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent", // 强制显示同意页面以获取refresh_token
    state, // 编码 userId，回调时解码
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * 处理OAuth回调，用授权码换取token
 */
export async function handleCallback(code: string, userId: number): Promise<{ success: boolean; error?: string }> {
  const redirectUri = getRedirectUri();

  try {
    await ensureGoogleTokensSchema();

    // 用授权码换取token
    const authController = new AbortController();
    const authTimer = setTimeout(() => authController.abort(), 30_000); // 30秒
    let tokenData: any;
    try {
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        }),
        signal: authController.signal,
      });

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.text();
        console.error("[GoogleAuth] Token exchange failed:", errorData);
        return { success: false, error: `Token交换失败: ${tokenResponse.status}` };
      }

      tokenData = await tokenResponse.json();
    } finally {
      clearTimeout(authTimer);
    }

    if (!tokenData.access_token || !tokenData.refresh_token) {
      console.error("[GoogleAuth] Missing tokens in response:", tokenData);
      return { success: false, error: "未获取到完整的授权信息" };
    }

    // 计算过期时间
    const expiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000);

    // 保存到数据库（先删除该用户旧的，再插入新的）
    const db = await getDb();
    if (!db) {
      return { success: false, error: "数据库连接失败" };
    }
    await db.delete(googleTokens).where(eq(googleTokens.userId, userId));
    await db.insert(googleTokens).values({
      userId,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt,
    });

    console.log(`[GoogleAuth] Token saved for user ${userId}, expires at:`, expiresAt);
    return { success: true };
  } catch (error) {
    console.error("[GoogleAuth] Callback error:", error);
    return { success: false, error: `授权处理失败: ${error}` };
  }
}

// 防止并发刷新：每用户一把锁
const refreshPromises = new Map<number, Promise<string | null>>();

/**
 * 获取有效的access token（自动刷新过期token）
 */
export async function getValidToken(userId: number): Promise<string | null> {
  const existing = refreshPromises.get(userId);
  if (existing) return existing;
  const promise = _getValidToken(userId).finally(() => {
    refreshPromises.delete(userId); // Promise 完成后立即清理
  });
  refreshPromises.set(userId, promise);
  return promise;
}

async function _getValidToken(userId: number): Promise<string | null> {
  try {
    await ensureGoogleTokensSchema();
    const db = await getDb();
    if (!db) {
      console.log("[GoogleAuth] Database not available");
      return null;
    }
    // 从数据库获取该用户的token
    const tokens = await db.select().from(googleTokens)
      .where(eq(googleTokens.userId, userId))
      .limit(1);

    if (tokens.length === 0) {
      console.log(`[GoogleAuth] No token found for user ${userId}`);
      return null;
    }

    const token = tokens[0];
    const now = new Date();

    // 检查是否过期（提前5分钟刷新）
    const expiresAt = new Date(token.expiresAt);
    const needsRefresh = expiresAt.getTime() - now.getTime() < 5 * 60 * 1000;

    if (!needsRefresh) {
      return token.accessToken;
    }

    console.log(`[GoogleAuth] Token expired for user ${userId}, refreshing...`);

    // 刷新token
    const refreshController = new AbortController();
    const refreshTimer = setTimeout(() => refreshController.abort(), 30_000); // 30秒
    let refreshData: any;
    try {
      const refreshResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: token.refreshToken,
          grant_type: "refresh_token",
        }),
        signal: refreshController.signal,
      });

      if (!refreshResponse.ok) {
        const errorData = await refreshResponse.text();
        console.error(`[GoogleAuth] Token refresh failed for user ${userId}:`, errorData);
        // 刷新失败，删除该用户的无效token
        await db.delete(googleTokens).where(eq(googleTokens.userId, userId));
        return null;
      }

      refreshData = await refreshResponse.json();
    } finally {
      clearTimeout(refreshTimer);
    }
    const newExpiresAt = new Date(Date.now() + (refreshData.expires_in || 3600) * 1000);

    // 更新数据库中的token
    await db!.update(googleTokens)
      .set({
        accessToken: refreshData.access_token,
        expiresAt: newExpiresAt,
      })
      .where(eq(googleTokens.id, token.id));

    console.log(`[GoogleAuth] Token refreshed for user ${userId}, new expiry:`, newExpiresAt);
    return refreshData.access_token;
  } catch (error) {
    console.error(`[GoogleAuth] getValidToken error for user ${userId}:`, error);
    return null;
  }
}

/**
 * 检查用户是否已授权
 */
export async function isAuthorized(userId: number): Promise<boolean> {
  try {
    await ensureGoogleTokensSchema();
    const db = await getDb();
    if (!db) return false;
    const tokens = await db.select().from(googleTokens)
      .where(eq(googleTokens.userId, userId))
      .limit(1);
    return tokens.length > 0;
  } catch (error) {
    console.error("[GoogleAuth] isAuthorized error:", error);
    return false;
  }
}

/**
 * 断开用户的连接（删除该用户的token）
 */
export async function disconnect(userId: number): Promise<{ success: boolean }> {
  try {
    await ensureGoogleTokensSchema();
    const db = await getDb();
    if (!db) return { success: false };
    await db.delete(googleTokens).where(eq(googleTokens.userId, userId));
    console.log(`[GoogleAuth] Disconnected user ${userId}`);
    return { success: true };
  } catch (error) {
    console.error("[GoogleAuth] Disconnect error:", error);
    return { success: false };
  }
}

/**
 * 获取用户的授权状态详情
 */
export async function getStatus(userId: number): Promise<{
  authorized: boolean;
  expiresAt?: string;
  error?: string;
}> {
  try {
    await ensureGoogleTokensSchema();
    const db = await getDb();
    if (!db) {
      return { authorized: false, error: "数据库连接失败" };
    }
    const tokens = await db.select().from(googleTokens)
      .where(eq(googleTokens.userId, userId))
      .limit(1);

    if (tokens.length === 0) {
      return { authorized: false };
    }

    const token = tokens[0];
    return {
      authorized: true,
      expiresAt: token.expiresAt.toISOString(),
    };
  } catch (error) {
    console.error("[GoogleAuth] getStatus error:", error);
    return { authorized: false, error: `获取状态失败: ${error}` };
  }
}
