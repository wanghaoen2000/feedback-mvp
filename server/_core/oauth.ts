import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import * as googleAuth from "../googleAuth";
import { decodeOAuthState } from "../googleAuth";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export function registerOAuthRoutes(app: Express) {
  // Google Drive OAuth 回调路由（通过 state 参数传递 userId）
  app.get("/api/google/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const error = getQueryParam(req, "error");
    const state = getQueryParam(req, "state");

    console.log("[Google OAuth Callback] Received request", { code: code ? "present" : "missing", error, state: state ? "present" : "missing" });

    if (error) {
      console.error("[Google OAuth Callback] Error from Google:", error);
      res.redirect("/?google_auth_error=" + encodeURIComponent(error));
      return;
    }

    if (!code) {
      console.error("[Google OAuth Callback] No code provided");
      res.redirect("/?google_auth_error=no_code");
      return;
    }

    if (!state) {
      console.error("[Google OAuth Callback] No state provided (missing userId)");
      res.redirect("/?google_auth_error=no_state");
      return;
    }

    try {
      // 从 state 参数中解码并验证 userId
      const userId = decodeOAuthState(state);
      console.log(`[Google OAuth Callback] Decoded userId: ${userId}`);

      const result = await googleAuth.handleCallback(code, userId);
      console.log("[Google OAuth Callback] handleCallback result:", result);

      if (result.success) {
        res.redirect("/?google_auth_success=true");
      } else {
        res.redirect("/?google_auth_error=" + encodeURIComponent(result.error || "unknown"));
      }
    } catch (err) {
      console.error("[Google OAuth Callback] Exception:", err);
      res.redirect("/?google_auth_error=" + encodeURIComponent(err instanceof Error ? err.message : "unknown"));
    }
  });

  // Manus OAuth 回调路由
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
