import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { COOKIE_NAME, ADMIN_COOKIE_NAME, NOT_ALLOWED_ERR_MSG } from "@shared/const";
import { z } from "zod";
import { eq, gte, desc, and, not, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getSessionCookieOptions } from "./_core/cookies";
import { sdk } from "./_core/sdk";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import { getDb } from "./db";
import { ENV } from "./_core/env";
import { systemConfig, users, userConfig, backgroundTasks, hwStudents, hwEntries, batchTasks, batchTaskItems, correctionTasks, gradingTasks, gradingSyncItems } from "../drizzle/schema";
import { uploadToGoogleDrive, uploadBinaryToGoogleDrive, verifyAllFiles, UploadStatus, readFileFromGoogleDrive, verifyFileExists, searchFileInGoogleDrive } from "./gdrive";
import { parseError, formatErrorMessage, StructuredError } from "./errorHandler";
import { 
  createLogSession, 
  startStep, 
  stepSuccess, 
  stepFailed, 
  endLogSession, 
  logInfo, 
  getLatestLogPath, 
  getLatestLogPathByStudent,
  getLogContent, 
  listLogFiles 
} from './logger';
import { runSystemCheck } from "./systemCheck";
import * as googleAuth from "./googleAuth";
import {
  generateFeedbackContent,
  generateReviewContent,
  generateTestContent,
  generateExtractionContent,
  generateBubbleChartSVG,
  FeedbackInput,
  ClassFeedbackInput,
  CourseType,
  generateClassFeedbackContent,
  generateClassReviewContent,
  generateClassTestContent,
  generateClassExtractionContent,
  generateClassBubbleChartSVG,
  previewFeedbackPrompts,
} from "./feedbackGenerator";
import { storeContent } from "./contentStore";
import { DEFAULT_CONFIG, getConfigValue as getConfig, getUserOnlyConfigValue, setUserConfigValue, deleteUserConfigValue, ensureUserConfigTable, migrateSystemConfigToAdmin } from "./core/aiClient";
import { addWeekdayToDate } from "./utils";
import {
  listStudents,
  addStudent,
  updateStudent,
  removeStudent,
  submitAndProcessEntry,
  listPendingEntries,
  listEntries,
  retryEntry,
  deleteEntry,
  confirmEntries,
  confirmAllPreStaged,
  importFromExtraction,
  importFromTaskExtraction,
  importClassFromTaskExtraction,
  listStudentEntries,
  getStudentLatestStatus,
  exportStudentBackup,
  previewBackup,
  importStudentBackup,
  autoBackupToGDrive,
  previewEntryPrompt,
} from "./homeworkManager";
import {
  submitGrading,
  getGradingTask,
  listGradingTasks,
  updateGradingEditedResult,
  syncGradingToStudents,
  getGradingSyncItems,
  retrySyncItem,
  importSyncToStudents,
  DEFAULT_SYNC_SYSTEM_PROMPT,
} from "./gradingRunner";
import {
  submitReminder,
  getReminderTask,
  listReminderTasks,
  previewReminderPrompt,
  parseReminderResult,
} from "./reminderRunner";

// 设置配置值
async function setConfig(key: string, value: string, description?: string): Promise<void> {
  try {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用");
    const existing = await db.select().from(systemConfig).where(eq(systemConfig.key, key)).limit(1);
    if (existing.length > 0) {
      await db.update(systemConfig).set({ value, description }).where(eq(systemConfig.key, key));
    } else {
      await db.insert(systemConfig).values({ key, value, description });
    }
  } catch (e) {
    console.error(`设置配置 ${key} 失败:`, e);
    throw e;
  }
}


// 共享的输入schema（一对一）
const feedbackInputSchema = z.object({
  studentName: z.string().min(1, "请输入学生姓名"),
  lessonNumber: z.string().optional(),
  lessonDate: z.string().optional(), // 本次课日期，如"1月5日"
  currentYear: z.string().optional(), // 年份，如"2026"
  lastFeedback: z.string().optional(),
  currentNotes: z.string().min(1, "请输入本次课笔记"),
  transcript: z.string().min(1, "请输入录音转文字"),
  isFirstLesson: z.boolean().default(false),
  specialRequirements: z.string().optional(),
  // 配置参数（并发安全，由前端传入快照）
  apiModel: z.string().optional(),
  apiKey: z.string().optional(),
  apiUrl: z.string().optional(),
  roadmap: z.string().optional(),
  driveBasePath: z.string().optional(),
  taskId: z.string().optional(),
});

