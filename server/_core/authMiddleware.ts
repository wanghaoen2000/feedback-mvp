/**
 * Express 认证中间件
 * 用于保护非 tRPC 的 Express 路由（如 SSE 端点、批量处理端点）
 */
import { Request, Response, NextFunction } from "express";
import { sdk } from "./sdk";
import { isEmailAllowed } from "../core/aiClient";

/**
 * 认证中间件 - 验证用户是否已登录 + 白名单检查
 * 如果未登录，返回 401 错误
 * 如果已登录但不在白名单中，返回 403 错误
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = await sdk.authenticateRequest(req);
    // 将用户信息附加到请求对象上，供后续处理使用
    (req as any).user = user;

    // 白名单检查：admin 角色始终放行
    if (user.role !== 'admin') {
      const allowed = await isEmailAllowed(user.email);
      if (!allowed) {
        res.status(403).json({
          error: "Forbidden",
          message: "您的账号未被授权使用此系统，请联系管理员",
          code: "NOT_ALLOWED",
        });
        return;
      }
    }

    next();
  } catch (error) {
    console.warn("[AuthMiddleware] 认证失败:", error);
    res.status(401).json({
      error: "Unauthorized",
      message: "请先登录后再使用此功能",
      code: "UNAUTHORIZED",
    });
  }
}

/**
 * 可选认证中间件 - 尝试获取用户信息，但不强制要求登录
 * 用于需要区分登录/未登录用户但不阻止访问的场景
 */
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = await sdk.authenticateRequest(req);
    (req as any).user = user;
  } catch (error) {
    // 认证失败时不阻止请求，只是不设置用户信息
    (req as any).user = null;
  }
  next();
}
