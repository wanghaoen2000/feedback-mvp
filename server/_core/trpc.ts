import { NOT_ADMIN_ERR_MSG, NOT_ALLOWED_ERR_MSG, UNAUTHED_ERR_MSG, ADMIN_COOKIE_NAME } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { isEmailAllowed } from "../core/aiClient";

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

  // 白名单检查：admin 角色始终放行，伪装模式也放行（管理员已授权），其他用户检查邮箱
  if (ctx.user.role !== 'admin') {
    const adminCookie = ctx.req.cookies?.[ADMIN_COOKIE_NAME] || ctx.req.headers.cookie?.split(';')
      .find((c: string) => c.trim().startsWith(ADMIN_COOKIE_NAME + '='))
      ?.split('=').slice(1).join('=');
    const isImpersonating = !!adminCookie;
    if (!isImpersonating) {
      const allowed = await isEmailAllowed(ctx.user.email);
      if (!allowed) {
        throw new TRPCError({ code: "FORBIDDEN", message: NOT_ALLOWED_ERR_MSG });
      }
    }
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
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
