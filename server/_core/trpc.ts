import { NOT_ADMIN_ERR_MSG, NOT_ALLOWED_ERR_MSG, UNAUTHED_ERR_MSG, ADMIN_COOKIE_NAME } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  // 权限检查：admin 始终放行，伪装模式放行，被暂停的用户拒绝
  if (ctx.user.role !== 'admin') {
    const isSuspended = (ctx.user as any).accountStatus === 'suspended';
    if (isSuspended) {
      // 伪装模式仍允许（管理员查看被暂停用户的数据）
      const adminCookie = ctx.req.cookies?.[ADMIN_COOKIE_NAME] || ctx.req.headers.cookie?.split(';')
        .find((c: string) => c.trim().startsWith(ADMIN_COOKIE_NAME + '='))
        ?.split('=').slice(1).join('=');
      if (!adminCookie) {
        throw new TRPCError({ code: "FORBIDDEN", message: NOT_ALLOWED_ERR_MSG });
      }
    }
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
      userId: ctx.user.id, // 便捷访问，租户隔离使用
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