// 小班课输入schema
const classFeedbackInputSchema = z.object({
  classNumber: z.string().min(1, "请输入班号"),
  lessonNumber: z.string().optional(),
  lessonDate: z.string().optional(), // 本次课日期，如"1月15日"
  currentYear: z.string().optional(), // 年份，如"2026"
  attendanceStudents: z.array(z.string()).min(1, "至少需要1名出勤学生"),
  lastFeedback: z.string().optional(),
  currentNotes: z.string().min(1, "请输入本次课笔记"),
  transcript: z.string().min(1, "请输入录音转文字"),
  specialRequirements: z.string().optional(),
  // 配置参数
  apiModel: z.string().optional(),
  apiKey: z.string().optional(),
  apiUrl: z.string().optional(),
  roadmapClass: z.string().optional(), // 小班课路书
  driveBasePath: z.string().optional(),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(async (opts) => {
      const user = opts.ctx.user;
      if (!user) return null;
      // 检查是否在伪装模式（God Mode）
      const adminCookie = opts.ctx.req.cookies?.[ADMIN_COOKIE_NAME] || opts.ctx.req.headers.cookie?.split(';')
        .find((c: string) => c.trim().startsWith(ADMIN_COOKIE_NAME + '='))
        ?.split('=').slice(1).join('=');
      const isImpersonating = !!adminCookie;
      // 权限检查：admin 始终允许，伪装模式始终允许，否则检查用户状态（suspended=被暂停）
      const isSuspended = (user as any).accountStatus === 'suspended';
      const allowed = user.role === 'admin' || isImpersonating || !isSuspended;
      return { ...user, allowed, isImpersonating };
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  // 管理员功能
  admin: router({
    // 列出所有用户
    listUsers: adminProcedure.query(async () => {
      const db = await getDb();
      if (!db) throw new Error("数据库不可用");
      const allUsers = await db.select({
        id: users.id,
        openId: users.openId,
        name: users.name,
        email: users.email,
        loginMethod: users.loginMethod,
        role: users.role,
        accountStatus: users.accountStatus,
        createdAt: users.createdAt,
        lastSignedIn: users.lastSignedIn,
      }).from(users).orderBy(desc(users.lastSignedIn));
      return allUsers;
    }),

    // 切换到指定用户（God Mode）
    impersonateUser: adminProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("数据库不可用");

        // 查找目标用户
        const target = await db.select().from(users)
          .where(eq(users.id, input.userId)).limit(1);
        if (target.length === 0) throw new Error("用户不存在");

        const targetUser = target[0];
        const cookieOptions = getSessionCookieOptions(ctx.req);

        // 保存管理员原始session到admin cookie
        const adminCookie = ctx.req.cookies?.[COOKIE_NAME] || ctx.req.headers.cookie?.split(';')
          .find(c => c.trim().startsWith(COOKIE_NAME + '='))
          ?.split('=').slice(1).join('=');

        if (adminCookie) {
          ctx.res.cookie(ADMIN_COOKIE_NAME, adminCookie, {
            ...cookieOptions,
            maxAge: 24 * 60 * 60 * 1000, // 24小时
          });
        }

        // 创建目标用户的session token
        const sessionToken = await sdk.createSessionToken(targetUser.openId, {
          name: targetUser.name || "",
        });
        ctx.res.cookie(COOKIE_NAME, sessionToken, {
          ...cookieOptions,
          maxAge: 24 * 60 * 60 * 1000, // 24小时（不是永久的）
        });

        return {
          success: true,
          targetUser: { id: targetUser.id, name: targetUser.name, email: targetUser.email },
        };
      }),

    // 退出伪装模式，恢复管理员session
    stopImpersonating: protectedProcedure.mutation(async ({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);

      // 读取admin原始session
      const adminCookie = ctx.req.cookies?.[ADMIN_COOKIE_NAME] || ctx.req.headers.cookie?.split(';')
        .find(c => c.trim().startsWith(ADMIN_COOKIE_NAME + '='))
        ?.split('=').slice(1).join('=');

      if (!adminCookie) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "没有管理员session，无法退出伪装模式" });
      }

      // 恢复管理员session
      ctx.res.cookie(COOKIE_NAME, adminCookie, {
        ...cookieOptions,
        maxAge: 365 * 24 * 60 * 60 * 1000,
      });
      // 清除admin cookie
      ctx.res.clearCookie(ADMIN_COOKIE_NAME, { ...cookieOptions, maxAge: -1 });

      return { success: true };
    }),

    // 检查是否在伪装模式
    checkImpersonation: protectedProcedure.query(({ ctx }) => {
      const adminCookie = ctx.req.cookies?.[ADMIN_COOKIE_NAME] || ctx.req.headers.cookie?.split(';')
        .find(c => c.trim().startsWith(ADMIN_COOKIE_NAME + '='))
        ?.split('=').slice(1).join('=');
      return { isImpersonating: !!adminCookie };
    }),

    // 手动创建用户
    createUser: adminProcedure
      .input(z.object({
        name: z.string().min(1, "用户名不能为空"),
        email: z.string().email("邮箱格式不正确").min(1, "邮箱不能为空"),
        role: z.enum(["user", "admin"]).default("user"),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("数据库不可用");

        // Check email uniqueness before creating
        const existing = await db.select({ id: users.id })
          .from(users)
          .where(eq(users.email, input.email))
          .limit(1);
        if (existing.length > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `邮箱 ${input.email} 已被其他用户使用`,
          });
        }

        const openId = `manual_${crypto.randomUUID()}`;

        await db.insert(users).values({
          openId,
          name: input.name,
          email: input.email,
          loginMethod: "manual",
          role: input.role,
          lastSignedIn: new Date(),
        });

        const created = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
        if (created.length === 0) throw new Error("创建失败");

        return {
          success: true,
          user: {
            id: created[0].id,
            name: created[0].name,
            openId: created[0].openId,
            email: created[0].email,
            role: created[0].role,
          },
        };
      }),

    // 编辑用户（改名、改邮箱、改角色）
    updateUser: adminProcedure
      .input(z.object({
        userId: z.number(),
        name: z.string().min(1, "用户名不能为空").optional(),
        email: z.string().email("邮箱格式不正确").optional().nullable(),
        role: z.enum(["user", "admin"]).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("数据库不可用");

        // Check email uniqueness when changing email
        if (input.email) {
          const existing = await db.select({ id: users.id })
            .from(users)
            .where(and(eq(users.email, input.email), not(eq(users.id, input.userId))))
            .limit(1);
          if (existing.length > 0) {
            throw new TRPCError({
              code: "CONFLICT",
              message: `邮箱 ${input.email} 已被其他用户使用`,
            });
          }
        }

        const updateFields: Record<string, any> = {};
        if (input.name !== undefined) updateFields.name = input.name;
        if (input.email !== undefined) updateFields.email = input.email;
        if (input.role !== undefined) {
          // 不能把自己降级
          if (input.userId === ctx.user.id && input.role !== 'admin') {
            throw new TRPCError({ code: "BAD_REQUEST", message: "不能把自己降级为普通用户" });
          }
          updateFields.role = input.role;
        }

        if (Object.keys(updateFields).length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "没有需要更新的字段" });
        }

        await db.update(users).set(updateFields).where(eq(users.id, input.userId));
        return { success: true };
      }),

    // 暂停用户（保留数据，立即禁止使用）
    suspendUser: adminProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("数据库不可用");

        if (input.userId === ctx.user.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "不能暂停自己" });
        }

        await db.update(users)
          .set({ accountStatus: "suspended" })
          .where(eq(users.id, input.userId));
        return { success: true };
      }),

    // 恢复用户
    activateUser: adminProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("数据库不可用");

        await db.update(users)
          .set({ accountStatus: "active" })
          .where(eq(users.id, input.userId));
        return { success: true };
      }),

    // 删除用户（彻底删除，清理所有关联数据）
    deleteUser: adminProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new Error("数据库不可用");

        if (input.userId === ctx.user.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "不能删除自己" });
        }

        const uid = input.userId;

        // 1. 删除打分同步子项（通过 gradingTasks 级联）
        const userGradingTasks = await db.select({ id: gradingTasks.id }).from(gradingTasks).where(eq(gradingTasks.userId, uid));
        if (userGradingTasks.length > 0) {
          const gradingIds = userGradingTasks.map(t => t.id);
          await db.delete(gradingSyncItems).where(inArray(gradingSyncItems.gradingTaskId, gradingIds));
        }

        // 2. 删除批量任务子项（通过 batchTasks 级联）
        const userBatchTasks = await db.select({ id: batchTasks.id }).from(batchTasks).where(eq(batchTasks.userId, uid));
        if (userBatchTasks.length > 0) {
          const batchIds = userBatchTasks.map(t => t.id);
          await db.delete(batchTaskItems).where(inArray(batchTaskItems.batchId, batchIds));
        }

        // 3. 删除所有直接关联的表数据
        await Promise.all([
          db.delete(userConfig).where(eq(userConfig.userId, uid)),
          db.delete(backgroundTasks).where(eq(backgroundTasks.userId, uid)),
          db.delete(hwEntries).where(eq(hwEntries.userId, uid)),
          db.delete(hwStudents).where(eq(hwStudents.userId, uid)),
          db.delete(batchTasks).where(eq(batchTasks.userId, uid)),
          db.delete(correctionTasks).where(eq(correctionTasks.userId, uid)),
          db.delete(gradingTasks).where(eq(gradingTasks.userId, uid)),
        ]);

        // 4. 最后删除用户本身
        await db.delete(users).where(eq(users.id, uid));

        return { success: true };
      }),
  }),

  // 配置管理
  config: router({
    // 获取所有配置（仅读取用户自己的 user_config + DEFAULT_CONFIG）
    getAll: protectedProcedure.query(async ({ ctx }) => {
      const uid = ctx.user.id;
      // 仅 owner（ENV.ownerOpenId）首次访问时迁移 systemConfig 旧数据到 user_config
      // 不对其他 admin 执行，防止将 owner 的数据复制给其他管理员
      if (ctx.user.role === 'admin' && ctx.user.openId === ENV.ownerOpenId) {
        await migrateSystemConfigToAdmin(uid);
      }
      // 并行查询所有配置值（仅用户级，不穿透到 systemConfig）
      const [
        apiModel, apiKey, apiUrl, currentYear,
        roadmap, roadmapClass, firstLessonTemplate, classFirstLessonTemplate,
        driveBasePath, classStoragePath, batchFilePrefix, batchStoragePath,
        batchConcurrency, maxTokens, gdriveLocalBasePath, gdriveDownloadsPath,
        modelPresets, apiProviderPresets, gradingStoragePath,
      ] = await Promise.all([
        getConfig("apiModel", uid), getConfig("apiKey", uid), getConfig("apiUrl", uid), getConfig("currentYear", uid),
        getConfig("roadmap", uid), getConfig("roadmapClass", uid), getConfig("firstLessonTemplate", uid), getConfig("classFirstLessonTemplate", uid),
        getConfig("driveBasePath", uid), getConfig("classStoragePath", uid), getConfig("batchFilePrefix", uid), getConfig("batchStoragePath", uid),
        getConfig("batchConcurrency", uid), getConfig("maxTokens", uid), getConfig("gdriveLocalBasePath", uid), getConfig("gdriveDownloadsPath", uid),
        getConfig("modelPresets", uid), getConfig("apiProviderPresets", uid), getConfig("gradingStoragePath", uid),
      ]);

      // 解析供应商预设，遮蔽密钥
      let providerPresetsForClient: { name: string; maskedKey: string; apiUrl: string }[] = [];
      if (apiProviderPresets) {
        try {
          const parsed = JSON.parse(apiProviderPresets) as { name: string; apiKey: string; apiUrl: string }[];
          providerPresetsForClient = parsed.map(p => ({
            name: p.name,
            maskedKey: p.apiKey ? `****${p.apiKey.slice(-4)}` : "",
            apiUrl: p.apiUrl || "",
          }));
        } catch (e) {
          console.error("解析供应商预设失败:", e);
        }
      }

      return {
        apiModel: apiModel || DEFAULT_CONFIG.apiModel,
        // 安全考虑：不返回完整 API Key，只返回空字符串。用 hasApiKey 指示是否已配置
        apiKey: "",
        apiUrl: apiUrl || DEFAULT_CONFIG.apiUrl,
        currentYear: currentYear || DEFAULT_CONFIG.currentYear,
        roadmap: roadmap || "",
        roadmapClass: roadmapClass || "",
        firstLessonTemplate: firstLessonTemplate || "",
        classFirstLessonTemplate: classFirstLessonTemplate || "",
        driveBasePath: driveBasePath || "",
        classStoragePath: classStoragePath || "", // 小班课路径，留空则使用 driveBasePath
        batchFilePrefix: batchFilePrefix || "",
        batchStoragePath: batchStoragePath || "",
        batchConcurrency: batchConcurrency || DEFAULT_CONFIG.batchConcurrency,
        maxTokens: maxTokens || "64000",
        gdriveLocalBasePath: gdriveLocalBasePath || "",
        gdriveDownloadsPath: gdriveDownloadsPath || "",
        gradingStoragePath: gradingStoragePath || "",
        modelPresets: modelPresets || "",
        apiProviderPresets: providerPresetsForClient,
        // 返回是否使用默认值（apiKey 特殊处理：表示是否已配置）
        hasApiKey: !!apiKey,
        isDefault: {
          apiModel: !apiModel,
          apiKey: !apiKey, // deprecated，使用 hasApiKey
          apiUrl: !apiUrl,
          currentYear: !currentYear,
          driveBasePath: !driveBasePath,
          batchFilePrefix: !batchFilePrefix,
          batchStoragePath: !batchStoragePath,
        }
      };
    }),

    // 更新配置（所有登录用户均可修改自己的配置）
    update: protectedProcedure
      .input(z.object({
        apiModel: z.string().optional(),
        apiKey: z.string().optional(),
        apiUrl: z.string().optional(),
        currentYear: z.string().optional(),
        roadmap: z.string().optional(),
        roadmapClass: z.string().optional(),
        firstLessonTemplate: z.string().optional(),
        classFirstLessonTemplate: z.string().optional(),
        driveBasePath: z.string().optional(),
        classStoragePath: z.string().optional(),
        batchFilePrefix: z.string().optional(),
        batchStoragePath: z.string().optional(),
        batchConcurrency: z.string().optional(),
        maxTokens: z.string().optional(),
        gdriveLocalBasePath: z.string().optional(),
        gdriveDownloadsPath: z.string().optional(),
        gradingStoragePath: z.string().optional(),
        modelPresets: z.string().optional(),
        apiProviderPresets: z.string().optional(), // JSON 格式的供应商预设列表
        applyProviderKey: z.string().optional(), // 选中的供应商名称，应用其密钥
      }))
      .mutation(async ({ input, ctx }) => {
        const uid = ctx.user.id;
        const updates: string[] = [];

        if (input.apiModel !== undefined) {
          await setUserConfigValue(uid, "apiModel", input.apiModel.trim());
          updates.push("apiModel");
        }

        if (input.apiKey !== undefined && input.apiKey.trim()) {
          await setUserConfigValue(uid, "apiKey", input.apiKey.trim());
          updates.push("apiKey");
        }

        if (input.apiUrl !== undefined && input.apiUrl.trim()) {
          await setUserConfigValue(uid, "apiUrl", input.apiUrl.trim());
          updates.push("apiUrl");
        }

        if (input.currentYear !== undefined && input.currentYear.trim()) {
          await setUserConfigValue(uid, "currentYear", input.currentYear.trim());
          updates.push("currentYear");
        }

        if (input.roadmap !== undefined) {
          await setUserConfigValue(uid, "roadmap", input.roadmap);
          updates.push("roadmap");
        }

        if (input.roadmapClass !== undefined) {
          await setUserConfigValue(uid, "roadmapClass", input.roadmapClass);
          updates.push("roadmapClass");
        }

        if (input.firstLessonTemplate !== undefined) {
          await setUserConfigValue(uid, "firstLessonTemplate", input.firstLessonTemplate);
          updates.push("firstLessonTemplate");
        }

        if (input.classFirstLessonTemplate !== undefined) {
          await setUserConfigValue(uid, "classFirstLessonTemplate", input.classFirstLessonTemplate);
          updates.push("classFirstLessonTemplate");
        }

        if (input.driveBasePath !== undefined && input.driveBasePath.trim()) {
          // 验证路径格式：不能以/开头或结尾
          let path = input.driveBasePath.trim();
          if (path.startsWith('/')) {
            path = path.slice(1);
          }
          if (path.endsWith('/')) {
            path = path.slice(0, -1);
          }
          await setUserConfigValue(uid, "driveBasePath", path);
          updates.push("driveBasePath");
        }

        if (input.classStoragePath !== undefined) {
          // 小班课存储路径，可以为空（空则使用 driveBasePath）
          let path = input.classStoragePath.trim();
          if (path) {
            if (path.startsWith('/')) {
              path = path.slice(1);
            }
            if (path.endsWith('/')) {
              path = path.slice(0, -1);
            }
          }
          await setUserConfigValue(uid, "classStoragePath", path);
          updates.push("classStoragePath");
        }

        if (input.batchFilePrefix !== undefined) {
          await setUserConfigValue(uid, "batchFilePrefix", input.batchFilePrefix.trim() || DEFAULT_CONFIG.batchFilePrefix);
          updates.push("batchFilePrefix");
        }

        if (input.batchConcurrency !== undefined) {
          const val = parseInt(input.batchConcurrency.trim(), 10);
          if (!isNaN(val) && val >= 1 && val <= 200) {
            await setUserConfigValue(uid, "batchConcurrency", val.toString());
            updates.push("batchConcurrency");
          }
        }

        if (input.batchStoragePath !== undefined && input.batchStoragePath.trim()) {
          // 验证路径格式：不能以/开头或结尾
          let path = input.batchStoragePath.trim();
          if (path.startsWith('/')) {
            path = path.slice(1);
          }
          if (path.endsWith('/')) {
            path = path.slice(0, -1);
          }
          await setUserConfigValue(uid, "batchStoragePath", path);
          updates.push("batchStoragePath");
        }

        if (input.maxTokens !== undefined && input.maxTokens.trim()) {
          // 验证是否为有效数字
          const tokenValue = parseInt(input.maxTokens.trim(), 10);
          if (!isNaN(tokenValue) && tokenValue >= 1000 && tokenValue <= 200000) {
            await setUserConfigValue(uid, "maxTokens", tokenValue.toString());
            updates.push("maxTokens");
          }
        }

        if (input.gdriveLocalBasePath !== undefined) {
          // Google Drive 本地路径（绝对路径，允许以/开头）
          let localPath = input.gdriveLocalBasePath.trim();
          if (localPath.endsWith('/')) {
            localPath = localPath.slice(0, -1);
          }
          await setUserConfigValue(uid, "gdriveLocalBasePath", localPath);
          updates.push("gdriveLocalBasePath");
        }

        if (input.gdriveDownloadsPath !== undefined) {
          let dlPath = input.gdriveDownloadsPath.trim();
          if (dlPath.startsWith('/')) dlPath = dlPath.slice(1);
          if (dlPath.endsWith('/')) dlPath = dlPath.slice(0, -1);
          await setUserConfigValue(uid, "gdriveDownloadsPath", dlPath);
          updates.push("gdriveDownloadsPath");
        }

        if (input.gradingStoragePath !== undefined) {
          let gPath = input.gradingStoragePath.trim();
          if (gPath.startsWith('/')) gPath = gPath.slice(1);
          if (gPath.endsWith('/')) gPath = gPath.slice(0, -1);
          await setUserConfigValue(uid, "gradingStoragePath", gPath);
          updates.push("gradingStoragePath");
        }

        if (input.modelPresets !== undefined) {
          await setUserConfigValue(uid, "modelPresets", input.modelPresets);
          updates.push("modelPresets");
        }

        if (input.apiProviderPresets !== undefined) {
          // 合并密钥：如果新条目的 apiKey 为空，保留已有同名供应商的密钥
          try {
            const newPresets = JSON.parse(input.apiProviderPresets) as { name: string; apiKey: string; apiUrl: string }[];
            const existingRaw = await getConfig("apiProviderPresets", uid);
            let existingPresets: { name: string; apiKey: string; apiUrl: string }[] = [];
            if (existingRaw) {
              try { existingPresets = JSON.parse(existingRaw); } catch {}
            }
            const merged = newPresets.map(p => {
              if (!p.apiKey) {
                const existing = existingPresets.find(e => e.name === p.name);
                if (existing) {
                  return { ...p, apiKey: existing.apiKey };
                }
              }
              return p;
            }).filter(p => p.name.trim()); // 过滤掉没有名称的条目
            await setUserConfigValue(uid, "apiProviderPresets", JSON.stringify(merged));
          } catch (e) {
            // 如果解析失败，直接保存原始值
            await setUserConfigValue(uid, "apiProviderPresets", input.apiProviderPresets);
          }
          updates.push("apiProviderPresets");
        }

        // 应用选中供应商的密钥和地址
        // 注意：必须从数据库读取已合并的预设（不能用 input.apiProviderPresets，那是客户端发来的原始数据，密钥为空）
        if (input.applyProviderKey) {
          const presetsRaw = await getConfig("apiProviderPresets", uid);
          if (presetsRaw) {
            try {
              const presets = JSON.parse(presetsRaw) as { name: string; apiKey: string; apiUrl: string }[];
              const provider = presets.find(p => p.name === input.applyProviderKey);
              if (provider) {
                if (provider.apiKey) {
                  await setUserConfigValue(uid, "apiKey", provider.apiKey);
                  updates.push("apiKey(fromProvider)");
                }
                if (provider.apiUrl) {
                  await setUserConfigValue(uid, "apiUrl", provider.apiUrl);
                  updates.push("apiUrl(fromProvider)");
                }
              }
            } catch (e) {
              console.error("应用供应商密钥失败:", e);
            }
          }
        }

        return {
          success: true,
          updated: updates,
          message: updates.length > 0 
            ? `已更新: ${updates.join(", ")}` 
            : "没有需要更新的配置",
        };
      }),

    // 重置为默认值 —— 删除当前用户的 user_config 记录，回退到系统默认
    reset: protectedProcedure
      .input(z.object({
        keys: z.array(z.enum(["apiModel", "apiKey", "apiUrl", "currentYear", "roadmap", "driveBasePath"])),
      }))
      .mutation(async ({ input, ctx }) => {
        const uid = ctx.user.id;
        for (const key of input.keys) {
          try {
            await deleteUserConfigValue(uid, key);
          } catch (e) {
            console.error(`重置配置 ${key} 失败:`, e);
          }
        }

        return {
          success: true,
          reset: input.keys,
          message: `已重置: ${input.keys.join(", ")}`,
        };
      }),

    // 更新当前用户的个人配置（覆盖全局默认值）
    updateMyConfig: protectedProcedure
      .input(z.object({
        apiModel: z.string().optional(),
        apiKey: z.string().optional(),
        apiUrl: z.string().optional(),
        currentYear: z.string().optional(),
        roadmap: z.string().optional(),
        roadmapClass: z.string().optional(),
        firstLessonTemplate: z.string().optional(),
        classFirstLessonTemplate: z.string().optional(),
        driveBasePath: z.string().optional(),
        classStoragePath: z.string().optional(),
        batchFilePrefix: z.string().optional(),
        batchStoragePath: z.string().optional(),
        batchConcurrency: z.string().optional(),
        maxTokens: z.string().optional(),
        gdriveLocalBasePath: z.string().optional(),
        gdriveDownloadsPath: z.string().optional(),
        gradingStoragePath: z.string().optional(),
        modelPresets: z.string().optional(),
        apiProviderPresets: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const uid = ctx.user.id;
        const updates: string[] = [];

        for (const [key, value] of Object.entries(input)) {
          if (value === undefined) continue;
          let sanitized = value.trim();
          // 与 admin update 相同的验证规则
          if (key === "maxTokens") {
            const n = parseInt(sanitized, 10);
            if (isNaN(n) || n < 1000 || n > 200000) continue;
            sanitized = String(n);
          }
          if (key === "batchConcurrency") {
            const n = parseInt(sanitized, 10);
            if (isNaN(n) || n < 1 || n > 200) continue;
            sanitized = String(n);
          }
          await setUserConfigValue(uid, key, sanitized);
          updates.push(key);
        }

        return {
          success: true,
          updated: updates,
          message: updates.length > 0
            ? `已更新个人配置: ${updates.join(", ")}`
            : "没有需要更新的配置",
        };
      }),

    // 重置当前用户的个人配置（恢复使用全局默认值）
    resetMyConfig: protectedProcedure
      .input(z.object({
        keys: z.array(z.string()).max(30),
      }))
      .mutation(async ({ input, ctx }) => {
        const uid = ctx.user.id;
        for (const key of input.keys) {
          await deleteUserConfigValue(uid, key);
        }
        return {
          success: true,
          reset: input.keys,
          message: `已恢复默认: ${input.keys.join(", ")}`,
        };
      }),

    // ===== 一键备份/恢复 =====

    // 导出当前用户的所有配置（一键备份）
    exportBackup: protectedProcedure.query(async ({ ctx }) => {
      const uid = ctx.user.id;
      const db = await getDb();
      if (!db) throw new Error("数据库不可用");
      await ensureUserConfigTable();

      // 1. 读取用户级配置
      const userConfigs = await db.select({
        key: userConfig.key,
        value: userConfig.value,
      }).from(userConfig).where(eq(userConfig.userId, uid));

      const userConfigMap: Record<string, string> = {};
      for (const c of userConfigs) {
        userConfigMap[c.key] = c.value;
      }

      // 2. 仅导出用户自己的配置 + DEFAULT_CONFIG 填充缺失值（不再读取 systemConfig 防止跨租户泄露）
      const mergedConfig: Record<string, string> = { ...DEFAULT_CONFIG, ...userConfigMap };

      // 4. 安全处理：遮蔽 API Key（只保留后4位）
      if (mergedConfig.apiKey) {
        const key = mergedConfig.apiKey;
        mergedConfig.apiKey = key.length > 4 ? `****${key.slice(-4)}` : "****";
      }
      // apiProviderPresets 中的 key 也需要遮蔽
      if (mergedConfig.apiProviderPresets) {
        try {
          const presets = JSON.parse(mergedConfig.apiProviderPresets) as { name: string; apiKey: string; apiUrl: string }[];
          mergedConfig.apiProviderPresets = JSON.stringify(presets.map(p => ({
            ...p,
            apiKey: p.apiKey && p.apiKey.length > 4 ? `****${p.apiKey.slice(-4)}` : "****",
          })));
        } catch {}
      }

      return {
        version: 1,
        exportedAt: new Date().toISOString(),
        userId: uid,
        userName: ctx.user.name,
        userEmail: ctx.user.email,
        config: mergedConfig,
        // 单独标记哪些是用户级覆盖（恢复时只写 userConfig）
        userOverrideKeys: Object.keys(userConfigMap),
      };
    }),

    // 导入配置（一键恢复）
    importBackup: protectedProcedure
      .input(z.object({
        config: z.record(z.string(), z.string()),
        // 如果为 true，只恢复用户级配置；false 则全部写入用户级
        onlyUserOverrides: z.boolean().default(false),
        // 要恢复的 key 列表（如果不指定则恢复所有）
        keys: z.array(z.string()).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const uid = ctx.user.id;
        const db = await getDb();
        if (!db) throw new Error("数据库不可用");
        await ensureUserConfigTable();

        // 安全过滤：不允许恢复的 key
        const blockedKeys = new Set(["allowedEmails"]);
        // API Key 如果是被遮蔽的就跳过
        const isMasked = (value: string) => value.startsWith("****");

        const keysToRestore = input.keys || Object.keys(input.config);
        let restored = 0;
        let skipped = 0;
        const restoredKeys: string[] = [];

        for (const key of keysToRestore) {
          if (blockedKeys.has(key)) { skipped++; continue; }
          const value = input.config[key];
          if (value === undefined || value === null) { skipped++; continue; }
          // 跳过被遮蔽的敏感字段
          if (key === "apiKey" && isMasked(value)) { skipped++; continue; }
          if (key === "apiProviderPresets") {
            try {
              const presets = JSON.parse(value) as { apiKey?: string }[];
              const allMasked = presets.every(p => !p.apiKey || isMasked(p.apiKey));
              if (allMasked) { skipped++; continue; }
            } catch {}
          }

          await setUserConfigValue(uid, key, value);
          restored++;
          restoredKeys.push(key);
        }

        return {
          success: true,
          restored,
          skipped,
          restoredKeys,
          message: `已恢复 ${restored} 项配置，跳过 ${skipped} 项`,
        };
      }),

    // 获取学生/班级历史记录（用户私有数据，不 fallback 到 systemConfig）
    getStudentHistory: protectedProcedure.query(async ({ ctx }) => {
      const historyJson = await getUserOnlyConfigValue(ctx.user.id, "studentLessonHistory");
      if (!historyJson) {
        return {};
      }
      try {
        return JSON.parse(historyJson);
      } catch {
        return {};
      }
    }),

    // 保存学生/班级历史记录
    saveStudentHistory: protectedProcedure
      .input(z.object({
        history: z.record(z.string(), z.object({
          lesson: z.number(),
          lastUsed: z.number(),
          students: z.array(z.string()).optional(),
        })),
      }))
      .mutation(async ({ input, ctx }) => {
        await setUserConfigValue(ctx.user.id, "studentLessonHistory", JSON.stringify(input.history));
        return { success: true };
      }),

    // 清除学生/班级历史记录（用于修复跨账户数据污染）
    clearStudentHistory: protectedProcedure
      .mutation(async ({ ctx }) => {
        await deleteUserConfigValue(ctx.user.id, "studentLessonHistory");
        return { success: true };
      }),

    // 清除当前用户的所有配置（用于修复 migrateSystemConfigToAdmin 导致的跨账户数据污染）
    clearAllMyConfig: protectedProcedure
      .mutation(async ({ ctx }) => {
        const uid = ctx.user.id;
        const db = await getDb();
        if (!db) throw new Error("数据库不可用");
        await ensureUserConfigTable();
        const deleted = await db.delete(userConfig).where(eq(userConfig.userId, uid));
        return { success: true, message: `已清除用户 ${uid} 的所有配置` };
      }),
  }),

  // 学情反馈生成 - 拆分为5个独立端点
  feedback: router({
    // 预览各步骤的系统提示词
    previewPrompts: protectedProcedure
      .input(z.object({
        courseType: z.enum(["oneToOne", "class"]),
        roadmap: z.string().optional(),
      }))
      .query(({ input }) => {
        return previewFeedbackPrompts(input.courseType as 'oneToOne' | 'class', input.roadmap);
      }),

    // 步骤1: 生成学情反馈
    generateFeedback: protectedProcedure
      .input(feedbackInputSchema)
      .mutation(async ({ input, ctx }) => {
        // 获取配置（优先使用传入的快照，确保并发安全）
        const apiModel = input.apiModel || await getConfig("apiModel", ctx.user.id) || DEFAULT_CONFIG.apiModel;
        const apiKey = input.apiKey || await getConfig("apiKey", ctx.user.id) || DEFAULT_CONFIG.apiKey;
        const apiUrl = input.apiUrl || await getConfig("apiUrl", ctx.user.id) || DEFAULT_CONFIG.apiUrl;
        const currentYear = input.currentYear || await getConfig("currentYear", ctx.user.id) || DEFAULT_CONFIG.currentYear;
        const roadmap = input.roadmap !== undefined ? input.roadmap : (await getConfig("roadmap", ctx.user.id) || DEFAULT_CONFIG.roadmap);
        const driveBasePath = input.driveBasePath || await getConfig("driveBasePath", ctx.user.id) || DEFAULT_CONFIG.driveBasePath;
        
        // 创建独立的日志会话（并发安全，按用户隔离）
        const log = createLogSession(
          input.studentName,
          { apiUrl, apiModel, maxTokens: 64000 },
          {
            notesLength: input.currentNotes.length,
            transcriptLength: input.transcript.length,
            lastFeedbackLength: (input.lastFeedback || "").length,
          },
          input.lessonNumber,
          input.lessonDate,
          ctx.user.id
        );

        startStep(log, "学情反馈");
        
        try {
          // 组合年份和日期，并添加星期信息
          const lessonDate = input.lessonDate ? addWeekdayToDate(input.lessonDate.includes('年') ? input.lessonDate : `${currentYear}年${input.lessonDate}`) : "";
          
          const feedbackResult = await generateFeedbackContent('oneToOne', {
            studentName: input.studentName,
            lessonNumber: input.lessonNumber || "",
            lessonDate: lessonDate,
            nextLessonDate: "",
            lastFeedback: input.lastFeedback || "",
            currentNotes: input.currentNotes,
            transcript: input.transcript,
            isFirstLesson: input.isFirstLesson,
            specialRequirements: input.specialRequirements || "",
          }, { apiModel, apiKey, apiUrl, roadmap });
          const feedbackContent = feedbackResult.content;

          // 记录原始AI输出（清洗前），用于排查奇怪换行等问题
          if (feedbackResult.rawContent) {
            logInfo(log, "学情反馈", `原始AI输出（${feedbackResult.rawContent.length}字符，清洗后${feedbackContent.length}字符）`, feedbackResult.rawContent);
          }

          if (!feedbackContent || !feedbackContent.trim()) {
            throw new Error('学情反馈生成失败：AI 返回内容为空，请重试');
          }

          // 优先使用用户输入的日期，否则从反馈内容中提取
          let dateStr = input.lessonDate || "";
          if (!dateStr) {
            const dateMatch = feedbackContent.match(/(\d{1,2}月\d{1,2}日)/);
            dateStr = dateMatch ? dateMatch[1] : new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }).replace('/', '月') + '日';
          }

          // 上传到Google Drive
          const basePath = `${driveBasePath}/${input.studentName}`;
          const fileName = `${input.studentName}${input.lessonNumber || ''}.md`;
          const folderPath = `${basePath}/学情反馈`;
          
          logInfo(log, "学情反馈", `上传到Google Drive: ${folderPath}/${fileName}`);
          const uploadResult = await uploadToGoogleDrive(ctx.user.id, feedbackContent, fileName, folderPath);
          
          // 检查上传结果状态
          if (uploadResult.status === 'error') {
            throw new Error(`文件上传失败: ${uploadResult.error || '上传到Google Drive失败'}`);
          }
          
          stepSuccess(log, "学情反馈", feedbackContent.length);

          const resultPayload = {
            success: true,
            step: 1,
            stepName: "学情反馈",
            feedbackContent,
            uploadResult: {
              fileName,
              url: uploadResult.url || "",
              path: uploadResult.path || "",
              folderUrl: uploadResult.folderUrl || "",
            },
            dateStr,
            usedConfig: { apiModel, apiUrl },
          };

          // taskId 容错：存入 contentStore 供前端轮询
          if (input.taskId) {
            storeContent(input.taskId, JSON.stringify(resultPayload), undefined, ctx.user.id);
          }

          return resultPayload;
        } catch (error: any) {
          const structuredError = parseError(error, "feedback");
          stepFailed(log, "学情反馈", structuredError);
          endLogSession(log);
          
          throw new Error(JSON.stringify({
            code: structuredError.code,
            step: structuredError.step,
            message: structuredError.message,
            suggestion: structuredError.suggestion,
            userMessage: formatErrorMessage(structuredError),
          }));
        }
      }),

    // 步骤2: 生成复习文档
    generateReview: protectedProcedure
      .input(z.object({
        studentName: z.string(),
        lessonNumber: z.string().optional(),
        dateStr: z.string(),
        feedbackContent: z.string(),
        apiModel: z.string().optional(),
        apiKey: z.string().optional(),
        apiUrl: z.string().optional(),
        roadmap: z.string().optional(),
        driveBasePath: z.string().optional(),
        taskId: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const apiModel = input.apiModel || await getConfig("apiModel", ctx.user.id) || DEFAULT_CONFIG.apiModel;
        const apiKey = input.apiKey || await getConfig("apiKey", ctx.user.id) || DEFAULT_CONFIG.apiKey;
        const apiUrl = input.apiUrl || await getConfig("apiUrl", ctx.user.id) || DEFAULT_CONFIG.apiUrl;
        const roadmap = input.roadmap !== undefined ? input.roadmap : (await getConfig("roadmap", ctx.user.id) || DEFAULT_CONFIG.roadmap);
        const driveBasePath = input.driveBasePath || await getConfig("driveBasePath", ctx.user.id) || DEFAULT_CONFIG.driveBasePath;
        
        // 创建独立的日志会话（并发安全，按用户隔离）
        const log = createLogSession(
          input.studentName,
          { apiUrl, apiModel, maxTokens: 64000 },
          { notesLength: 0, transcriptLength: 0, lastFeedbackLength: input.feedbackContent.length },
          undefined,
          input.dateStr,
          ctx.user.id
        );

        startStep(log, "复习文档");
        
        try {
          const feedbackInput: FeedbackInput = {
            studentName: input.studentName,
            lessonNumber: input.lessonNumber || "",
            lessonDate: input.dateStr,
            nextLessonDate: "",
            lastFeedback: "",
            currentNotes: "",
            transcript: "",
            isFirstLesson: false,
            specialRequirements: "",
          };

          const { buffer: reviewDocx, textChars: reviewChars } = await generateReviewContent(
            'oneToOne',
            feedbackInput,
            input.feedbackContent,
            input.dateStr,
            { apiModel, apiKey, apiUrl, roadmap }
          );

          if (!reviewDocx || reviewDocx.length === 0) {
            throw new Error('复习文档生成失败：AI 返回内容为空，请重试');
          }

          const basePath = `${driveBasePath}/${input.studentName}`;
          const fileName = `${input.studentName}${input.lessonNumber || ''}复习文档.docx`;
          const folderPath = `${basePath}/复习文档`;

          logInfo(log, "复习文档", `上传到Google Drive: ${folderPath}/${fileName}`);
          const uploadResult = await uploadBinaryToGoogleDrive(ctx.user.id, reviewDocx, fileName, folderPath);

          // 检查上传结果状态
          if (uploadResult.status === 'error') {
            throw new Error(`文件上传失败: ${uploadResult.error || '上传到Google Drive失败'}`);
          }

          stepSuccess(log, "复习文档", reviewChars);
          endLogSession(log);

          const reviewResult = {
            success: true,
            step: 2,
            stepName: "复习文档",
            uploadResult: {
              fileName,
              url: uploadResult.url || "",
              path: uploadResult.path || "",
              folderUrl: uploadResult.folderUrl || "",
            },
          };

          // 存入 contentStore，供前端代理超时后轮询
          if (input.taskId) {
            storeContent(input.taskId, JSON.stringify(reviewResult.uploadResult), { type: 'review', chars: reviewChars }, ctx.user.id);
          }

          return reviewResult;
        } catch (error: any) {
          const structuredError = parseError(error, "review");
          stepFailed(log, "复习文档", structuredError);
          endLogSession(log);
          
          throw new Error(JSON.stringify({
            code: structuredError.code,
            step: structuredError.step,
            message: structuredError.message,
            suggestion: structuredError.suggestion,
            userMessage: formatErrorMessage(structuredError),
          }));
        }
      }),

    // 步骤3: 生成测试本
    generateTest: protectedProcedure
      .input(z.object({
        studentName: z.string(),
        lessonNumber: z.string().optional(),
        dateStr: z.string(),
        feedbackContent: z.string(),
        apiModel: z.string().optional(),
        apiKey: z.string().optional(),
        apiUrl: z.string().optional(),
        roadmap: z.string().optional(),
        driveBasePath: z.string().optional(),
        taskId: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const apiModel = input.apiModel || await getConfig("apiModel", ctx.user.id) || DEFAULT_CONFIG.apiModel;
        const apiKey = input.apiKey || await getConfig("apiKey", ctx.user.id) || DEFAULT_CONFIG.apiKey;
        const apiUrl = input.apiUrl || await getConfig("apiUrl", ctx.user.id) || DEFAULT_CONFIG.apiUrl;
        const roadmap = input.roadmap !== undefined ? input.roadmap : (await getConfig("roadmap", ctx.user.id) || DEFAULT_CONFIG.roadmap);
        const driveBasePath = input.driveBasePath || await getConfig("driveBasePath", ctx.user.id) || DEFAULT_CONFIG.driveBasePath;
        
        // 创建独立的日志会话（并发安全，按用户隔离）
        const log = createLogSession(
          input.studentName,
          { apiUrl, apiModel, maxTokens: 64000 },
          { notesLength: 0, transcriptLength: 0, lastFeedbackLength: input.feedbackContent.length },
          undefined,
          input.dateStr,
          ctx.user.id
        );

        startStep(log, "测试本");
        
        try {
          const feedbackInput: FeedbackInput = {
            studentName: input.studentName,
            lessonNumber: input.lessonNumber || "",
            lessonDate: input.dateStr,
            nextLessonDate: "",
            lastFeedback: "",
            currentNotes: "",
            transcript: "",
            isFirstLesson: false,
            specialRequirements: "",
          };

          const { buffer: testDocx, textChars: testChars } = await generateTestContent(
            'oneToOne',
            feedbackInput,
            input.feedbackContent,
            input.dateStr,
            { apiModel, apiKey, apiUrl, roadmap }
          );

          if (!testDocx || testDocx.length === 0) {
            throw new Error('测试本生成失败：AI 返回内容为空，请重试');
          }

          const basePath = `${driveBasePath}/${input.studentName}`;
          const fileName = `${input.studentName}${input.lessonNumber || ''}测试文档.docx`;
          const folderPath = `${basePath}/复习文档`;

          logInfo(log, "测试本", `上传到Google Drive: ${folderPath}/${fileName}`);
          const uploadResult = await uploadBinaryToGoogleDrive(ctx.user.id, testDocx, fileName, folderPath);

          // 检查上传结果状态
          if (uploadResult.status === 'error') {
            throw new Error(`文件上传失败: ${uploadResult.error || '上传到Google Drive失败'}`);
          }

          stepSuccess(log, "测试本", testChars);
          endLogSession(log);

          const testResult = {
            success: true,
            step: 3,
            stepName: "测试本",
            uploadResult: {
              fileName,
              url: uploadResult.url || "",
              path: uploadResult.path || "",
              folderUrl: uploadResult.folderUrl || "",
            },
          };

          if (input.taskId) {
            storeContent(input.taskId, JSON.stringify(testResult.uploadResult), { type: 'test', chars: testChars }, ctx.user.id);
          }

          return testResult;
        } catch (error: any) {
          const structuredError = parseError(error, "test");
          stepFailed(log, "测试本", structuredError);
          endLogSession(log);
          
          throw new Error(JSON.stringify({
            code: structuredError.code,
            step: structuredError.step,
            message: structuredError.message,
            suggestion: structuredError.suggestion,
            userMessage: formatErrorMessage(structuredError),
          }));
        }
      }),

    // 步骤4: 生成课后信息提取
    generateExtraction: protectedProcedure
      .input(z.object({
        studentName: z.string(),
        lessonNumber: z.string().optional(),
        dateStr: z.string(),
        feedbackContent: z.string(),
        apiModel: z.string().optional(),
        apiKey: z.string().optional(),
        apiUrl: z.string().optional(),
        roadmap: z.string().optional(),
        driveBasePath: z.string().optional(),
        taskId: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const apiModel = input.apiModel || await getConfig("apiModel", ctx.user.id) || DEFAULT_CONFIG.apiModel;
        const apiKey = input.apiKey || await getConfig("apiKey", ctx.user.id) || DEFAULT_CONFIG.apiKey;
        const apiUrl = input.apiUrl || await getConfig("apiUrl", ctx.user.id) || DEFAULT_CONFIG.apiUrl;
        const roadmap = input.roadmap !== undefined ? input.roadmap : (await getConfig("roadmap", ctx.user.id) || DEFAULT_CONFIG.roadmap);
        const driveBasePath = input.driveBasePath || await getConfig("driveBasePath", ctx.user.id) || DEFAULT_CONFIG.driveBasePath;
        
        // 创建独立的日志会话（并发安全，按用户隔离）
        const log = createLogSession(
          input.studentName,
          { apiUrl, apiModel, maxTokens: 64000 },
          { notesLength: 0, transcriptLength: 0, lastFeedbackLength: input.feedbackContent.length },
          undefined,
          input.dateStr,
          ctx.user.id
        );

        startStep(log, "课后信息提取");
        
        try {
          const feedbackInput: FeedbackInput = {
            studentName: input.studentName,
            lessonNumber: input.lessonNumber || "",
            lessonDate: input.dateStr,
            nextLessonDate: "",
            lastFeedback: "",
            currentNotes: "",
            transcript: "",
            isFirstLesson: false,
            specialRequirements: "",
          };

          const extractionContent = await generateExtractionContent(
            'oneToOne',
            feedbackInput,
            input.feedbackContent,
            { apiModel, apiKey, apiUrl, roadmap }
          );

          if (!extractionContent || !extractionContent.trim()) {
            throw new Error('课后信息提取生成失败：AI 返回内容为空，请重试');
          }

          const basePath = `${driveBasePath}/${input.studentName}`;
          const fileName = `${input.studentName}${input.lessonNumber || ''}课后信息提取.md`;
          const folderPath = `${basePath}/课后信息`;
          
          logInfo(log, "课后信息提取", `上传到Google Drive: ${folderPath}/${fileName}`);
          const uploadResult = await uploadToGoogleDrive(ctx.user.id, extractionContent, fileName, folderPath);
          
          // 检查上传结果状态
          if (uploadResult.status === 'error') {
            throw new Error(`文件上传失败: ${uploadResult.error || '上传到Google Drive失败'}`);
          }
          
          stepSuccess(log, "课后信息提取", extractionContent.length);
          endLogSession(log);

          const extractionResult = {
            success: true,
            step: 4,
            stepName: "课后信息提取",
            uploadResult: {
              fileName,
              url: uploadResult.url || "",
              path: uploadResult.path || "",
              folderUrl: uploadResult.folderUrl || "",
            },
          };

          if (input.taskId) {
            storeContent(input.taskId, JSON.stringify(extractionResult.uploadResult), { type: 'extraction', chars: extractionContent.length }, ctx.user.id);
          }

          return extractionResult;
        } catch (error: any) {
          const structuredError = parseError(error, "extraction");
          stepFailed(log, "课后信息提取", structuredError);
          endLogSession(log);
          
          throw new Error(JSON.stringify({
            code: structuredError.code,
            step: structuredError.step,
            message: structuredError.message,
            suggestion: structuredError.suggestion,
            userMessage: formatErrorMessage(structuredError),
          }));
        }
      }),

    // 步骤5: 生成气泡图SVG（返回SVG字符串，前端转换为PNG并上传）
    generateBubbleChart: protectedProcedure
      .input(z.object({
        studentName: z.string(),
        dateStr: z.string(),
        lessonNumber: z.string().optional(),
        feedbackContent: z.string(),
        apiModel: z.string().optional(),
        apiKey: z.string().optional(),
        apiUrl: z.string().optional(),
        roadmap: z.string().optional(),
        driveBasePath: z.string().optional(),
        taskId: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const apiModel = input.apiModel || await getConfig("apiModel", ctx.user.id) || DEFAULT_CONFIG.apiModel;
        const apiKey = input.apiKey || await getConfig("apiKey", ctx.user.id) || DEFAULT_CONFIG.apiKey;
        const apiUrl = input.apiUrl || await getConfig("apiUrl", ctx.user.id) || DEFAULT_CONFIG.apiUrl;
        const roadmap = input.roadmap !== undefined ? input.roadmap : (await getConfig("roadmap", ctx.user.id) || DEFAULT_CONFIG.roadmap);
        
        // 创建独立的日志会话（并发安全，按用户隔离）
        const log = createLogSession(
          input.studentName,
          { apiUrl, apiModel, maxTokens: 64000 },
          { notesLength: 0, transcriptLength: 0, lastFeedbackLength: input.feedbackContent.length },
          input.lessonNumber,
          input.dateStr,
          ctx.user.id
        );

        startStep(log, "气泡图");
        
        try {
          // 生成SVG字符串，返回给前端
          const svgContent = await generateBubbleChartSVG(
            'oneToOne',
            input.feedbackContent,
            input.studentName,
            input.dateStr,
            input.lessonNumber || "",
            { apiModel, apiKey, apiUrl, roadmap }
          );

          if (!svgContent || !svgContent.trim()) {
            throw new Error('气泡图生成失败：AI 返回内容为空，请重试');
          }

          stepSuccess(log, "气泡图", svgContent.length);
          endLogSession(log);

          // 存入 contentStore（气泡图存的是 SVG 内容）
          if (input.taskId) {
            storeContent(input.taskId, JSON.stringify({ svgContent }), { type: 'bubbleChart', chars: svgContent.length }, ctx.user.id);
          }

          // 返回SVG字符串，前端负责转换为PNG并上传
          return {
            success: true,
            step: 5,
            stepName: "气泡图",
            svgContent,
          };
        } catch (error: any) {
          const structuredError = parseError(error, "bubbleChart");
          stepFailed(log, "气泡图", structuredError);
          endLogSession(log);
          
          throw new Error(JSON.stringify({
            code: structuredError.code,
            step: structuredError.step,
            message: structuredError.message,
            suggestion: structuredError.suggestion,
            userMessage: formatErrorMessage(structuredError),
          }));
        }
      }),

    // 步骤5b: 上传气泡图PNG（前端转换后调用）
    uploadBubbleChart: protectedProcedure
      .input(z.object({
        studentName: z.string(),
        lessonNumber: z.string().optional(),
        dateStr: z.string(),
        pngBase64: z.string(), // base64编码的PNG数据
        driveBasePath: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const driveBasePath = input.driveBasePath || await getConfig("driveBasePath", ctx.user.id) || DEFAULT_CONFIG.driveBasePath;
        
        try {
          // 将base64转换为Buffer
          const pngBuffer = Buffer.from(input.pngBase64, 'base64');
          
          const basePath = `${driveBasePath}/${input.studentName}`;
          const fileName = `${input.studentName}${input.lessonNumber || ''}气泡图.png`;
          const folderPath = `${basePath}/气泡图`;
          
          console.log(`[气泡图上传] 上传到Google Drive: ${folderPath}/${fileName}`);
          const uploadResult = await uploadBinaryToGoogleDrive(ctx.user.id, pngBuffer, fileName, folderPath);
          
          // 检查上传结果状态
          if (uploadResult.status === 'error') {
            throw new Error(`文件上传失败: ${uploadResult.error || '上传到Google Drive失败'}`);
          }
          
          return {
            success: true,
            step: 5,
            stepName: "气泡图上传",
            uploadResult: {
              fileName,
              url: uploadResult.url || "",
              path: uploadResult.path || "",
              folderUrl: uploadResult.folderUrl || "",
            },
          };
        } catch (error: any) {
          const structuredError = parseError(error, "bubbleChartUpload");
          
          throw new Error(JSON.stringify({
            code: structuredError.code,
            step: structuredError.step,
            message: structuredError.message,
            suggestion: structuredError.suggestion,
            userMessage: formatErrorMessage(structuredError),
          }));
        }
      }),

    // 最终验证
    verifyAll: protectedProcedure
      .input(z.object({
        studentName: z.string(),
        lessonNumber: z.string().optional(),
        dateStr: z.string(),
        driveBasePath: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        console.log(`[${new Date().toLocaleTimeString()}] 最终验证: 检查所有文件...`);

        const driveBasePath = input.driveBasePath || await getConfig("driveBasePath", ctx.user.id) || DEFAULT_CONFIG.driveBasePath;
        const basePath = `${driveBasePath}/${input.studentName}`;
        const ln = input.lessonNumber || '';
        const filePaths = [
          `${basePath}/学情反馈/${input.studentName}${ln}.md`,
          `${basePath}/复习文档/${input.studentName}${ln}复习文档.docx`,
          `${basePath}/复习文档/${input.studentName}${ln}测试文档.docx`,
          `${basePath}/课后信息/${input.studentName}${ln}课后信息提取.md`,
          `${basePath}/气泡图/${input.studentName}${ln}气泡图.png`,
        ];
        
        const verification = await verifyAllFiles(ctx.user.id, filePaths);
        
        console.log(`[${new Date().toLocaleTimeString()}] 最终验证: ${verification.results.filter(r => r.exists).length}/5 文件验证通过`);
        
        return {
          success: verification.allExist,
          verifiedCount: verification.results.filter(r => r.exists).length,
          totalCount: 5,
          results: verification.results,
          driveFolder: basePath,
        };
      }),

    // 获取最新日志（按用户隔离）
    getLatestLog: protectedProcedure
      .query(async ({ ctx }) => {
        const logPath = getLatestLogPath(ctx.user.id);
        if (!logPath) {
          return { success: false, message: "没有找到日志文件" };
        }
        const content = getLogContent(logPath);
        return {
          success: true,
          path: logPath,
          content,
        };
      }),

    // 导出日志到Google Drive
    exportLog: protectedProcedure
      .input(z.object({
        studentName: z.string().optional(),
      }).optional())
      .mutation(async ({ input, ctx }) => {
        // 如果提供了学生名，根据学生名查找日志；否则获取最新的日志（按用户隔离）
        const logPath = input?.studentName
          ? getLatestLogPathByStudent(input.studentName, ctx.user.id)
          : getLatestLogPath(ctx.user.id);
        if (!logPath) {
          return { success: false, message: "没有找到日志文件，请先运行一次生成" };
        }
        
        const content = getLogContent(logPath);
        if (!content) {
          return { success: false, message: "无法读取日志文件" };
        }
        
        const fileName = logPath.split('/').pop() || 'log.txt';
        const folderPath = 'Mac/Documents/XDF/日志';
        const fullPath = `${folderPath}/${fileName}`;
        
        try {
          const uploadResult = await uploadToGoogleDrive(ctx.user.id, content, fileName, folderPath);
          
          // 检查上传结果状态
          if (uploadResult.status === 'error') {
            return {
              success: false,
              message: `导出失败: ${uploadResult.error || '上传失败'}`,
            };
          }
          
          return {
            success: true,
            message: "日志已导出到Google Drive",
            url: uploadResult.url || "",
            path: fullPath,
            fileName: fileName,
          };
        } catch (error: any) {
          return {
            success: false,
            message: `导出失败: ${error.message}`,
          };
        }
      }),

    // 列出日志文件（按用户隔离）
    listLogs: protectedProcedure
      .query(async ({ ctx }) => {
        const logs = listLogFiles(ctx.user.id);
        return {
          success: true,
          logs: logs.map((l: { name: string; path: string; mtime: Date }) => ({
            name: l.name,
            path: l.path,
            mtime: l.mtime.toISOString(),
          })),
        };
      }),

    // 系统自检
    systemCheck: protectedProcedure
      .mutation(async ({ ctx }) => {
        try {
          const results = await runSystemCheck(ctx.user.id);
          return {
            success: true,
            ...results,
          };
        } catch (error: any) {
          return {
            success: false,
            results: [],
            passed: 0,
            total: 8,
            allPassed: false,
            error: error.message,
          };
        }
      }),
    // Google Drive OAuth授权
    googleAuthStatus: protectedProcedure
      .query(async ({ ctx }) => {
        return await googleAuth.getStatus(ctx.user.id);
      }),
    googleAuthUrl: protectedProcedure
      .query(async ({ ctx }) => {
        return {
          url: googleAuth.getAuthUrl(ctx.user.id),
          redirectUri: googleAuth.getRedirectUri()
        };
      }),
    googleAuthCallback: protectedProcedure
      .input(z.object({ code: z.string() }))
      .mutation(async ({ input, ctx }) => {
        return await googleAuth.handleCallback(input.code, ctx.user.id);
      }),
    googleAuthDisconnect: protectedProcedure
      .mutation(async ({ ctx }) => {
        return await googleAuth.disconnect(ctx.user.id);
      }),
      
    // ========== 小班课生成接口 ==========
    
    // 小班课步骤1: 生成1份完整学情反馈
    generateClassFeedback: protectedProcedure
      .input(classFeedbackInputSchema)
      .mutation(async ({ input, ctx }) => {
        const apiModel = input.apiModel || await getConfig("apiModel", ctx.user.id) || DEFAULT_CONFIG.apiModel;
        const apiKey = input.apiKey || await getConfig("apiKey", ctx.user.id) || DEFAULT_CONFIG.apiKey;
        const apiUrl = input.apiUrl || await getConfig("apiUrl", ctx.user.id) || DEFAULT_CONFIG.apiUrl;
        const currentYear = input.currentYear || await getConfig("currentYear", ctx.user.id) || DEFAULT_CONFIG.currentYear;
        const roadmapClass = input.roadmapClass !== undefined ? input.roadmapClass : (await getConfig("roadmapClass", ctx.user.id) || "");
        
        // 创建小班课日志会话（用班号作为标识符，按用户隔离）
        const log = createLogSession(
          `${input.classNumber}班`,
          { apiUrl, apiModel, maxTokens: 64000 },
          {
            notesLength: input.currentNotes.length,
            transcriptLength: input.transcript.length,
            lastFeedbackLength: (input.lastFeedback || "").length,
          },
          input.lessonNumber,
          input.lessonDate,
          ctx.user.id
        );
        
        startStep(log, "小班课学情反馈");
        
        console.log(`[小班课] 开始为 ${input.classNumber} 班生成学情反馈...`);
        console.log(`[小班课] 路书长度: ${roadmapClass?.length || 0} 字符`);
        
        // 组合年份和日期，并添加星期信息（和一对一保持一致）
        const lessonDate = input.lessonDate ? addWeekdayToDate(input.lessonDate.includes('年') ? input.lessonDate : `${currentYear}年${input.lessonDate}`) : "";
        
        const classInput: ClassFeedbackInput = {
          classNumber: input.classNumber,
          lessonNumber: input.lessonNumber || '',
          lessonDate: lessonDate,
          nextLessonDate: '', // 小班课从笔记中提取
          attendanceStudents: input.attendanceStudents.filter(s => s.trim()),
          lastFeedback: input.lastFeedback || '',
          currentNotes: input.currentNotes,
          transcript: input.transcript,
          specialRequirements: input.specialRequirements || '',
        };
        
        try {
          // 生成1份完整的学情反馈（包含全班共用部分+每个学生的单独部分）
          const classResult = await generateClassFeedbackContent(
            classInput,
            roadmapClass,
            { apiModel, apiKey, apiUrl }
          );
          const feedback = classResult.content;

          stepSuccess(log, "小班课学情反馈", feedback.length);
          endLogSession(log);

          return {
            success: true,
            feedback, // 字符串，1份完整的学情反馈
          };
        } catch (error: any) {
          stepFailed(log, "小班课学情反馈", parseError(error));
          endLogSession(log);
          throw error;
        }
      }),
    
    // 小班课步骤2: 生成复习文档
    generateClassReview: protectedProcedure
      .input(z.object({
        classNumber: z.string(),
        lessonNumber: z.string().optional(),
        lessonDate: z.string().optional(),
        attendanceStudents: z.array(z.string()),
        currentNotes: z.string(),
        combinedFeedback: z.string(),
        apiModel: z.string().optional(),
        apiKey: z.string().optional(),
        apiUrl: z.string().optional(),
        roadmapClass: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        try {
          const apiModel = input.apiModel || await getConfig("apiModel", ctx.user.id) || DEFAULT_CONFIG.apiModel;
          const apiKey = input.apiKey || await getConfig("apiKey", ctx.user.id) || DEFAULT_CONFIG.apiKey;
          const apiUrl = input.apiUrl || await getConfig("apiUrl", ctx.user.id) || DEFAULT_CONFIG.apiUrl;
          const roadmapClass = input.roadmapClass || await getConfig("roadmapClass", ctx.user.id) || "";

          const classInput: ClassFeedbackInput = {
            classNumber: input.classNumber,
            lessonNumber: input.lessonNumber || '',
            lessonDate: input.lessonDate || '',
            nextLessonDate: '',
            attendanceStudents: input.attendanceStudents,
            lastFeedback: '',
            currentNotes: input.currentNotes,
            transcript: '',
            specialRequirements: '',
          };

          const reviewResult = await generateClassReviewContent(
            classInput,
            input.combinedFeedback,
            roadmapClass,
            { apiModel, apiKey, apiUrl }
          );

          return {
            success: true,
            content: reviewResult.buffer.toString('base64'),
          };
        } catch (error) {
          console.error('[generateClassReview] 生成复习文档失败:', error);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: error instanceof Error ? error.message : '生成复习文档失败',
          });
        }
      }),

    // 小班课步骤3: 生成测试本
    generateClassTest: protectedProcedure
      .input(z.object({
        classNumber: z.string(),
        lessonNumber: z.string().optional(),
        lessonDate: z.string().optional(),
        attendanceStudents: z.array(z.string()),
        currentNotes: z.string(),
        combinedFeedback: z.string(),
        apiModel: z.string().optional(),
        apiKey: z.string().optional(),
        apiUrl: z.string().optional(),
        roadmapClass: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        try {
          const apiModel = input.apiModel || await getConfig("apiModel", ctx.user.id) || DEFAULT_CONFIG.apiModel;
          const apiKey = input.apiKey || await getConfig("apiKey", ctx.user.id) || DEFAULT_CONFIG.apiKey;
          const apiUrl = input.apiUrl || await getConfig("apiUrl", ctx.user.id) || DEFAULT_CONFIG.apiUrl;
          const roadmapClass = input.roadmapClass || await getConfig("roadmapClass", ctx.user.id) || "";

          const classInput: ClassFeedbackInput = {
            classNumber: input.classNumber,
            lessonNumber: input.lessonNumber || '',
            lessonDate: input.lessonDate || '',
            nextLessonDate: '',
            attendanceStudents: input.attendanceStudents,
            lastFeedback: '',
            currentNotes: input.currentNotes,
            transcript: '',
            specialRequirements: '',
          };

          const testResult = await generateClassTestContent(
            classInput,
            input.combinedFeedback,
            roadmapClass,
            { apiModel, apiKey, apiUrl }
          );

          return {
            success: true,
            content: testResult.buffer.toString('base64'),
          };
        } catch (error) {
          console.error('[generateClassTest] 生成测试本失败:', error);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: error instanceof Error ? error.message : '生成测试本失败',
          });
        }
      }),

    // 小班课步骤4: 生成课后信息提取
    generateClassExtraction: protectedProcedure
      .input(z.object({
        classNumber: z.string(),
        lessonNumber: z.string().optional(),
        lessonDate: z.string().optional(),
        attendanceStudents: z.array(z.string()),
        combinedFeedback: z.string(),
        apiModel: z.string().optional(),
        apiKey: z.string().optional(),
        apiUrl: z.string().optional(),
        roadmapClass: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        try {
          const apiModel = input.apiModel || await getConfig("apiModel", ctx.user.id) || DEFAULT_CONFIG.apiModel;
          const apiKey = input.apiKey || await getConfig("apiKey", ctx.user.id) || DEFAULT_CONFIG.apiKey;
          const apiUrl = input.apiUrl || await getConfig("apiUrl", ctx.user.id) || DEFAULT_CONFIG.apiUrl;
          const roadmapClass = input.roadmapClass || await getConfig("roadmapClass", ctx.user.id) || "";

          const classInput: ClassFeedbackInput = {
            classNumber: input.classNumber,
            lessonNumber: input.lessonNumber || '',
            lessonDate: input.lessonDate || '',
            nextLessonDate: '',
            attendanceStudents: input.attendanceStudents,
            lastFeedback: '',
            currentNotes: '',
            transcript: '',
            specialRequirements: '',
          };

          const extraction = await generateClassExtractionContent(
            classInput,
            input.combinedFeedback,
            roadmapClass,
            { apiModel, apiKey, apiUrl }
          );

          return {
            success: true,
            content: extraction,
          };
        } catch (error) {
          console.error('[generateClassExtraction] 生成课后信息提取失败:', error);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: error instanceof Error ? error.message : '生成课后信息提取失败',
          });
        }
      }),

    // 小班课步骤5: 为单个学生生成气泡图SVG
    generateClassBubbleChart: protectedProcedure
      .input(z.object({
        studentName: z.string(),
        studentFeedback: z.string(),
        classNumber: z.string(),
        dateStr: z.string(),
        lessonNumber: z.string().optional(),
        apiModel: z.string().optional(),
        apiKey: z.string().optional(),
        apiUrl: z.string().optional(),
        roadmapClass: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        try {
          const apiModel = input.apiModel || await getConfig("apiModel", ctx.user.id) || DEFAULT_CONFIG.apiModel;
          const apiKey = input.apiKey || await getConfig("apiKey", ctx.user.id) || DEFAULT_CONFIG.apiKey;
          const apiUrl = input.apiUrl || await getConfig("apiUrl", ctx.user.id) || DEFAULT_CONFIG.apiUrl;
          const roadmapClass = input.roadmapClass || await getConfig("roadmapClass", ctx.user.id) || "";

          const svgContent = await generateClassBubbleChartSVG(
            input.studentFeedback,
            input.studentName,
            input.classNumber,
            input.dateStr,
            input.lessonNumber || '',
            { apiModel, apiKey, apiUrl, roadmapClass }
          );

          return {
            success: true,
            svg: svgContent,
          };
        } catch (error) {
          console.error('[generateClassBubbleChart] 生成气泡图失败:', error);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: error instanceof Error ? error.message : '生成气泡图失败',
          });
        }
      }),
    
    // 小班课上传文件到 Google Drive
    uploadClassFile: protectedProcedure
      .input(z.object({
        classNumber: z.string(),
        lessonNumber: z.string().optional(),
        dateStr: z.string(),
        fileType: z.enum(['feedback', 'review', 'test', 'extraction', 'bubbleChart']),
        studentName: z.string().optional(), // 反馈和气泡图需要
        content: z.string(), // base64 或文本
        driveBasePath: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // 小班课优先使用 classStoragePath，如果没有则使用 driveBasePath
        const classStoragePath = await getConfig("classStoragePath", ctx.user.id);
        const driveBasePath = input.driveBasePath || await getConfig("driveBasePath", ctx.user.id) || DEFAULT_CONFIG.driveBasePath;
        const effectivePath = classStoragePath || driveBasePath;
        // 路径格式：{basePath}/{classNumber}班/
        const basePath = `${effectivePath}/${input.classNumber}班`;
        
        let fileName: string;
        let filePath: string;
        let contentBuffer: Buffer | string;
        
        switch (input.fileType) {
          case 'feedback':
            // 1份完整的学情反馈，文件名用班号
            fileName = `${input.classNumber}班${input.lessonNumber || ''}.md`;
            filePath = `${basePath}/学情反馈/${fileName}`;
            contentBuffer = input.content;
            break;
          case 'review':
            fileName = `${input.classNumber}班${input.lessonNumber || ''}复习文档.docx`;
            filePath = `${basePath}/复习文档/${fileName}`;
            contentBuffer = Buffer.from(input.content, 'base64');
            break;
          case 'test':
            fileName = `${input.classNumber}班${input.lessonNumber || ''}测试文档.docx`;
            filePath = `${basePath}/复习文档/${fileName}`;
            contentBuffer = Buffer.from(input.content, 'base64');
            break;
          case 'extraction':
            fileName = `${input.classNumber}班${input.lessonNumber || ''}课后信息提取.md`;
            filePath = `${basePath}/课后信息/${fileName}`;
            contentBuffer = input.content;
            break;
          case 'bubbleChart':
            fileName = `${input.studentName}${input.lessonNumber || ''}气泡图.png`;
            filePath = `${basePath}/气泡图/${fileName}`;
            contentBuffer = Buffer.from(input.content, 'base64');
            break;
          default:
            throw new Error(`未知文件类型: ${input.fileType}`);
        }
        
        // 解析文件路径，分离文件名和文件夹路径
        const lastSlash = filePath.lastIndexOf('/');
        const folderPath = filePath.substring(0, lastSlash);
        
        let result;
        if (typeof contentBuffer === 'string') {
          result = await uploadToGoogleDrive(ctx.user.id, contentBuffer, fileName, folderPath);
        } else {
          result = await uploadBinaryToGoogleDrive(ctx.user.id, contentBuffer, fileName, folderPath);
        }
        
        if (result.status === 'error') {
          throw new Error(`文件上传失败: ${result.error || '上传到Google Drive失败'}`);
        }
        
        return {
          success: true,
          fileName,
          url: result.url || '',
          path: filePath,
        };
      }),
  }),

  // 从 Google Drive 网盘读取文件
  localFile: router({
    // 诊断端点：测试 Google Drive OAuth 连接和文件搜索
    diagnose: protectedProcedure
      .input(z.object({
        testFileName: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const diagnostics: string[] = [];
        const { getValidToken } = await import('./googleAuth');

        // 1. 检查 OAuth token
        const token = await getValidToken(ctx.user.id);
        if (!token) {
          diagnostics.push('❌ OAuth token 不可用 - 请在设置中授权 Google Drive');
          return { diagnostics, success: false };
        }
        diagnostics.push('✅ OAuth token 有效');

        // 2. 测试 API 连接 - 列出根目录
        try {
          const res = await fetch(`https://www.googleapis.com/drive/v3/files?q='root' in parents and trashed=false&fields=files(id,name,mimeType)&pageSize=10`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) {
            const errText = await res.text();
            diagnostics.push(`❌ Drive API 返回 ${res.status}: ${errText}`);
            return { diagnostics, success: false };
          }
          const data = await res.json();
          const folderNames = (data.files || []).map((f: any) => f.name);
          diagnostics.push(`✅ Drive API 正常 - 根目录文件夹: ${folderNames.join(', ')}`);
        } catch (err: any) {
          diagnostics.push(`❌ Drive API 请求失败: ${err.message}`);
          return { diagnostics, success: false };
        }

        // 3. 测试 driveBasePath 导航
        const driveBasePath = await getConfig("driveBasePath", ctx.user.id) || "Mac/Documents/XDF/学生档案";
        diagnostics.push(`配置路径: ${driveBasePath}`);

        const parts = driveBasePath.split('/').filter((p: string) => p);
        let parentId = 'root';
        let navOk = true;
        for (const folderName of parts) {
          const q = `name='${folderName.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
          const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=5`;
          const res = await fetch(searchUrl, { headers: { Authorization: `Bearer ${token}` } });
          const data = await res.json();
          if (data.files && data.files.length > 0) {
            parentId = data.files[0].id;
            diagnostics.push(`  ✅ 文件夹 "${folderName}" 找到 (id=${parentId})`);
          } else {
            diagnostics.push(`  ❌ 文件夹 "${folderName}" 不存在 (parent=${parentId})`);
            // 列出该层级的所有文件夹以帮助诊断
            const listQ = `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
            const listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(listQ)}&fields=files(id,name)&pageSize=20`;
            const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
            const listData = await listRes.json();
            const available = (listData.files || []).map((f: any) => f.name);
            diagnostics.push(`  📁 该层级可用文件夹: ${available.length > 0 ? available.join(', ') : '(空)'}`);
            navOk = false;
            break;
          }
        }

        // 4. 如果提供了测试文件名，尝试全局搜索
        if (input.testFileName) {
          const q = `name='${input.testFileName.replace(/'/g, "\\'")}' and trashed=false`;
          const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,parents)&pageSize=5`;
          const res = await fetch(searchUrl, { headers: { Authorization: `Bearer ${token}` } });
          const data = await res.json();
          if (data.files && data.files.length > 0) {
            diagnostics.push(`✅ 全局搜索 "${input.testFileName}" 找到 ${data.files.length} 个结果: ${data.files.map((f: any) => f.name).join(', ')}`);
          } else {
            diagnostics.push(`❌ 全局搜索 "${input.testFileName}" 无结果`);
          }
        }

        return { diagnostics, success: navOk };
      }),

    // 从 Google Drive 的 Downloads 文件夹读取录音转文字
    readFromDownloads: protectedProcedure
      .input(z.object({
        fileName: z.string().min(1, "请提供文件名"),
        allowSplit: z.boolean().optional(), // 允许分段文件检索（-1, -2）
        segmentCount: z.number().int().min(1).max(10).optional(), // 明确指定段数（1=单文件, 2=-1+-2, 3=-1+-2+-3...）
      }))
      .mutation(async ({ input, ctx }) => {
        const { fileName, allowSplit, segmentCount } = input;

        const ext = path.extname(fileName).toLowerCase();
        if (!['.docx', '.txt', '.md'].includes(ext)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: '只支持 .docx、.txt、.md 文件',
          });
        }

        // 策略：先在 Downloads 目录精确读取，找不到再搜索
        const gdriveDownloadsPath = await getConfig("gdriveDownloadsPath", ctx.user.id);

        // 辅助函数：尝试读取单个文件（精确路径 → 搜索）
        async function tryReadFile(name: string): Promise<{ buffer: Buffer; resolvedName: string } | null> {
          let buffer: Buffer | null = null;
          let resolvedName = name;

          if (gdriveDownloadsPath) {
            try {
              buffer = await readFileFromGoogleDrive(ctx.user.id, `${gdriveDownloadsPath}/${name}`);
              console.log(`[readFromDownloads] 精确路径找到: ${gdriveDownloadsPath}/${name}`);
            } catch {
              // 继续搜索
            }
          }

          if (!buffer) {
            const result = await searchFileInGoogleDrive(ctx.user.id, [name], gdriveDownloadsPath || undefined);
            if (result) {
              buffer = result.buffer;
              resolvedName = result.fullPath.split('/').pop() || name;
              console.log(`[readFromDownloads] 搜索找到: ${result.fullPath}`);
            }
          }

          return buffer ? { buffer, resolvedName } : null;
        }

        // 辅助函数：解析文件内容
        async function parseFileContent(buffer: Buffer, name: string): Promise<string> {
          const fileExt = path.extname(name).toLowerCase();
          if (fileExt === '.docx') {
            const { parseDocxToText } = await import('./utils/documentParser');
            return await parseDocxToText(buffer);
          }
          return buffer.toString('utf-8');
        }

        const baseName = path.basename(fileName, ext); // 如 "孙浩然0206"

        // === 模式A：用户明确指定了段数（segmentCount） ===
        if (segmentCount !== undefined) {
          if (segmentCount === 1) {
            // 单文件模式：只找完整文件
            const mainResult = await tryReadFile(fileName);
            if (mainResult) {
              const content = await parseFileContent(mainResult.buffer, mainResult.resolvedName);
              if (!content.trim()) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '文件内容为空' });
              }
              return { content: content.trim(), fileName: mainResult.resolvedName, segments: { count: 1, chars: [content.trim().length] } };
            }
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: `未找到文件: ${fileName}\n已尝试: ${gdriveDownloadsPath ? `指定目录(${gdriveDownloadsPath})` : '(未配置Downloads路径)'} + 全局搜索`,
            });
          }

          // 多段模式：找 -1, -2, ... -N，必须全部找到
          const parts: string[] = [];
          const found: string[] = [];
          const missing: string[] = [];
          for (let i = 1; i <= segmentCount; i++) {
            const partName = `${baseName}-${i}${ext}`;
            const partResult = await tryReadFile(partName);
            if (partResult) {
              const content = await parseFileContent(partResult.buffer, partResult.resolvedName);
              parts.push(content.trim());
              found.push(partName);
              console.log(`[readFromDownloads] 多段模式：找到第${i}段 ${partName}`);
            } else {
              missing.push(partName);
            }
          }

          if (missing.length > 0) {
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: `指定了${segmentCount}段，但有${missing.length}段未找到:\n${missing.map(m => `  ✗ ${m}`).join('\n')}${found.length > 0 ? `\n已找到:\n${found.map(f => `  ✓ ${f}`).join('\n')}` : ''}\n请检查文件是否已上传到 Google Drive`,
            });
          }

          const merged = parts.join('\n\n').trim();
          if (!merged) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '所有分段文件内容均为空' });
          }
          const segLabel = Array.from({ length: segmentCount }, (_, i) => i + 1).join('+');
          return {
            content: merged,
            fileName: `${baseName}-${segLabel}${ext}`,
            segments: { count: segmentCount, chars: parts.map(p => p.length) },
          };
        }

        // === 模式B：默认模式（checkbox关闭，保持原有逻辑） ===
        // 第一优先级：完整文件（如 孙浩然0206.docx）
        const mainResult = await tryReadFile(fileName);

        if (mainResult) {
          const content = await parseFileContent(mainResult.buffer, mainResult.resolvedName);
          if (!content.trim()) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '文件内容为空' });
          }
          return { content: content.trim(), fileName: mainResult.resolvedName, segments: { count: 1, chars: [content.trim().length] } };
        }

        // 第二优先级：分段文件（如 孙浩然0206-1.docx + 孙浩然0206-2.docx）
        if (allowSplit) {
          const part1Name = `${baseName}-1${ext}`;
          const part1Result = await tryReadFile(part1Name);

          if (part1Result) {
            console.log(`[readFromDownloads] 分段模式：找到第1段 ${part1Name}`);
            const part1Content = await parseFileContent(part1Result.buffer, part1Result.resolvedName);

            const part2Name = `${baseName}-2${ext}`;
            const part2Result = await tryReadFile(part2Name);

            if (part2Result) {
              console.log(`[readFromDownloads] 分段模式：找到第2段 ${part2Name}，合并两段`);
              const part2Content = await parseFileContent(part2Result.buffer, part2Result.resolvedName);
              const merged = (part1Content.trim() + '\n\n' + part2Content.trim()).trim();
              if (!merged) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: '分段文件内容均为空' });
              }
              return {
                content: merged,
                fileName: `${baseName}-1+2${ext}`,
                segments: { count: 2, chars: [part1Content.trim().length, part2Content.trim().length] },
              };
            } else {
              throw new TRPCError({
                code: 'NOT_FOUND',
                message: `找到了第1段 ${part1Name}，但未找到第2段 ${part2Name}\n请检查是否已下载完整的录音转文字文件`,
              });
            }
          }
        }

        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `在 Google Drive 未找到文件: ${fileName}${allowSplit ? `\n也未找到分段文件: ${baseName}-1${ext}` : ''}\n已尝试: ${gdriveDownloadsPath ? `指定目录(${gdriveDownloadsPath})` : '(未配置Downloads路径)'} + 全局搜索`,
        });
      }),

    // 从 Google Drive 读取上次学情反馈
    readLastFeedback: protectedProcedure
      .input(z.object({
        studentName: z.string().default(""),
        lessonNumber: z.string().min(1),
        courseType: z.enum(['oneToOne', 'class']).default('oneToOne'),
        classNumber: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { studentName, lessonNumber, courseType, classNumber } = input;

        // 一对一模式必须有学生姓名
        if (courseType === 'oneToOne' && !studentName.trim()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '请输入学生姓名' });
        }
        // 小班课模式必须有班号
        if (courseType === 'class' && !classNumber?.trim()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '请输入班号' });
        }

        const currentLesson = parseInt(lessonNumber.replace(/[^0-9]/g, ''), 10);
        if (isNaN(currentLesson) || currentLesson <= 1) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: '首次课没有上次反馈可加载',
          });
        }
        const prevLesson = currentLesson - 1;

        // 小班课优先使用 classStoragePath，一对一使用 driveBasePath
        let driveBasePath: string;
        if (courseType === 'class') {
          const classStoragePath = await getConfig("classStoragePath", ctx.user.id);
          driveBasePath = classStoragePath || await getConfig("driveBasePath", ctx.user.id) || "Mac/Documents/XDF/学生档案";
        } else {
          driveBasePath = await getConfig("driveBasePath", ctx.user.id) || "Mac/Documents/XDF/学生档案";
        }

        // 构建文件名候选列表和搜索目录
        let folderName: string;
        const candidateFileNames: string[] = [];
        if (courseType === 'class' && classNumber) {
          folderName = `${classNumber}班`;
          const prefixes = [
            `${classNumber}班${prevLesson}`,
            `${classNumber}班 ${prevLesson}`,
          ];
          for (const prefix of prefixes) {
            candidateFileNames.push(`${prefix}.md`, `${prefix}.docx`, `${prefix}.txt`);
          }
        } else {
          folderName = studentName;
          const prefixes = [
            `${studentName}${prevLesson}`,
            `${studentName} ${prevLesson}`,
          ];
          for (const prefix of prefixes) {
            candidateFileNames.push(`${prefix}.md`, `${prefix}.docx`, `${prefix}.txt`);
          }
        }

        const feedbackFolder = `${driveBasePath}/${folderName}/学情反馈`;

        // 收集诊断信息
        const diag: string[] = [];
        let foundBuffer: Buffer | null = null;
        let foundFileName: string | null = null;

        // 阶段1：精确路径尝试（优先，速度快）
        let firstError: string | null = null;
        for (const candidateName of candidateFileNames) {
          const candidatePath = `${feedbackFolder}/${candidateName}`;
          try {
            const buf = await readFileFromGoogleDrive(ctx.user.id, candidatePath);
            if (buf.length > 0) {
              foundBuffer = buf;
              foundFileName = candidateName;
              console.log(`[readLastFeedback] 精确路径找到: ${candidatePath}`);
              break;
            }
          } catch (err: any) {
            if (!firstError) firstError = err.message || String(err);
          }
        }
        if (!foundBuffer) {
          diag.push(`精确路径: 全部未命中 (首条错误: ${firstError || 'unknown'})`);
        }

        // 不做全局搜索兜底，避免搜到 Downloads 文件夹里的同名笔记文件
        if (!foundBuffer || !foundFileName) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `未找到第${prevLesson}次课反馈\n路径: ${feedbackFolder}\n候选: ${candidateFileNames.slice(0, 3).join(', ')}...\n诊断: ${diag.join(' | ')}\n\n请确认文件存在于学情反馈文件夹中`,
          });
        }

        const foundExt = path.extname(foundFileName).toLowerCase();
        let content: string;
        if (foundExt === '.docx') {
          const { parseDocxToText } = await import('./utils/documentParser');
          content = await parseDocxToText(foundBuffer);
        } else {
          content = foundBuffer.toString('utf-8');
        }

        if (!content.trim()) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: '文件内容为空',
          });
        }

        return {
          content: content.trim(),
          fileName: foundFileName,
          prevLesson,
        };
      }),
  }),

  // 后台任务管理
  bgTask: router({
    // 提交后台任务
    submit: protectedProcedure
      .input(z.object({
        courseType: z.enum(["one-to-one", "class"]),
        // 共用字段
        lessonNumber: z.string().optional(),
        lessonDate: z.string().optional(),
        currentYear: z.string().optional(),
        lastFeedback: z.string().optional(),
        currentNotes: z.string().min(1),
        transcript: z.string().min(1),
        specialRequirements: z.string().optional(),
        // 一对一字段
        studentName: z.string().optional(),
        isFirstLesson: z.boolean().optional(),
        // 小班课字段
        classNumber: z.string().optional(),
        attendanceStudents: z.array(z.string()).optional(),
        // 素材元信息（用于前端查看发送素材摘要）
        transcriptSegments: z.object({
          count: z.number(),
          chars: z.array(z.number()),
        }).optional(),
        // 配置快照
        apiModel: z.string().optional(),
        apiKey: z.string().optional(),
        apiUrl: z.string().optional(),
        roadmap: z.string().optional(),
        roadmapClass: z.string().optional(),
        driveBasePath: z.string().optional(),
        classStoragePath: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { startBackgroundTask, cleanupOldTasks } = await import("./backgroundTaskRunner");
        const { backgroundTasks: bgTasksTable } = await import("../drizzle/schema");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });

        // 先清理旧任务
        await cleanupOldTasks();

        // 生成任务 ID 和显示名
        const taskId = crypto.randomUUID();
        let displayName: string;
        if (input.courseType === "one-to-one") {
          if (!input.studentName) throw new TRPCError({ code: "BAD_REQUEST", message: "请输入学生姓名" });
          displayName = `${input.studentName} 第${input.lessonNumber || "?"}次`;
        } else {
          if (!input.classNumber) throw new TRPCError({ code: "BAD_REQUEST", message: "请输入班号" });
          displayName = `${input.classNumber}班 第${input.lessonNumber || "?"}次`;
        }

        // 构建参数
        const taskParams = { ...input };

        // 插入任务记录
        await db.insert(bgTasksTable).values({
          id: taskId,
          userId: ctx.user.id,
          courseType: input.courseType,
          displayName,
          status: "pending",
          currentStep: 0,
          totalSteps: 5,
          inputParams: JSON.stringify(taskParams),
        });

        // 启动后台处理（不等待）
        startBackgroundTask(taskId);

        return { taskId, displayName };
      }),

    // 查询单个任务状态
    status: protectedProcedure
      .input(z.object({ taskId: z.string() }))
      .query(async ({ input, ctx }) => {
        const { backgroundTasks: bgTasksTable } = await import("../drizzle/schema");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });

        const tasks = await db.select().from(bgTasksTable).where(and(eq(bgTasksTable.id, input.taskId), eq(bgTasksTable.userId, ctx.user.id))).limit(1);
        if (tasks.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });

        const task = tasks[0];
        return {
          id: task.id,
          courseType: task.courseType,
          displayName: task.displayName,
          status: task.status,
          currentStep: task.currentStep,
          totalSteps: task.totalSteps,
          stepResults: (() => { try { return task.stepResults ? JSON.parse(task.stepResults) : null; } catch { return null; } })(),
          errorMessage: task.errorMessage,
          createdAt: task.createdAt.toISOString(),
          completedAt: task.completedAt?.toISOString() || null,
        };
      }),

    // 查询最近3天的任务历史
    history: protectedProcedure.query(async ({ ctx }) => {
      const { backgroundTasks: bgTasksTable } = await import("../drizzle/schema");
      const db = await getDb();
      if (!db) return [];

      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const tasks = await db.select({
        id: bgTasksTable.id,
        courseType: bgTasksTable.courseType,
        displayName: bgTasksTable.displayName,
        status: bgTasksTable.status,
        currentStep: bgTasksTable.currentStep,
        totalSteps: bgTasksTable.totalSteps,
        stepResults: bgTasksTable.stepResults,
        errorMessage: bgTasksTable.errorMessage,
        createdAt: bgTasksTable.createdAt,
        completedAt: bgTasksTable.completedAt,
        inputParams: bgTasksTable.inputParams,
      })
        .from(bgTasksTable)
        .where(and(eq(bgTasksTable.userId, ctx.user.id), gte(bgTasksTable.createdAt, threeDaysAgo)))
        .orderBy(desc(bgTasksTable.createdAt));

      return tasks.map((t) => {
          // 从历史列表中剥离 feedback.content（太大，按需加载）
          let stepResults = null;
          try {
            stepResults = t.stepResults ? JSON.parse(t.stepResults) : null;
          } catch {
            console.error(`[bgTask.history] 任务 ${t.id} stepResults JSON损坏`);
          }
          if (stepResults?.feedback?.content) {
            delete stepResults.feedback.content;
          }
          // 从 inputParams 中提取使用的模型名称和素材摘要
          let model: string | null = null;
          let materialsSummary: { transcriptChars: number; notesChars: number; lastFeedbackChars: number; transcriptSegments?: { count: number; chars: number[] } } | null = null;
          let classNumber: string | null = null;
          let attendanceStudents: string[] | null = null;
          try {
            const params = t.inputParams ? JSON.parse(t.inputParams) : null;
            if (params) {
              model = params.apiModel || null;
              materialsSummary = {
                transcriptChars: params.transcript?.length || 0,
                notesChars: params.currentNotes?.length || 0,
                lastFeedbackChars: params.lastFeedback?.length || 0,
                transcriptSegments: params.transcriptSegments || undefined,
              };
              // 小班课参数（用于历史任务的学生管理导入）
              if (params.classNumber) classNumber = params.classNumber;
              if (params.attendanceStudents) attendanceStudents = params.attendanceStudents;
            }
          } catch { /* ignore */ }
          return {
            id: t.id,
            courseType: t.courseType,
            displayName: t.displayName,
            status: t.status,
            currentStep: t.currentStep,
            totalSteps: t.totalSteps,
            stepResults,
            errorMessage: t.errorMessage,
            model,
            materialsSummary,
            classNumber,
            attendanceStudents,
            createdAt: t.createdAt.toISOString(),
            completedAt: t.completedAt?.toISOString() || null,
          };
        });
    }),

    // 获取反馈全文（按需加载）
    feedbackContent: protectedProcedure
      .input(z.object({ taskId: z.string() }))
      .query(async ({ input, ctx }) => {
        const { backgroundTasks: bgTasksTable } = await import("../drizzle/schema");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });

        const tasks = await db.select({ stepResults: bgTasksTable.stepResults })
          .from(bgTasksTable)
          .where(and(eq(bgTasksTable.id, input.taskId), eq(bgTasksTable.userId, ctx.user.id)))
          .limit(1);
        if (tasks.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });

        let stepResults = null;
        try {
          stepResults = tasks[0].stepResults ? JSON.parse(tasks[0].stepResults) : null;
        } catch {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "任务数据损坏，无法解析" });
        }
        const content = stepResults?.feedback?.content || null;
        if (!content) throw new TRPCError({ code: "NOT_FOUND", message: "反馈内容不可用（可能是旧任务）" });
        return { content };
      }),

    // 获取课后信息提取全文（按需加载）
    extractionContent: protectedProcedure
      .input(z.object({ taskId: z.string() }))
      .query(async ({ input, ctx }) => {
        const { backgroundTasks: bgTasksTable } = await import("../drizzle/schema");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });

        const tasks = await db.select({ stepResults: bgTasksTable.stepResults })
          .from(bgTasksTable)
          .where(and(eq(bgTasksTable.id, input.taskId), eq(bgTasksTable.userId, ctx.user.id)))
          .limit(1);
        if (tasks.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });

        let stepResults = null;
        try {
          stepResults = tasks[0].stepResults ? JSON.parse(tasks[0].stepResults) : null;
        } catch {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "任务数据损坏，无法解析" });
        }
        const content = stepResults?.extraction?.content || null;
        if (!content) throw new TRPCError({ code: "NOT_FOUND", message: "提取内容不可用（可能是旧任务）" });
        return { content };
      }),

    // 获取发送素材（按需加载，用于用户验证发送内容）
    inputMaterials: protectedProcedure
      .input(z.object({ taskId: z.string() }))
      .query(async ({ input, ctx }) => {
        const { backgroundTasks: bgTasksTable } = await import("../drizzle/schema");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });

        const tasks = await db.select({ inputParams: bgTasksTable.inputParams })
          .from(bgTasksTable)
          .where(and(eq(bgTasksTable.id, input.taskId), eq(bgTasksTable.userId, ctx.user.id)))
          .limit(1);
        if (tasks.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });

        let params: any = null;
        try {
          params = tasks[0].inputParams ? JSON.parse(tasks[0].inputParams) : null;
        } catch {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "任务数据损坏，无法解析" });
        }
        if (!params) throw new TRPCError({ code: "NOT_FOUND", message: "任务参数不可用" });

        return {
          transcript: params.transcript || null,
          currentNotes: params.currentNotes || null,
          lastFeedback: params.lastFeedback || null,
          transcriptSegments: params.transcriptSegments || null,
        };
      }),

    // 取消运行中的任务
    cancel: protectedProcedure
      .input(z.object({ taskId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const { cancelBackgroundTask } = await import("./backgroundTaskRunner");
        const { backgroundTasks: bgTasksTable } = await import("../drizzle/schema");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });

        // 检查任务是否存在且在运行中
        const tasks = await db.select({ status: bgTasksTable.status })
          .from(bgTasksTable)
          .where(and(eq(bgTasksTable.id, input.taskId), eq(bgTasksTable.userId, ctx.user.id)))
          .limit(1);
        if (tasks.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
        if (tasks[0].status !== "running" && tasks[0].status !== "pending") {
          return { success: false, message: "任务不在运行状态" };
        }

        const cancelled = cancelBackgroundTask(input.taskId);
        if (!cancelled) {
          // 任务可能是pending（还没开始），直接在DB中标记取消
          await db.update(bgTasksTable).set({
            status: "cancelled",
            errorMessage: "用户手动取消",
            completedAt: new Date(),
          }).where(and(eq(bgTasksTable.id, input.taskId), eq(bgTasksTable.userId, ctx.user.id)));
        }
        return { success: true, message: "取消请求已发送" };
      }),
  }),

  // 批量任务管理（后台执行）
  batchTask: router({
    // 提交批量任务
    submit: protectedProcedure
      .input(z.object({
        startNumber: z.number().min(1),
        endNumber: z.number().min(1),
        concurrency: z.number().min(1).max(100).default(50),
        roadmap: z.string().min(1),
        storagePath: z.string().optional(),
        filePrefix: z.string().optional(),
        templateType: z.string().default("markdown_styled"),
        namingMethod: z.string().default("prefix"),
        customFileNames: z.record(z.number().or(z.string()), z.string()).optional(),
        files: z.any().optional(), // FileInfo record by task number
        sharedFiles: z.any().optional(), // FileInfo[]
        apiModel: z.string().optional(),
        apiKey: z.string().optional(),
        apiUrl: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { startBatchBackgroundTask, cleanupOldBatchTasks } = await import("./batch/batchTaskRunner");
        const { batchTasks: batchTasksTable, batchTaskItems: batchItemsTable } = await import("../drizzle/schema");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });

        if (input.startNumber > input.endNumber) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "起始编号不能大于结束编号" });
        }

        // 先清理旧任务
        await cleanupOldBatchTasks();

        const batchId = crypto.randomUUID();
        const totalItems = input.endNumber - input.startNumber + 1;
        const displayName = `批量生成 ${input.startNumber}-${input.endNumber} (${totalItems}个)`;

        // 标准化 customFileNames 的 key 为数字
        let normalizedCustomFileNames: Record<number, string> | undefined;
        if (input.customFileNames) {
          normalizedCustomFileNames = {};
          for (const [key, value] of Object.entries(input.customFileNames)) {
            normalizedCustomFileNames[Number(key)] = value;
          }
        }

        // 标准化 files 的 key 为数字
        let normalizedFiles: Record<number, any> | undefined;
        if (input.files) {
          normalizedFiles = {};
          for (const [key, value] of Object.entries(input.files)) {
            normalizedFiles[Number(key)] = value;
          }
        }

        const taskParams = {
          startNumber: input.startNumber,
          endNumber: input.endNumber,
          concurrency: input.concurrency,
          roadmap: input.roadmap,
          storagePath: input.storagePath || "",
          filePrefix: input.filePrefix || "任务",
          templateType: input.templateType,
          namingMethod: input.namingMethod,
          customFileNames: normalizedCustomFileNames,
          files: normalizedFiles,
          sharedFiles: input.sharedFiles,
          apiModel: input.apiModel,
          apiKey: input.apiKey,
          apiUrl: input.apiUrl,
        };

        // 插入批量任务记录
        await db.insert(batchTasksTable).values({
          id: batchId,
          userId: ctx.user.id,
          displayName,
          status: "pending",
          totalItems,
          completedItems: 0,
          failedItems: 0,
          inputParams: JSON.stringify(taskParams),
        });

        // 插入所有子任务记录
        const itemValues = [];
        for (let i = input.startNumber; i <= input.endNumber; i++) {
          itemValues.push({
            batchId,
            taskNumber: i,
            status: "pending",
          });
        }
        // 批量插入（每次100条防止 SQL 太长）
        for (let i = 0; i < itemValues.length; i += 100) {
          const chunk = itemValues.slice(i, i + 100);
          await db.insert(batchItemsTable).values(chunk);
        }

        // 启动后台处理
        startBatchBackgroundTask(batchId);

        return { batchId, displayName, totalItems };
      }),

    // 查询最近3天的批量任务历史
    history: protectedProcedure.query(async ({ ctx }) => {
      const { batchTasks: batchTasksTable } = await import("../drizzle/schema");
      const db = await getDb();
      if (!db) return [];

      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const tasks = await db.select({
        id: batchTasksTable.id,
        displayName: batchTasksTable.displayName,
        status: batchTasksTable.status,
        totalItems: batchTasksTable.totalItems,
        completedItems: batchTasksTable.completedItems,
        failedItems: batchTasksTable.failedItems,
        errorMessage: batchTasksTable.errorMessage,
        createdAt: batchTasksTable.createdAt,
        completedAt: batchTasksTable.completedAt,
        inputParams: batchTasksTable.inputParams,
      })
        .from(batchTasksTable)
        .where(and(eq(batchTasksTable.userId, ctx.user.id), gte(batchTasksTable.createdAt, threeDaysAgo)))
        .orderBy(desc(batchTasksTable.createdAt));

      return tasks.map((t) => {
        // 从 inputParams 中提取显示信息（不返回完整参数）
        let templateType: string | null = null;
        let storagePath: string | null = null;
        try {
          const params = t.inputParams ? JSON.parse(t.inputParams) : null;
          if (params) {
            templateType = params.templateType || null;
            storagePath = params.storagePath || null;
          }
        } catch { /* ignore */ }
        return {
          id: t.id,
          displayName: t.displayName,
          status: t.status,
          totalItems: t.totalItems,
          completedItems: t.completedItems,
          failedItems: t.failedItems,
          errorMessage: t.errorMessage,
          templateType,
          storagePath,
          createdAt: t.createdAt.toISOString(),
          completedAt: t.completedAt?.toISOString() || null,
        };
      });
    }),

    // 获取批量任务的子项列表
    items: protectedProcedure
      .input(z.object({ batchId: z.string().uuid() }))
      .query(async ({ input, ctx }) => {
        const { batchTasks: batchTasksTable, batchTaskItems: batchItemsTable } = await import("../drizzle/schema");
        const db = await getDb();
        if (!db) return [];

        // 验证批量任务属于当前用户
        const batch = await db.select({ id: batchTasksTable.id }).from(batchTasksTable)
          .where(and(eq(batchTasksTable.id, input.batchId), eq(batchTasksTable.userId, ctx.user.id))).limit(1);
        if (batch.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });

        const items = await db.select({
          id: batchItemsTable.id,
          taskNumber: batchItemsTable.taskNumber,
          status: batchItemsTable.status,
          chars: batchItemsTable.chars,
          filename: batchItemsTable.filename,
          url: batchItemsTable.url,
          error: batchItemsTable.error,
          truncated: batchItemsTable.truncated,
        })
          .from(batchItemsTable)
          .where(eq(batchItemsTable.batchId, input.batchId))
          .orderBy(batchItemsTable.taskNumber);

        return items.map((item) => ({
          id: item.id,
          taskNumber: item.taskNumber,
          status: item.status,
          chars: item.chars || 0,
          filename: item.filename || null,
          url: item.url || null,
          error: item.error || null,
          truncated: item.truncated === 1,
        }));
      }),

    // 重试单个子任务
    retryItem: protectedProcedure
      .input(z.object({
        batchId: z.string().uuid(),
        taskNumber: z.number(),
      }))
      .mutation(async ({ input, ctx }) => {
        // 验证批量任务属于当前用户
        const { batchTasks: batchTasksTable } = await import("../drizzle/schema");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
        const batch = await db.select({ id: batchTasksTable.id }).from(batchTasksTable)
          .where(and(eq(batchTasksTable.id, input.batchId), eq(batchTasksTable.userId, ctx.user.id))).limit(1);
        if (batch.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
        const { retryBatchItem } = await import("./batch/batchTaskRunner");
        // 异步执行，不等待结果
        retryBatchItem(input.batchId, input.taskNumber).catch((err) => {
          console.error(`[批量任务重试] ${input.batchId}/${input.taskNumber} 失败:`, err?.message);
        });
        return { success: true, message: "重试已开始" };
      }),

    // 取消/停止批量任务
    cancel: protectedProcedure
      .input(z.object({ batchId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        const { cancelBatchTask } = await import("./batch/batchTaskRunner");
        const { batchTasks: batchTasksTable } = await import("../drizzle/schema");
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });

        const tasks = await db.select({ status: batchTasksTable.status })
          .from(batchTasksTable)
          .where(and(eq(batchTasksTable.id, input.batchId), eq(batchTasksTable.userId, ctx.user.id)))
          .limit(1);
        if (tasks.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
        if (tasks[0].status !== "running" && tasks[0].status !== "pending") {
          return { success: false, message: "任务不在运行状态" };
        }

        const cancelled = cancelBatchTask(input.batchId);
        if (!cancelled) {
          await db.update(batchTasksTable).set({
            status: "stopped",
            errorMessage: "用户手动停止",
            completedAt: new Date(),
          }).where(and(eq(batchTasksTable.id, input.batchId), eq(batchTasksTable.userId, ctx.user.id)));
        }
        return { success: true, message: "停止请求已发送" };
      }),
  }),

  // 简单计算功能（保留MVP验证）
  calculate: router({
    compute: protectedProcedure
      .input(z.object({
        expression: z.string().min(1, "请输入算术表达式"),
        studentName: z.string().default("李四"),
      }))
      .mutation(async ({ input, ctx }) => {
        const { expression, studentName } = input;
        
        const response = await invokeLLM({
          messages: [
            { 
              role: "system", 
              content: "你是一个计算器。用户会给你一个算术表达式，请直接返回计算结果，只返回数字，不要有任何其他文字。" 
            },
            { 
              role: "user", 
              content: expression 
            },
          ],
        });

        const result = response.choices[0]?.message?.content || "计算失败";
        
        const fileContent = `# 计算结果\n\n表达式：${expression}\n结果：${result}\n\n生成时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
        
        const fileName = `${studentName}计算结果.md`;
        const folderPath = `Mac/Documents/XDF/学生档案/${studentName}/课后信息`;
        
        try {
          const driveResult = await uploadToGoogleDrive(ctx.user.id, fileContent, fileName, folderPath);
          return {
            success: true,
            expression,
            result,
            driveUrl: driveResult.url,
            filePath: driveResult.path,
          };
        } catch (error) {
          console.error("Google Drive上传失败:", error);
          return {
            success: false,
            expression,
            result,
            error: "文件上传失败，但计算成功",
          };
        }
      }),
  }),

  // ==================== 学生管理系统 ====================
  homework: router({
    // 学生名册
    listStudents: protectedProcedure
      .input(z.object({ status: z.string().optional() }).optional())
      .query(async ({ input, ctx }) => {
        return listStudents(ctx.user.id, input?.status);
      }),

    addStudent: protectedProcedure
      .input(z.object({
        name: z.string().min(1),
        planType: z.enum(["daily", "weekly"]).default("weekly"),
      }))
      .mutation(async ({ input, ctx }) => {
        return addStudent(ctx.user.id, input.name, input.planType);
      }),

    updateStudent: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).optional(),
        planType: z.enum(["daily", "weekly"]).optional(),
        status: z.enum(["active", "inactive"]).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        return updateStudent(ctx.user.id, id, data);
      }),

    removeStudent: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        return removeStudent(ctx.user.id, input.id);
      }),

    // 语音输入处理（预入库队列）
    submitEntry: protectedProcedure
      .input(z.object({
        studentName: z.string().min(1),
        rawInput: z.string().min(1),
        aiModel: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        return submitAndProcessEntry(
          ctx.user.id,
          input.studentName,
          input.rawInput,
          input.aiModel,
        );
      }),

    listPendingEntries: protectedProcedure
      .query(async ({ ctx }) => {
        return listPendingEntries(ctx.user.id);
      }),

    listEntries: protectedProcedure
      .input(z.object({ status: z.string().optional() }).optional())
      .query(async ({ input, ctx }) => {
        return listEntries(ctx.user.id, input?.status);
      }),

    // 查询某学生的已入库记录
    listStudentEntries: protectedProcedure
      .input(z.object({
        studentName: z.string().min(1),
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
      }))
      .query(async ({ input, ctx }) => {
        return listStudentEntries(ctx.user.id, input.studentName, input.limit, input.offset);
      }),

    retryEntry: protectedProcedure
      .input(z.object({
        id: z.number(),
      }))
      .mutation(async ({ input, ctx }) => {
        return retryEntry(ctx.user.id, input.id);
      }),

    deleteEntry: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        return deleteEntry(ctx.user.id, input.id);
      }),

    confirmEntries: protectedProcedure
      .input(z.object({ ids: z.array(z.number()) }))
      .mutation(async ({ input, ctx }) => {
        const result = await confirmEntries(ctx.user.id, input.ids);
        if (result.count > 0) autoBackupToGDrive(ctx.user.id); // fire-and-forget
        return result;
      }),

    confirmAll: protectedProcedure
      .mutation(async ({ ctx }) => {
        const result = await confirmAllPreStaged(ctx.user.id);
        if (result.updatedStudents.length > 0) autoBackupToGDrive(ctx.user.id); // fire-and-forget
        return result;
      }),

    // 学生管理专用配置（AI模型、提示词）
    getConfig: protectedProcedure
      .query(async ({ ctx }) => {
        const uid = ctx.user.id;
        const hwAiModel = await getConfig("hwAiModel", uid);
        const hwPromptTemplate = await getConfig("hwPromptTemplate", uid);
        const modelPresets = await getConfig("modelPresets", uid);
        const gradingPrompt = await getConfig("gradingPrompt", uid);
        const gradingYear = await getConfig("gradingYear", uid);
        const gradingSyncPrompt = await getConfig("gradingSyncPrompt", uid);
        const gradingSyncConcurrency = await getConfig("gradingSyncConcurrency", uid);
        const reminderPrompt = await getConfig("reminderPrompt", uid);
        return {
          hwAiModel: hwAiModel || "",
          hwPromptTemplate: hwPromptTemplate || "",
          modelPresets: modelPresets || "",
          gradingPrompt: gradingPrompt || "",
          gradingYear: gradingYear || "",
          gradingSyncPrompt: gradingSyncPrompt || "",
          gradingSyncConcurrency: gradingSyncConcurrency || "20",
          reminderPrompt: reminderPrompt || "",
        };
      }),

    updateConfig: protectedProcedure
      .input(z.object({
        hwAiModel: z.string().optional(),
        hwPromptTemplate: z.string().optional(),
        gradingPrompt: z.string().optional(),
        gradingYear: z.string().optional(),
        gradingSyncPrompt: z.string().optional(),
        gradingSyncConcurrency: z.string().optional(),
        reminderPrompt: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const uid = ctx.user.id;
        if (input.hwAiModel !== undefined) {
          await setUserConfigValue(uid, "hwAiModel", input.hwAiModel);
        }
        if (input.hwPromptTemplate !== undefined) {
          await setUserConfigValue(uid, "hwPromptTemplate", input.hwPromptTemplate);
        }
        if (input.gradingPrompt !== undefined) {
          await setUserConfigValue(uid, "gradingPrompt", input.gradingPrompt);
        }
        if (input.gradingYear !== undefined) {
          await setUserConfigValue(uid, "gradingYear", input.gradingYear);
        }
        if (input.gradingSyncPrompt !== undefined) {
          await setUserConfigValue(uid, "gradingSyncPrompt", input.gradingSyncPrompt);
        }
        if (input.gradingSyncConcurrency !== undefined) {
          await setUserConfigValue(uid, "gradingSyncConcurrency", input.gradingSyncConcurrency);
        }
        if (input.reminderPrompt !== undefined) {
          await setUserConfigValue(uid, "reminderPrompt", input.reminderPrompt);
        }
        return { success: true };
      }),

    // 一键打分（后台任务模式）
    submitGrading: protectedProcedure
      .input(z.object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        gradingPrompt: z.string().min(1, "打分提示词不能为空"),
        userNotes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        return submitGrading(ctx.user.id, {
          startDate: input.startDate,
          endDate: input.endDate,
          gradingPrompt: input.gradingPrompt,
          userNotes: input.userNotes,
        });
      }),

    getGradingTask: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        return getGradingTask(ctx.user.id, input.id);
      }),

    listGradingTasks: protectedProcedure
      .query(async ({ ctx }) => {
        return listGradingTasks(ctx.user.id);
      }),

    // 保存编辑后的打分结果
    updateGradingResult: protectedProcedure
      .input(z.object({
        id: z.number(),
        editedResult: z.string().min(1),
      }))
      .mutation(async ({ input, ctx }) => {
        await updateGradingEditedResult(ctx.user.id, input.id, input.editedResult);
        return { success: true };
      }),

    // 一键同步打分结果到所有学生状态
    syncGradingToStudents: protectedProcedure
      .input(z.object({
        id: z.number(),
        syncPrompt: z.string().optional(),
        concurrency: z.number().min(1).max(100).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        return syncGradingToStudents(ctx.user.id, input.id, {
          syncPrompt: input.syncPrompt,
          concurrency: input.concurrency,
        });
      }),

    // 查询同步子任务列表（逐学生进度）
    getSyncItems: protectedProcedure
      .input(z.object({ gradingTaskId: z.number() }))
      .query(async ({ input, ctx }) => {
        return getGradingSyncItems(ctx.user.id, input.gradingTaskId);
      }),

    // 重试单个同步子任务
    retrySyncItem: protectedProcedure
      .input(z.object({ gradingTaskId: z.number(), itemId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        await retrySyncItem(ctx.user.id, input.gradingTaskId, input.itemId);
        return { success: true };
      }),

    // 导入同步结果到学生状态（预入库）
    importSyncToStudents: protectedProcedure
      .input(z.object({ gradingTaskId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        return importSyncToStudents(ctx.user.id, input.gradingTaskId);
      }),

    // 获取默认同步系统提示词
    getDefaultSyncPrompt: protectedProcedure
      .query(() => {
        return { prompt: DEFAULT_SYNC_SYSTEM_PROMPT };
      }),

    // 预览发送处理的系统提示词
    previewEntryPrompt: protectedProcedure
      .input(z.object({ studentName: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        return previewEntryPrompt(ctx.user.id, input.studentName);
      }),

    // 获取学生当前状态文档
    getStudentStatus: protectedProcedure
      .input(z.object({ studentName: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        const status = await getStudentLatestStatus(ctx.user.id, input.studentName);
        return { currentStatus: status };
      }),

    // 从课后信息提取一键导入（直接传内容）
    importFromExtraction: protectedProcedure
      .input(z.object({
        studentName: z.string().min(1),
        extractionContent: z.string().min(1),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await importFromExtraction(ctx.user.id, input.studentName, input.extractionContent);
        autoBackupToGDrive(ctx.user.id); // fire-and-forget
        return result;
      }),

    // 从后台任务一键导入（自动获取课后信息提取内容）
    importFromTask: protectedProcedure
      .input(z.object({
        taskId: z.string().min(1),
        studentName: z.string().min(1),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await importFromTaskExtraction(ctx.user.id, input.taskId, input.studentName);
        autoBackupToGDrive(ctx.user.id); // fire-and-forget
        return result;
      }),

    // 小班课一键导入：N+1模式（班级 + 每个出勤学生）
    importClassFromTask: protectedProcedure
      .input(z.object({
        taskId: z.string().min(1),
        classNumber: z.string().min(1),
        attendanceStudents: z.array(z.string()),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await importClassFromTaskExtraction(ctx.user.id, input.taskId, input.classNumber, input.attendanceStudents);
        autoBackupToGDrive(ctx.user.id); // fire-and-forget
        return result;
      }),

    // ========== 作业提醒（一键催作业） ==========
    submitReminder: protectedProcedure
      .input(z.object({
        reminderPrompt: z.string().min(1, "提示词不能为空"),
      }))
      .mutation(async ({ input, ctx }) => {
        return submitReminder(ctx.user.id, {
          reminderPrompt: input.reminderPrompt,
        });
      }),

    getReminderTask: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        return getReminderTask(ctx.user.id, input.id);
      }),

    listReminderTasks: protectedProcedure
      .query(async ({ ctx }) => {
        return listReminderTasks(ctx.user.id);
      }),

    previewReminderPrompt: protectedProcedure
      .input(z.object({ reminderPrompt: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        return previewReminderPrompt(ctx.user.id, input.reminderPrompt);
      }),

    // ========== 数据备份与恢复 ==========
    exportBackup: protectedProcedure
      .mutation(async ({ ctx }) => {
        const result = await exportStudentBackup(ctx.user.id);
        // 同时上传到 Google Drive
        autoBackupToGDrive(ctx.user.id);
        return result;
      }),

    previewBackup: protectedProcedure
      .input(z.object({ content: z.string().min(1, "备份内容不能为空") }))
      .mutation(async ({ input }) => {
        return previewBackup(input.content);
      }),

    importBackup: protectedProcedure
      .input(z.object({ content: z.string().min(1, "备份内容不能为空") }))
      .mutation(async ({ input, ctx }) => {
        return importStudentBackup(ctx.user.id, input.content);
      }),
  }),

  // ==================== 作业批改系统 ====================
  correction: router({
    // 提交批改任务
    submit: protectedProcedure
      .input(z.object({
        studentName: z.string().min(1, "请选择学生"),
        correctionType: z.string().min(1, "请选择批改类型"),
        rawText: z.string().optional(),
        images: z.array(z.string()).optional(),
        files: z.array(z.object({
          name: z.string(),
          content: z.string(),  // base64
          mimeType: z.string(),
        })).optional(),
        aiModel: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { submitCorrection } = await import("./correctionRunner");
        return submitCorrection(ctx.user.id, input);
      }),

    // 查询单个任务
    getTask: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        const { getCorrectionTask } = await import("./correctionRunner");
        return getCorrectionTask(ctx.user.id, input.id);
      }),

    // 列出批改任务
    listTasks: protectedProcedure
      .input(z.object({
        studentName: z.string().optional(),
        limit: z.number().min(1).max(100).default(20),
      }).optional())
      .query(async ({ input, ctx }) => {
        const { listCorrectionTasks } = await import("./correctionRunner");
        return listCorrectionTasks(ctx.user.id, input?.studentName, input?.limit);
      }),

    // 获取批改类型列表
    getTypes: protectedProcedure
      .query(async ({ ctx }) => {
        const { getCorrectionTypes } = await import("./correctionRunner");
        return getCorrectionTypes(ctx.user.id);
      }),

    // 更新批改类型配置
    updateTypes: protectedProcedure
      .input(z.array(z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        prompt: z.string(),
      })))
      .mutation(async ({ input, ctx }) => {
        await setUserConfigValue(ctx.user.id, "correctionTypes", JSON.stringify(input));
        return { success: true };
      }),

    // 获取通用批改提示词
    getPrompt: protectedProcedure
      .query(async ({ ctx }) => {
        const { getCorrectionPrompt } = await import("./correctionRunner");
        return { prompt: await getCorrectionPrompt(ctx.user.id) };
      }),

    // 更新通用批改提示词
    updatePrompt: protectedProcedure
      .input(z.object({ prompt: z.string() }))
      .mutation(async ({ input, ctx }) => {
        await setUserConfigValue(ctx.user.id, "correctionPrompt", input.prompt);
        return { success: true };
      }),

    // 预览批改系统提示词
    previewPrompt: protectedProcedure
      .input(z.object({
        studentName: z.string().min(1),
        correctionType: z.string().min(1),
      }))
      .query(async ({ input, ctx }) => {
        const { previewCorrectionPrompt } = await import("./correctionRunner");
        return previewCorrectionPrompt(ctx.user.id, input.studentName, input.correctionType);
      }),

    // 获取批改配置（AI模型）
    getConfig: protectedProcedure
      .query(async ({ ctx }) => {
        const uid = ctx.user.id;
        const corrAiModel = await getConfig("corrAiModel", uid);
        const modelPresets = await getConfig("modelPresets", uid);
        return {
          corrAiModel: corrAiModel || "",
          modelPresets: modelPresets || "",
        };
      }),

    // 更新批改配置（AI模型）
    updateConfig: protectedProcedure
      .input(z.object({
        corrAiModel: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const uid = ctx.user.id;
        if (input.corrAiModel !== undefined) {
          await setUserConfigValue(uid, "corrAiModel", input.corrAiModel);
        }
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
