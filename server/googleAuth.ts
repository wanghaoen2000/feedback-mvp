/**
 * Google Drive OAuth 授权模块
 * 实现用户在网站内完成Google Drive授权
 */

import { getDb } from "./db";
import { googleTokens } from "../drizzle/schema";
import { eq } from "drizzle-orm";

// OAuth配置
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const SCOPES = ["https://www.googleapis.com/auth/drive"];

// 固定的部署域名（不使用动态的VITE_APP_ID，因为沙盒环境的ID会变化）
const PRODUCTION_DOMAIN = "feedmvp-i28qgefq.manus.space";

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
 * 生成Google OAuth授权URL
 */
export function getAuthUrl(): string {
  const redirectUri = getRedirectUri();
  console.log("[Google OAuth] redirect_uri:", redirectUri);
  console.log("[Google OAuth] VITE_APP_ID:", process.env.VITE_APP_ID);
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent", // 强制显示同意页面以获取refresh_token
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * 处理OAuth回调，用授权码换取token
 */
export async function handleCallback(code: string): Promise<{ success: boolean; error?: string }> {
  const redirectUri = getRedirectUri();
  
  try {
    // 用授权码换取token
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
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error("[GoogleAuth] Token exchange failed:", errorData);
      return { success: false, error: `Token交换失败: ${tokenResponse.status}` };
    }

    const tokenData = await tokenResponse.json();
    
    if (!tokenData.access_token || !tokenData.refresh_token) {
      console.error("[GoogleAuth] Missing tokens in response:", tokenData);
      return { success: false, error: "未获取到完整的授权信息" };
    }

    // 计算过期时间
    const expiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000);

    // 保存到数据库（先删除旧的，再插入新的）
    const db = await getDb();
    if (!db) {
      return { success: false, error: "数据库连接失败" };
    }
    await db.delete(googleTokens);
    await db.insert(googleTokens).values({
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt,
    });

    console.log("[GoogleAuth] Token saved successfully, expires at:", expiresAt);
    return { success: true };
  } catch (error) {
    console.error("[GoogleAuth] Callback error:", error);
    return { success: false, error: `授权处理失败: ${error}` };
  }
}

// 防止并发刷新：多个请求同时过期时，只刷新一次
let refreshPromise: Promise<string | null> | null = null;

/**
 * 获取有效的access token（自动刷新过期token）
 */
export async function getValidToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = _getValidToken().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

async function _getValidToken(): Promise<string | null> {
  try {
    const db = await getDb();
    if (!db) {
      console.log("[GoogleAuth] Database not available");
      return null;
    }
    // 从数据库获取token
    const tokens = await db.select().from(googleTokens).limit(1);
    
    if (tokens.length === 0) {
      console.log("[GoogleAuth] No token found in database");
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

    console.log("[GoogleAuth] Token expired or expiring soon, refreshing...");

    // 刷新token
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
    });

    if (!refreshResponse.ok) {
      const errorData = await refreshResponse.text();
      console.error("[GoogleAuth] Token refresh failed:", errorData);
      // 刷新失败，删除无效token
      await db.delete(googleTokens);
      return null;
    }

    const refreshData = await refreshResponse.json();
    const newExpiresAt = new Date(Date.now() + (refreshData.expires_in || 3600) * 1000);

    // 更新数据库中的token
    await db!.update(googleTokens)
      .set({
        accessToken: refreshData.access_token,
        expiresAt: newExpiresAt,
      })
      .where(eq(googleTokens.id, token.id));

    console.log("[GoogleAuth] Token refreshed successfully, new expiry:", newExpiresAt);
    return refreshData.access_token;
  } catch (error) {
    console.error("[GoogleAuth] getValidToken error:", error);
    return null;
  }
}

/**
 * 检查是否已授权
 */
export async function isAuthorized(): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;
    const tokens = await db.select().from(googleTokens).limit(1);
    return tokens.length > 0;
  } catch (error) {
    console.error("[GoogleAuth] isAuthorized error:", error);
    return false;
  }
}

/**
 * 断开连接（删除token）
 */
export async function disconnect(): Promise<{ success: boolean }> {
  try {
    const db = await getDb();
    if (!db) return { success: false };
    await db.delete(googleTokens);
    console.log("[GoogleAuth] Disconnected successfully");
    return { success: true };
  } catch (error) {
    console.error("[GoogleAuth] Disconnect error:", error);
    return { success: false };
  }
}

/**
 * 获取授权状态详情
 */
export async function getStatus(): Promise<{
  authorized: boolean;
  expiresAt?: string;
  error?: string;
}> {
  try {
    const db = await getDb();
    if (!db) {
      return { authorized: false, error: "数据库连接失败" };
    }
    const tokens = await db.select().from(googleTokens).limit(1);
    
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
