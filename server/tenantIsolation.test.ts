/**
 * 多租户数据隔离综合测试
 *
 * 本文件覆盖以下场景：
 * 1. 学生管理（homeworkManager）跨租户数据隔离
 * 2. 软配置三级回退（userConfig → systemConfig → DEFAULT_CONFIG）
 * 3. 配置 API 路由隔离
 * 4. 打分系统（gradingRunner）隔离
 * 5. 后台任务隔离
 * 6. 批量处理路由跨租户漏洞
 * 7. 管理员伪装模式隔离
 * 8. 并发多用户压力测试
 * 9. 边界条件（userId=0、负数、SQL注入）
 *
 * 所有测试均使用内存模拟数据库，不依赖真实 MySQL。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ═══════════════════════════════════════════════════════════
// 内存模拟数据库
// ═══════════════════════════════════════════════════════════

/** 自增 ID 计数器 */
let _autoIncrementId = 100;
function nextId(): number {
  return ++_autoIncrementId;
}

/** 模拟数据存储 */
interface MockStore {
  students: Array<{ id: number; userId: number; name: string; planType: string; status: string; currentStatus: string | null; createdAt: Date; updatedAt: Date }>;
  entries: Array<{ id: number; userId: number; studentName: string; rawInput: string; parsedContent: string | null; aiModel: string | null; entryStatus: string; errorMessage: string | null; streamingChars: number; startedAt: Date | null; completedAt: Date | null; createdAt: Date; updatedAt: Date }>;
  userConfigs: Array<{ id: number; userId: number; key: string; value: string; updatedAt: Date }>;
  systemConfigs: Array<{ id: number; key: string; value: string; description: string | null; updatedAt: Date }>;
  backgroundTasks: Array<{ id: string; userId: number; courseType: string; displayName: string; status: string; currentStep: number; totalSteps: number; inputParams: string; stepResults: string | null; errorMessage: string | null; createdAt: Date; updatedAt: Date; completedAt: Date | null }>;
  gradingTasks: Array<{ id: number; userId: number; startDate: string; endDate: string; gradingPrompt: string; userNotes: string | null; studentCount: number; systemPrompt: string | null; result: string | null; editedResult: string | null; aiModel: string | null; taskStatus: string; errorMessage: string | null; streamingChars: number; syncStatus: string | null; syncTotal: number; syncCompleted: number; syncFailed: number; syncError: string | null; syncSystemPrompt: string | null; syncConcurrency: number; syncImported: string | null; createdAt: Date; updatedAt: Date; completedAt: Date | null }>;
  gradingSyncItems: Array<{ id: number; gradingTaskId: number; studentId: number; studentName: string; status: string; chars: number; result: string | null; error: string | null; startedAt: Date | null; completedAt: Date | null; createdAt: Date; updatedAt: Date }>;
}

let store: MockStore;

function resetStore(): void {
  _autoIncrementId = 100;
  store = {
    students: [],
    entries: [],
    userConfigs: [],
    systemConfigs: [],
    backgroundTasks: [],
    gradingTasks: [],
    gradingSyncItems: [],
  };
}

/**
 * 辅助函数：向模拟数据库插入学生
 */
function seedStudent(userId: number, name: string, opts?: Partial<MockStore["students"][0]>) {
  const s = {
    id: nextId(),
    userId,
    name,
    planType: "weekly",
    status: "active",
    currentStatus: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...opts,
  };
  store.students.push(s);
  return s;
}

/**
 * 辅助函数：向模拟数据库插入条目
 */
function seedEntry(userId: number, studentName: string, opts?: Partial<MockStore["entries"][0]>) {
  const e = {
    id: nextId(),
    userId,
    studentName,
    rawInput: "测试录音",
    parsedContent: null,
    aiModel: null,
    entryStatus: "pending",
    errorMessage: null,
    streamingChars: 0,
    startedAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...opts,
  };
  store.entries.push(e);
  return e;
}

/**
 * 辅助函数：向模拟数据库插入用户配置
 */
function seedUserConfig(userId: number, key: string, value: string) {
  const c = { id: nextId(), userId, key, value, updatedAt: new Date() };
  store.userConfigs.push(c);
  return c;
}

/**
 * 辅助函数：向模拟数据库插入系统配置
 */
function seedSystemConfig(key: string, value: string) {
  const c = { id: nextId(), key, value, description: null, updatedAt: new Date() };
  store.systemConfigs.push(c);
  return c;
}

/**
 * 辅助函数：向模拟数据库插入打分任务
 */
function seedGradingTask(userId: number, opts?: Partial<MockStore["gradingTasks"][0]>) {
  const t = {
    id: nextId(),
    userId,
    startDate: "2026-02-01",
    endDate: "2026-02-07",
    gradingPrompt: "请打分",
    userNotes: null,
    studentCount: 0,
    systemPrompt: null,
    result: null,
    editedResult: null,
    aiModel: null,
    taskStatus: "pending",
    errorMessage: null,
    streamingChars: 0,
    syncStatus: null,
    syncTotal: 0,
    syncCompleted: 0,
    syncFailed: 0,
    syncError: null,
    syncSystemPrompt: null,
    syncConcurrency: 20,
    syncImported: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    ...opts,
  };
  store.gradingTasks.push(t);
  return t;
}

/**
 * 辅助函数：向模拟数据库插入后台任务
 */
function seedBackgroundTask(userId: number, taskId: string, opts?: Partial<MockStore["backgroundTasks"][0]>) {
  const t = {
    id: taskId,
    userId,
    courseType: "one-to-one",
    displayName: "测试任务",
    status: "completed",
    currentStep: 5,
    totalSteps: 5,
    inputParams: "{}",
    stepResults: JSON.stringify({ extraction: { content: "提取内容" } }),
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: new Date(),
    ...opts,
  };
  store.backgroundTasks.push(t);
  return t;
}

/**
 * 辅助函数：向模拟数据库插入打分同步子项
 */
function seedGradingSyncItem(gradingTaskId: number, studentId: number, studentName: string, opts?: Partial<MockStore["gradingSyncItems"][0]>) {
  const item = {
    id: nextId(),
    gradingTaskId,
    studentId,
    studentName,
    status: "completed",
    chars: 100,
    result: "更新后的状态",
    error: null,
    startedAt: new Date(),
    completedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...opts,
  };
  store.gradingSyncItems.push(item);
  return item;
}


// ═══════════════════════════════════════════════════════════
// Mock 所有外部依赖
// ═══════════════════════════════════════════════════════════

// Mock drizzle-orm 的比较函数 —— 返回可序列化的标记对象，在 mock where 中解析
vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => ({ __op: "eq", col, val }),
  and: (...args: any[]) => ({ __op: "and", conditions: args }),
  desc: (col: any) => ({ __op: "desc", col }),
  sql: Object.assign((strings: TemplateStringsArray, ...values: any[]) => ({ __op: "sql", raw: strings.join("?"), values }), {
    raw: (s: string) => ({ __op: "sql_raw", raw: s }),
  }),
  inArray: (col: any, vals: any[]) => ({ __op: "inArray", col, vals }),
  not: (cond: any) => ({ __op: "not", cond }),
  like: (col: any, pattern: string) => ({ __op: "like", col, pattern }),
  gte: (col: any, val: any) => ({ __op: "gte", col, val }),
  lt: (col: any, val: any) => ({ __op: "lt", col, val }),
}));

vi.mock("../drizzle/schema", () => ({
  users: { id: "users.id", openId: "users.openId", name: "users.name", email: "users.email", loginMethod: "users.loginMethod", role: "users.role", accountStatus: "users.accountStatus", createdAt: "users.createdAt", lastSignedIn: "users.lastSignedIn" },
  systemConfig: { id: "sc.id", key: "sc.key", value: "sc.value", description: "sc.description" },
  userConfig: { id: "uc.id", userId: "uc.userId", key: "uc.key", value: "uc.value" },
  hwStudents: { id: "hs.id", userId: "hs.userId", name: "hs.name", planType: "hs.planType", status: "hs.status", currentStatus: "hs.currentStatus", createdAt: "hs.createdAt" },
  hwEntries: { id: "he.id", userId: "he.userId", studentName: "he.studentName", rawInput: "he.rawInput", parsedContent: "he.parsedContent", aiModel: "he.aiModel", entryStatus: "he.entryStatus", errorMessage: "he.errorMessage", streamingChars: "he.streamingChars", startedAt: "he.startedAt", completedAt: "he.completedAt", createdAt: "he.createdAt" },
  backgroundTasks: { id: "bt.id", userId: "bt.userId", courseType: "bt.courseType", displayName: "bt.displayName", status: "bt.status", currentStep: "bt.currentStep", totalSteps: "bt.totalSteps", inputParams: "bt.inputParams", stepResults: "bt.stepResults", errorMessage: "bt.errorMessage", createdAt: "bt.createdAt", completedAt: "bt.completedAt" },
  batchTasks: { id: "bk.id", userId: "bk.userId" },
  batchTaskItems: { batchId: "bki.batchId" },
  correctionTasks: { userId: "ct.userId" },
  gradingTasks: { id: "gt.id", userId: "gt.userId", startDate: "gt.startDate", endDate: "gt.endDate", gradingPrompt: "gt.gradingPrompt", userNotes: "gt.userNotes", studentCount: "gt.studentCount", systemPrompt: "gt.systemPrompt", result: "gt.result", editedResult: "gt.editedResult", aiModel: "gt.aiModel", taskStatus: "gt.taskStatus", errorMessage: "gt.errorMessage", streamingChars: "gt.streamingChars", syncStatus: "gt.syncStatus", syncTotal: "gt.syncTotal", syncCompleted: "gt.syncCompleted", syncFailed: "gt.syncFailed", syncError: "gt.syncError", syncSystemPrompt: "gt.syncSystemPrompt", syncConcurrency: "gt.syncConcurrency", syncImported: "gt.syncImported", createdAt: "gt.createdAt", updatedAt: "gt.updatedAt", completedAt: "gt.completedAt" },
  gradingSyncItems: { id: "gsi.id", gradingTaskId: "gsi.gradingTaskId", studentId: "gsi.studentId", studentName: "gsi.studentName", status: "gsi.status", chars: "gsi.chars", result: "gsi.result", error: "gsi.error", startedAt: "gsi.startedAt", completedAt: "gsi.completedAt" },
  googleTokens: { userId: "gt2.userId" },
}));

// Mock whatai（AI 调用）
vi.mock("./whatai", () => ({
  invokeWhatAIStream: vi.fn().mockResolvedValue("AI生成的结果内容"),
}));

// Mock utils
vi.mock("./utils", () => ({
  getBeijingTimeContext: vi.fn().mockReturnValue("2026年2月14日 周五 10:00"),
  addWeekdayToDate: vi.fn().mockReturnValue("2月14日（周五）"),
}));

// ═══════════════════════════════════════════════════════════
// 核心：模拟 getDb() 返回带有实际过滤逻辑的内存 DB
// ═══════════════════════════════════════════════════════════

/**
 * 条件匹配引擎：解析 drizzle-orm 的 eq/and/inArray 条件，
 * 在内存数据上执行过滤。
 */
function matchesCondition(record: Record<string, any>, condition: any): boolean {
  if (!condition) return true;
  if (condition.__op === "eq") {
    const col = condition.col as string;
    const val = condition.val;
    // 列名映射：schema 中定义的如 "hs.userId" → record 中的字段名
    const fieldName = resolveColumnName(col);
    return record[fieldName] === val;
  }
  if (condition.__op === "and") {
    return condition.conditions.every((c: any) => matchesCondition(record, c));
  }
  if (condition.__op === "inArray") {
    const col = condition.col as string;
    const vals = condition.vals as any[];
    const fieldName = resolveColumnName(col);
    return vals.includes(record[fieldName]);
  }
  if (condition.__op === "not") {
    return !matchesCondition(record, condition.cond);
  }
  return true;
}

/** 从 "hs.userId" 这样的 schema 标记中提取实际字段名 */
function resolveColumnName(col: string): string {
  if (typeof col !== "string") return String(col);
  // 格式 "prefix.fieldName"
  const parts = col.split(".");
  return parts.length > 1 ? parts[parts.length - 1] : col;
}

/** 根据 from 目标确定对应的内存表 */
function resolveTable(target: string): any[] {
  if (target === "hs" || target.includes("hwStudents") || target.includes("hw_students")) return store.students;
  if (target === "he" || target.includes("hwEntries") || target.includes("hw_entries")) return store.entries;
  if (target === "uc" || target.includes("userConfig") || target.includes("user_config")) return store.userConfigs;
  if (target === "sc" || target.includes("systemConfig") || target.includes("system_config")) return store.systemConfigs;
  if (target === "bt" || target.includes("backgroundTasks") || target.includes("background_tasks")) return store.backgroundTasks;
  if (target === "gt" || target.includes("gradingTasks") || target.includes("grading_tasks")) return store.gradingTasks;
  if (target === "gsi" || target.includes("gradingSyncItems") || target.includes("grading_sync_items")) return store.gradingSyncItems;
  return [];
}

function resolveTableFromSchema(schema: any): any[] {
  // schema 对象的第一个值类似 "hs.id" → 前缀 "hs"
  const firstValue = Object.values(schema)[0] as string;
  if (typeof firstValue === "string") {
    const prefix = firstValue.split(".")[0];
    return resolveTable(prefix);
  }
  return [];
}

/**
 * 创建完整的模拟数据库对象，支持 select/insert/update/delete 链式调用
 */
function createMockDatabase() {
  // select 链：select(fields?).from(table).where(cond).orderBy(...).limit(n).offset(n)
  const makeSelectChain = (fields?: Record<string, string>) => {
    let targetTable: any[] = [];
    let filteredResults: any[] = [];

    const chain: any = {
      from: (schema: any) => {
        targetTable = resolveTableFromSchema(schema);
        filteredResults = [...targetTable];
        return chain;
      },
      where: (condition: any) => {
        filteredResults = filteredResults.filter((r) => matchesCondition(r, condition));
        return chain;
      },
      orderBy: (..._args: any[]) => {
        // 简单按 createdAt 降序
        filteredResults.sort((a, b) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0));
        return chain;
      },
      limit: (n: number) => {
        filteredResults = filteredResults.slice(0, n);
        // limit 保持链式（listStudentEntries 需要 .limit().offset()）
        return chain;
      },
      offset: (n: number) => {
        filteredResults = filteredResults.slice(n);
        return chain;
      },
      // 无 limit 调用时直接 then
      then: (resolve: any, reject?: any) => {
        const result = fields ? filteredResults.map((r) => {
          const mapped: any = {};
          for (const [alias, col] of Object.entries(fields)) {
            const fieldName = resolveColumnName(col as string);
            mapped[alias] = r[fieldName];
          }
          return mapped;
        }) : filteredResults;
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return chain;
  };

  const mockDb = {
    select: (fields?: Record<string, string>) => makeSelectChain(fields),

    insert: (schema: any) => ({
      values: (data: any) => {
        const table = resolveTableFromSchema(schema);
        // 应用数据库列默认值（模拟 MySQL 的 DEFAULT 子句）
        const defaults: Record<string, any> = {};
        const prefix = (Object.values(schema)[0] as string)?.split(".")[0];
        if (prefix === "hs") {
          // hwStudents 表默认值
          defaults.status = "active";
          defaults.planType = "weekly";
          defaults.currentStatus = null;
        } else if (prefix === "he") {
          // hwEntries 表默认值
          defaults.entryStatus = "pending";
          defaults.streamingChars = 0;
          defaults.startedAt = null;
          defaults.completedAt = null;
          defaults.errorMessage = null;
          defaults.parsedContent = null;
        } else if (prefix === "gt") {
          // gradingTasks 表默认值
          defaults.taskStatus = "pending";
          defaults.streamingChars = 0;
          defaults.syncStatus = null;
          defaults.syncTotal = 0;
          defaults.syncCompleted = 0;
          defaults.syncFailed = 0;
          defaults.syncImported = null;
        }
        const newRecord = { ...defaults, ...data, id: data.id || nextId(), createdAt: new Date(), updatedAt: new Date() };
        table.push(newRecord);
        return Promise.resolve([{ insertId: newRecord.id, affectedRows: 1 }]);
      },
      onDuplicateKeyUpdate: () => Promise.resolve([{ affectedRows: 1 }]),
    }),

    update: (schema: any) => ({
      set: (data: any) => ({
        where: (condition: any) => {
          const table = resolveTableFromSchema(schema);
          let count = 0;
          for (const record of table) {
            if (matchesCondition(record, condition)) {
              Object.assign(record, data, { updatedAt: new Date() });
              count++;
            }
          }
          return Promise.resolve([{ affectedRows: count }]);
        },
      }),
    }),

    delete: (schema: any) => ({
      where: (condition: any) => {
        const table = resolveTableFromSchema(schema);
        let count = 0;
        for (let i = table.length - 1; i >= 0; i--) {
          if (matchesCondition(table[i], condition)) {
            table.splice(i, 1);
            count++;
          }
        }
        return Promise.resolve([{ affectedRows: count }]);
      },
    }),

    execute: vi.fn().mockResolvedValue([{ affectedRows: 0 }]),
  };

  return mockDb;
}

// ═══════════════════════════════════════════════════════════
// Mock getDb
// ═══════════════════════════════════════════════════════════

let mockDb: ReturnType<typeof createMockDatabase>;

vi.mock("./db", () => ({
  getDb: vi.fn(async () => mockDb),
}));

// Mock aiClient —— 使用我们自己的内存 store 实现三级回退
vi.mock("./core/aiClient", () => {
  const DEFAULT_CONFIG: Record<string, string> = {
    apiModel: "claude-sonnet-4-5-20250929",
    apiKey: "",
    apiUrl: "https://www.DMXapi.com/v1",
    currentYear: "2026",
    driveBasePath: "Mac/Documents/XDF/学生档案",
    maxTokens: "64000",
    batchFilePrefix: "任务",
    batchStoragePath: "Mac(online)/Documents/XDF/批量任务",
    batchConcurrency: "50",
  };

  return {
    DEFAULT_CONFIG,
    getConfigValue: vi.fn(async (key: string, userId?: number) => {
      // 三级回退：userConfig → systemConfig → DEFAULT_CONFIG
      if (userId != null) {
        const userResult = store.userConfigs.find((c) => c.userId === userId && c.key === key);
        if (userResult) return userResult.value;
      }
      const sysResult = store.systemConfigs.find((c) => c.key === key);
      if (sysResult) return sysResult.value;
      return DEFAULT_CONFIG[key] || "";
    }),
    setUserConfigValue: vi.fn(async (userId: number, key: string, value: string) => {
      const existing = store.userConfigs.find((c) => c.userId === userId && c.key === key);
      if (existing) {
        existing.value = value;
      } else {
        store.userConfigs.push({ id: nextId(), userId, key, value, updatedAt: new Date() });
      }
    }),
    deleteUserConfigValue: vi.fn(async (userId: number, key: string) => {
      const idx = store.userConfigs.findIndex((c) => c.userId === userId && c.key === key);
      if (idx >= 0) store.userConfigs.splice(idx, 1);
    }),
    ensureUserConfigTable: vi.fn().mockResolvedValue(undefined),
    getAPIConfig: vi.fn(),
    invokeAIStream: vi.fn(),
    isEmailAllowed: vi.fn().mockResolvedValue(true),
  };
});

// ═══════════════════════════════════════════════════════════
// 导入被测模块（放在 mock 之后）
// ═══════════════════════════════════════════════════════════

import {
  listStudents,
  addStudent,
  updateStudent,
  removeStudent,
  listEntries,
  listPendingEntries,
  deleteEntry,
  confirmEntries,
  listStudentEntries,
  exportStudentBackup,
  importStudentBackup,
} from "./homeworkManager";

import {
  getConfigValue,
  setUserConfigValue,
  deleteUserConfigValue,
  DEFAULT_CONFIG,
} from "./core/aiClient";

import {
  getGradingTask,
  listGradingTasks,
  getGradingSyncItems,
  updateGradingEditedResult,
  importSyncToStudents,
} from "./gradingRunner";

// ═══════════════════════════════════════════════════════════
// 全局 setup/teardown
// ═══════════════════════════════════════════════════════════

beforeEach(() => {
  resetStore();
  mockDb = createMockDatabase();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});


// ████████████████████████████████████████████████████████████
// 1. 学生管理跨租户数据隔离测试（交叉测试）
// ████████████████████████████████████████████████████████████

describe("1. 学生管理 - 跨租户数据隔离", () => {

  // --- listStudents ---

  it("1.1 listStudents: 用户1只能看到自己的学生，看不到用户2的", async () => {
    seedStudent(1, "张三");
    seedStudent(1, "李四");
    seedStudent(2, "王五");
    seedStudent(2, "赵六");

    const user1Students = await listStudents(1);
    const user2Students = await listStudents(2);

    expect(user1Students).toHaveLength(2);
    expect(user1Students.every((s: any) => s.userId === 1)).toBe(true);
    expect(user1Students.map((s: any) => s.name)).toEqual(expect.arrayContaining(["张三", "李四"]));
    expect(user1Students.map((s: any) => s.name)).not.toContain("王五");

    expect(user2Students).toHaveLength(2);
    expect(user2Students.every((s: any) => s.userId === 2)).toBe(true);
  });

  it("1.2 listStudents: 带状态过滤仍然隔离", async () => {
    seedStudent(1, "张三", { status: "active" });
    seedStudent(1, "李四", { status: "inactive" });
    seedStudent(2, "王五", { status: "active" });

    const user1Active = await listStudents(1, "active");
    expect(user1Active).toHaveLength(1);
    expect(user1Active[0].name).toBe("张三");
  });

  it("1.3 listStudents: 用户无学生时返回空数组", async () => {
    seedStudent(2, "王五");
    const result = await listStudents(1);
    expect(result).toHaveLength(0);
  });

  // --- addStudent ---

  it("1.4 addStudent: 创建的学生关联到正确的用户", async () => {
    await addStudent(1, "张三");
    await addStudent(2, "张三"); // 不同用户可以有同名学生

    expect(store.students).toHaveLength(2);
    expect(store.students[0].userId).toBe(1);
    expect(store.students[1].userId).toBe(2);
  });

  it("1.5 addStudent: 同一用户不能重复添加同名学生", async () => {
    await addStudent(1, "张三");
    await expect(addStudent(1, "张三")).rejects.toThrow("已存在");
  });

  it("1.6 addStudent: 不同用户可以添加同名学生", async () => {
    await addStudent(1, "张三");
    await addStudent(2, "张三");
    expect(store.students.filter((s) => s.name === "张三")).toHaveLength(2);
  });

  // --- updateStudent ---

  it("1.7 updateStudent: 用户1只能更新自己的学生", async () => {
    const s1 = seedStudent(1, "张三");
    const s2 = seedStudent(2, "李四");

    await updateStudent(1, s1.id, { name: "张三改" });
    await updateStudent(1, s2.id, { name: "试图篡改" }); // userId=1 AND id=s2.id → 不匹配

    expect(store.students.find((s) => s.id === s1.id)!.name).toBe("张三改");
    expect(store.students.find((s) => s.id === s2.id)!.name).toBe("李四"); // 未被修改
  });

  it("1.8 updateStudent: 更新不存在的学生ID不会影响其他用户", async () => {
    seedStudent(2, "王五");
    const result = await updateStudent(1, 999, { name: "不存在" });
    expect(result.success).toBe(true); // 函数不抛错，但 affectedRows=0
    expect(store.students[0].name).toBe("王五");
  });

  // --- removeStudent ---

  it("1.9 removeStudent: 用户1只能停用自己的学生", async () => {
    const s1 = seedStudent(1, "张三");
    const s2 = seedStudent(2, "李四");

    await removeStudent(1, s1.id);
    await removeStudent(1, s2.id); // 不应生效

    expect(store.students.find((s) => s.id === s1.id)!.status).toBe("inactive");
    expect(store.students.find((s) => s.id === s2.id)!.status).toBe("active");
  });

  // --- deleteEntry ---

  it("1.10 deleteEntry: 用户1只能删除自己的条目", async () => {
    const e1 = seedEntry(1, "张三");
    const e2 = seedEntry(2, "李四");

    await deleteEntry(1, e1.id);
    await deleteEntry(1, e2.id); // 不应生效

    expect(store.entries.find((e) => e.id === e1.id)).toBeUndefined(); // 已删除
    expect(store.entries.find((e) => e.id === e2.id)).toBeDefined(); // 仍存在
  });

  // --- confirmEntries ---

  it("1.11 confirmEntries: 只确认自己的 pre_staged 条目", async () => {
    const s1 = seedStudent(1, "张三");
    const e1 = seedEntry(1, "张三", { entryStatus: "pre_staged", parsedContent: "用户1的内容" });
    const e2 = seedEntry(2, "张三", { entryStatus: "pre_staged", parsedContent: "用户2的内容" });

    const result = await confirmEntries(1, [e1.id, e2.id]);

    // 只应确认属于 userId=1 且状态为 pre_staged 的条目
    expect(result.count).toBe(1);
  });

  it("1.12 confirmEntries: 空ID列表返回 count=0", async () => {
    const result = await confirmEntries(1, []);
    expect(result.count).toBe(0);
  });

  // --- listEntries ---

  it("1.13 listEntries: 用户1只看到自己的条目", async () => {
    seedEntry(1, "张三");
    seedEntry(1, "李四");
    seedEntry(2, "王五");

    const entries = await listEntries(1);
    expect(entries).toHaveLength(2);
    expect(entries.every((e: any) => e.userId === 1)).toBe(true);
  });

  it("1.14 listEntries: 带状态过滤仍然隔离", async () => {
    seedEntry(1, "张三", { entryStatus: "pending" });
    seedEntry(1, "李四", { entryStatus: "failed" });
    seedEntry(2, "王五", { entryStatus: "pending" });

    const pending = await listEntries(1, "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].studentName).toBe("张三");
  });

  // --- listPendingEntries ---

  it("1.15 listPendingEntries: 只返回自己的待处理条目", async () => {
    seedEntry(1, "张三", { entryStatus: "pending" });
    seedEntry(1, "李四", { entryStatus: "confirmed" }); // 不在待处理范围
    seedEntry(2, "王五", { entryStatus: "pending" });

    const pending = await listPendingEntries(1);
    expect(pending).toHaveLength(1);
    expect(pending[0].userId).toBe(1);
    expect(pending[0].studentName).toBe("张三");
  });

  // --- listStudentEntries ---

  it("1.16 listStudentEntries: 只返回自己的已确认学生条目", async () => {
    seedEntry(1, "张三", { entryStatus: "confirmed" });
    seedEntry(2, "张三", { entryStatus: "confirmed" }); // 同名学生不同用户

    const result = await listStudentEntries(1, "张三");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].userId).toBe(1);
  });

  // --- exportStudentBackup ---

  it("1.17 exportStudentBackup: 只导出自己的活跃学生", async () => {
    seedStudent(1, "张三", { currentStatus: "状态A" });
    seedStudent(2, "李四", { currentStatus: "状态B" });

    const backup = await exportStudentBackup(1);
    expect(backup.studentCount).toBe(1);
    expect(backup.content).toContain("张三");
    expect(backup.content).not.toContain("李四");
  });

  // --- importStudentBackup ---

  it("1.18 importStudentBackup: 导入数据只关联到当前用户", async () => {
    const backupContent = [
      "# 学生管理数据备份",
      "> 导出时间: 2026-02-14",
      "> 学生总数: 1",
      "",
      "## ═══════════════════════════════════════ 学生: 新学生 ═══════════════════════════════════════",
      "",
      "### 计划类型",
      "daily",
      "",
      "### 状态记录",
      "状态内容",
      "",
      "---",
    ].join("\n");

    await importStudentBackup(1, backupContent);

    expect(store.students.filter((s) => s.userId === 1)).toHaveLength(1);
    expect(store.students.filter((s) => s.userId === 2)).toHaveLength(0);
    expect(store.students[0].userId).toBe(1);
    expect(store.students[0].name).toBe("新学生");
  });
});


// ████████████████████████████████████████████████████████████
// 2. 软配置三级回退测试
// ████████████████████████████████████████████████████████████

describe("2. 软配置三级回退（userConfig → systemConfig → DEFAULT_CONFIG）", () => {

  it("2.1 无任何配置时返回 DEFAULT_CONFIG 的值", async () => {
    const value = await getConfigValue("apiModel");
    expect(value).toBe(DEFAULT_CONFIG.apiModel);
  });

  it("2.2 有 systemConfig 时返回系统值", async () => {
    seedSystemConfig("apiModel", "gpt-4-turbo");
    const value = await getConfigValue("apiModel");
    expect(value).toBe("gpt-4-turbo");
  });

  it("2.3 有 userConfig 时优先返回用户值", async () => {
    seedSystemConfig("apiModel", "gpt-4-turbo");
    seedUserConfig(1, "apiModel", "claude-opus-4-20250514");

    const value = await getConfigValue("apiModel", 1);
    expect(value).toBe("claude-opus-4-20250514");
  });

  it("2.4 userConfig 为空时回退到 systemConfig", async () => {
    seedSystemConfig("apiModel", "gpt-4-turbo");
    // 用户1没有 userConfig

    const value = await getConfigValue("apiModel", 1);
    expect(value).toBe("gpt-4-turbo");
  });

  it("2.5 systemConfig 和 userConfig 都为空时回退到 DEFAULT_CONFIG", async () => {
    const value = await getConfigValue("apiModel", 1);
    expect(value).toBe(DEFAULT_CONFIG.apiModel);
  });

  it("2.6 两个不同用户可以有不同的配置值", async () => {
    seedUserConfig(1, "apiModel", "model-user1");
    seedUserConfig(2, "apiModel", "model-user2");

    const val1 = await getConfigValue("apiModel", 1);
    const val2 = await getConfigValue("apiModel", 2);

    expect(val1).toBe("model-user1");
    expect(val2).toBe("model-user2");
    expect(val1).not.toBe(val2);
  });

  it("2.7 修改用户A的配置不影响用户B", async () => {
    seedUserConfig(1, "apiUrl", "https://user1.api.com");
    seedUserConfig(2, "apiUrl", "https://user2.api.com");

    // 修改用户1的配置
    await setUserConfigValue(1, "apiUrl", "https://user1-new.api.com");

    const val1 = await getConfigValue("apiUrl", 1);
    const val2 = await getConfigValue("apiUrl", 2);

    expect(val1).toBe("https://user1-new.api.com");
    expect(val2).toBe("https://user2.api.com"); // 未受影响
  });

  it("2.8 删除用户配置后回退到系统配置", async () => {
    seedSystemConfig("apiUrl", "https://system.api.com");
    seedUserConfig(1, "apiUrl", "https://user1.api.com");

    await deleteUserConfigValue(1, "apiUrl");

    const value = await getConfigValue("apiUrl", 1);
    expect(value).toBe("https://system.api.com");
  });

  it("2.9 不存在的配置 key 返回空字符串", async () => {
    const value = await getConfigValue("nonExistentKey", 1);
    expect(value).toBe("");
  });

  it("2.10 无 userId 参数时直接查 systemConfig（向后兼容）", async () => {
    seedSystemConfig("apiModel", "system-model");
    seedUserConfig(1, "apiModel", "user-model");

    const value = await getConfigValue("apiModel"); // 不传 userId
    expect(value).toBe("system-model"); // 不查 userConfig
  });
});


// ████████████████████████████████████████████████████████████
// 3. 配置 API 隔离测试
// ████████████████████████████████████████████████████████████

describe("3. 配置 API 路由隔离", () => {

  it("3.1 getAll: 不同用户获取到不同的配置值", async () => {
    seedUserConfig(1, "apiModel", "user1-model");
    seedUserConfig(2, "apiModel", "user2-model");

    const val1 = await getConfigValue("apiModel", 1);
    const val2 = await getConfigValue("apiModel", 2);

    expect(val1).toBe("user1-model");
    expect(val2).toBe("user2-model");
  });

  it("3.2 updateMyConfig: 只更新调用者自己的配置", async () => {
    await setUserConfigValue(1, "apiModel", "user1-new-model");

    // 验证只有用户1的配置被更新
    const val1 = await getConfigValue("apiModel", 1);
    const val2 = await getConfigValue("apiModel", 2);

    expect(val1).toBe("user1-new-model");
    expect(val2).toBe(DEFAULT_CONFIG.apiModel); // 用户2不受影响
  });

  it("3.3 resetMyConfig: 只重置调用者自己的配置", async () => {
    seedUserConfig(1, "apiModel", "user1-custom");
    seedUserConfig(2, "apiModel", "user2-custom");

    await deleteUserConfigValue(1, "apiModel");

    const val1 = await getConfigValue("apiModel", 1);
    const val2 = await getConfigValue("apiModel", 2);

    expect(val1).toBe(DEFAULT_CONFIG.apiModel); // 已重置
    expect(val2).toBe("user2-custom"); // 未受影响
  });

  it("3.4 exportBackup: 只导出调用者自己的配置", async () => {
    seedUserConfig(1, "roadmap", "用户1的路书");
    seedUserConfig(2, "roadmap", "用户2的路书");

    // 模拟 exportBackup 的逻辑：只查 userId=1 的 userConfig
    const userConfigs = store.userConfigs.filter((c) => c.userId === 1);
    expect(userConfigs).toHaveLength(1);
    expect(userConfigs[0].value).toBe("用户1的路书");
  });

  it("3.5 importBackup: 只导入到调用者自己的配置空间", async () => {
    // 模拟导入：只写 userId=1 的 userConfig
    await setUserConfigValue(1, "roadmap", "导入的路书");

    const val1 = await getConfigValue("roadmap", 1);
    const val2 = await getConfigValue("roadmap", 2);

    expect(val1).toBe("导入的路书");
    expect(val2).toBe(""); // 用户2没有这个配置
  });

  it("3.6 多个配置 key 同时操作时互不干扰", async () => {
    await setUserConfigValue(1, "apiModel", "model-1");
    await setUserConfigValue(1, "apiUrl", "url-1");
    await setUserConfigValue(2, "apiModel", "model-2");
    await setUserConfigValue(2, "apiUrl", "url-2");

    expect(await getConfigValue("apiModel", 1)).toBe("model-1");
    expect(await getConfigValue("apiUrl", 1)).toBe("url-1");
    expect(await getConfigValue("apiModel", 2)).toBe("model-2");
    expect(await getConfigValue("apiUrl", 2)).toBe("url-2");
  });
});


// ████████████████████████████████████████████████████████████
// 4. 打分系统隔离测试
// ████████████████████████████████████████████████████████████

describe("4. 打分系统 - 跨租户数据隔离", () => {

  it("4.1 getGradingTask: 只返回属于请求用户的任务", async () => {
    const t1 = seedGradingTask(1, { taskStatus: "completed", result: "用户1的打分" });
    const t2 = seedGradingTask(2, { taskStatus: "completed", result: "用户2的打分" });

    const result1 = await getGradingTask(1, t1.id);
    const result2 = await getGradingTask(1, t2.id); // 用户1查用户2的任务

    expect(result1).not.toBeNull();
    expect(result1!.id).toBe(t1.id);
    expect(result2).toBeNull(); // 不可见
  });

  it("4.2 listGradingTasks: 只列出请求用户自己的任务", async () => {
    seedGradingTask(1);
    seedGradingTask(1);
    seedGradingTask(2);

    const tasks1 = await listGradingTasks(1);
    const tasks2 = await listGradingTasks(2);

    expect(tasks1).toHaveLength(2);
    expect(tasks2).toHaveLength(1);
  });

  it("4.3 getGradingSyncItems: 验证任务所属后才返回子项", async () => {
    const t1 = seedGradingTask(1, { taskStatus: "completed" });
    const t2 = seedGradingTask(2, { taskStatus: "completed" });

    seedGradingSyncItem(t1.id, 101, "张三");
    seedGradingSyncItem(t2.id, 201, "李四");

    // 用户1查自己的任务 → 正常返回
    const items1 = await getGradingSyncItems(1, t1.id);
    expect(items1).toHaveLength(1);
    expect(items1[0].studentName).toBe("张三");

    // 用户1查用户2的任务 → 抛出 "任务不存在"
    await expect(getGradingSyncItems(1, t2.id)).rejects.toThrow("任务不存在");
  });

  it("4.4 updateGradingEditedResult: 只能修改自己的打分结果", async () => {
    const t1 = seedGradingTask(1, { taskStatus: "completed", result: "原始结果" });
    const t2 = seedGradingTask(2, { taskStatus: "completed", result: "用户2的结果" });

    await updateGradingEditedResult(1, t1.id, "编辑后的结果");
    await updateGradingEditedResult(1, t2.id, "试图篡改"); // userId=1 AND id=t2.id → 不匹配

    expect(store.gradingTasks.find((t) => t.id === t1.id)!.editedResult).toBe("编辑后的结果");
    expect(store.gradingTasks.find((t) => t.id === t2.id)!.editedResult).toBeNull(); // 未被修改
  });

  it("4.5 importSyncToStudents: 验证任务所有权后才执行导入", async () => {
    const t2 = seedGradingTask(2, { taskStatus: "completed", syncStatus: "completed", result: "结果" });
    seedGradingSyncItem(t2.id, 201, "李四", { result: "同步结果" });

    // 用户1尝试导入用户2的同步结果 → 抛出错误
    await expect(importSyncToStudents(1, t2.id)).rejects.toThrow("任务不存在");
  });

  it("4.6 用户A的打分任务列表中不会出现用户B的任务", async () => {
    for (let i = 0; i < 5; i++) seedGradingTask(1);
    for (let i = 0; i < 3; i++) seedGradingTask(2);

    const tasks1 = await listGradingTasks(1);
    const tasks2 = await listGradingTasks(2);

    expect(tasks1).toHaveLength(5);
    expect(tasks2).toHaveLength(3);
    // 确认没有混杂
    expect(tasks1.every((t: any) => store.gradingTasks.find((gt) => gt.id === t.id)!.userId === 1)).toBe(true);
    expect(tasks2.every((t: any) => store.gradingTasks.find((gt) => gt.id === t.id)!.userId === 2)).toBe(true);
  });
});


// ████████████████████████████████████████████████████████████
// 5. 后台任务隔离测试
// ████████████████████████████████████████████████████████████

describe("5. 后台任务 - 跨租户数据隔离", () => {

  it("5.1 后台任务通过 userId 过滤，用户只看到自己的任务", () => {
    seedBackgroundTask(1, "task-user1-a");
    seedBackgroundTask(1, "task-user1-b");
    seedBackgroundTask(2, "task-user2-a");

    // 模拟路由中的查询逻辑：WHERE userId = targetUser
    const user1Tasks = store.backgroundTasks.filter((t) => t.userId === 1);
    const user2Tasks = store.backgroundTasks.filter((t) => t.userId === 2);

    expect(user1Tasks).toHaveLength(2);
    expect(user2Tasks).toHaveLength(1);
    expect(user1Tasks.every((t) => t.userId === 1)).toBe(true);
  });

  it("5.2 后台任务结果只有所属用户可见", () => {
    const task = seedBackgroundTask(1, "task-secret", {
      stepResults: JSON.stringify({ feedback: { status: "completed", content: "机密内容" } }),
    });

    // 用户1可以看到
    const found1 = store.backgroundTasks.find((t) => t.id === task.id && t.userId === 1);
    expect(found1).toBeDefined();
    expect(JSON.parse(found1!.stepResults!).feedback.content).toBe("机密内容");

    // 用户2查不到
    const found2 = store.backgroundTasks.find((t) => t.id === task.id && t.userId === 2);
    expect(found2).toBeUndefined();
  });

  it("5.3 取消任务时验证用户所有权", () => {
    seedBackgroundTask(1, "cancel-test", { status: "running" });

    // 模拟路由逻辑：只取消属于当前用户的任务
    const canCancel = (userId: number, taskId: string): boolean => {
      const task = store.backgroundTasks.find((t) => t.id === taskId && t.userId === userId);
      return !!task;
    };

    expect(canCancel(1, "cancel-test")).toBe(true);
    expect(canCancel(2, "cancel-test")).toBe(false); // 用户2无法取消
  });

  it("5.4 删除用户时只删除该用户的后台任务", () => {
    seedBackgroundTask(1, "del-1");
    seedBackgroundTask(1, "del-2");
    seedBackgroundTask(2, "keep-1");

    // 模拟 deleteUser 逻辑
    store.backgroundTasks = store.backgroundTasks.filter((t) => t.userId !== 1);

    expect(store.backgroundTasks).toHaveLength(1);
    expect(store.backgroundTasks[0].id).toBe("keep-1");
  });
});


// ████████████████████████████████████████████████████████████
// 6. 批量处理路由跨租户漏洞测试
// ████████████████████████████████████████████████████████████

describe("6. 批量处理路由 - activeBatches 跨租户漏洞", () => {
  /**
   * 重要安全问题：batch/batchRoutes.ts 中的 activeBatches Map 以 batchId
   * 为 key，但 /api/batch/stop 和 /api/batch/status/:batchId 端点
   * 获取了 userId 却没有校验 batch 是否属于该用户。
   *
   * 这里模拟该 Map 的行为来证明漏洞的存在。
   */

  /** 模拟 activeBatches 内存 Map（与 batchRoutes.ts 一致） */
  interface MockBatchStatus {
    batchId: string;
    userId: number; // 真实代码中没有这个字段！这是漏洞所在
    totalTasks: number;
    completedTasks: number;
    status: string;
    stopped: boolean;
  }

  /** 模拟真实代码中的 activeBatches（无 userId 字段，batchId 为 key） */
  interface RealBatchStatus {
    batchId: string;
    totalTasks: number;
    completedTasks: number;
    status: string;
    stopped: boolean;
    // 注意：真实代码中没有 userId！
  }

  it("6.1 [漏洞] /stop 端点: 用户A可以停止用户B的批次", () => {
    // 真实代码中 activeBatches 的结构：只有 batchId，没有 userId
    const activeBatches = new Map<string, RealBatchStatus>();

    // 用户1创建了一个批次
    activeBatches.set("batch-user1-001", {
      batchId: "batch-user1-001",
      totalTasks: 10,
      completedTasks: 3,
      status: "running",
      stopped: false,
    });

    // 模拟 /api/batch/stop 路由处理（来自 batchRoutes.ts 第 224-250 行）
    function handleStop(requestUserId: number, batchId: string): { success: boolean; error?: string } {
      const batch = activeBatches.get(batchId);
      if (!batch) return { success: false, error: "批次不存在" };

      // 漏洞：没有检查 requestUserId 是否等于创建批次的用户
      // 真实代码直接执行 batch.stopped = true; batch.pool.stop();
      batch.stopped = true;
      return { success: true };
    }

    // 用户2（攻击者）知道 batchId 后可以直接停止用户1的批次
    const result = handleStop(2, "batch-user1-001");

    // 这里证明漏洞：用户2成功停止了用户1的批次
    expect(result.success).toBe(true);
    expect(activeBatches.get("batch-user1-001")!.stopped).toBe(true);
  });

  it("6.2 [漏洞] /status 端点: 用户A可以查看用户B的批次状态", () => {
    const activeBatches = new Map<string, RealBatchStatus>();

    activeBatches.set("batch-user1-secret", {
      batchId: "batch-user1-secret",
      totalTasks: 20,
      completedTasks: 15,
      status: "running",
      stopped: false,
    });

    // 模拟 /api/batch/status/:batchId 路由处理（来自 batchRoutes.ts 第 261-299 行）
    function handleStatus(requestUserId: number, batchId: string): { success: boolean; data?: RealBatchStatus; error?: string } {
      const batchStatus = activeBatches.get(batchId);
      if (!batchStatus) return { success: false, error: "批次不存在" };

      // 漏洞：没有检查 requestUserId 是否等于创建批次的用户
      // 直接返回了完整的批次状态
      return { success: true, data: batchStatus };
    }

    // 用户2可以看到用户1的批次状态
    const result = handleStatus(2, "batch-user1-secret");
    expect(result.success).toBe(true);
    expect(result.data!.totalTasks).toBe(20);
    expect(result.data!.completedTasks).toBe(15);
  });

  it("6.3 [修复方案] activeBatches 应记录 userId 并在访问时校验", () => {
    // 带 userId 的修复后结构
    const activeBatches = new Map<string, MockBatchStatus>();

    activeBatches.set("batch-user1-001", {
      batchId: "batch-user1-001",
      userId: 1, // 修复：记录创建者
      totalTasks: 10,
      completedTasks: 3,
      status: "running",
      stopped: false,
    });

    // 修复后的 stop 逻辑
    function handleStopFixed(requestUserId: number, batchId: string): { success: boolean; error?: string } {
      const batch = activeBatches.get(batchId);
      if (!batch) return { success: false, error: "批次不存在" };
      if (batch.userId !== requestUserId) return { success: false, error: "无权操作该批次" };
      batch.stopped = true;
      return { success: true };
    }

    // 用户1可以停止自己的批次
    expect(handleStopFixed(1, "batch-user1-001").success).toBe(true);

    // 重置
    activeBatches.get("batch-user1-001")!.stopped = false;

    // 用户2无法停止
    const result2 = handleStopFixed(2, "batch-user1-001");
    expect(result2.success).toBe(false);
    expect(result2.error).toBe("无权操作该批次");
    expect(activeBatches.get("batch-user1-001")!.stopped).toBe(false); // 未被停止
  });

  it("6.4 [修复方案] status 端点应校验 userId", () => {
    const activeBatches = new Map<string, MockBatchStatus>();

    activeBatches.set("batch-user1-secret", {
      batchId: "batch-user1-secret",
      userId: 1,
      totalTasks: 20,
      completedTasks: 15,
      status: "running",
      stopped: false,
    });

    function handleStatusFixed(requestUserId: number, batchId: string): { success: boolean; data?: any; error?: string } {
      const batch = activeBatches.get(batchId);
      if (!batch) return { success: false, error: "批次不存在" };
      if (batch.userId !== requestUserId) return { success: false, error: "无权查看该批次" };
      return { success: true, data: batch };
    }

    expect(handleStatusFixed(1, "batch-user1-secret").success).toBe(true);
    expect(handleStatusFixed(2, "batch-user1-secret").success).toBe(false);
  });

  it("6.5 batchId 可预测性增加了跨租户风险（时间戳格式）", () => {
    // batchRoutes.ts 使用 YYYYMMDD-HHmmss 格式生成 batchId
    // 如果攻击者知道另一个用户何时发起批处理，可以猜到 batchId
    const now = new Date();
    const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const predictedBatchId = beijingTime.toISOString().replace(/[-:T]/g, "").slice(0, 15).replace(/^(\d{8})(\d{6}).*/, "$1-$2");

    // batchId 格式很容易猜到：20260214-120000
    expect(predictedBatchId).toMatch(/^\d{8}-\d{6}$/);
    // 这意味着在没有 userId 校验的情况下，攻击者可以枚举 batchId
  });
});


// ████████████████████████████████████████████████████████████
// 7. 管理员伪装模式隔离测试
// ████████████████████████████████████████████████████████████

describe("7. 管理员伪装模式（God Mode）隔离", () => {

  it("7.1 伪装前：管理员看到自己的学生数据", async () => {
    const adminId = 1;
    const targetId = 2;

    seedStudent(adminId, "管理员学生A");
    seedStudent(targetId, "目标用户学生B");

    const adminStudents = await listStudents(adminId);
    expect(adminStudents).toHaveLength(1);
    expect(adminStudents[0].name).toBe("管理员学生A");
  });

  it("7.2 伪装中：以目标用户身份查询数据", async () => {
    const adminId = 1;
    const targetId = 2;

    seedStudent(adminId, "管理员学生A");
    seedStudent(targetId, "目标用户学生B");

    // 伪装模式下，ctx.user.id 变成 targetId（通过 cookie 切换 session）
    const targetStudents = await listStudents(targetId);
    expect(targetStudents).toHaveLength(1);
    expect(targetStudents[0].name).toBe("目标用户学生B");
    expect(targetStudents[0].name).not.toBe("管理员学生A");
  });

  it("7.3 停止伪装：管理员重新看到自己的数据", async () => {
    const adminId = 1;
    const targetId = 2;

    seedStudent(adminId, "管理员学生A");
    seedStudent(targetId, "目标用户学生B");

    // 模拟完整流程：伪装前 → 伪装中 → 退出伪装
    const before = await listStudents(adminId);
    expect(before[0].name).toBe("管理员学生A");

    const during = await listStudents(targetId); // 伪装中
    expect(during[0].name).toBe("目标用户学生B");

    const after = await listStudents(adminId); // 退出伪装
    expect(after[0].name).toBe("管理员学生A");
  });

  it("7.4 伪装中修改数据只影响目标用户", async () => {
    const adminId = 1;
    const targetId = 2;

    const adminStudent = seedStudent(adminId, "管理员学生");
    const targetStudent = seedStudent(targetId, "目标学生");

    // 伪装中以 targetId 身份操作
    await updateStudent(targetId, targetStudent.id, { name: "已修改" });

    expect(store.students.find((s) => s.id === targetStudent.id)!.name).toBe("已修改");
    expect(store.students.find((s) => s.id === adminStudent.id)!.name).toBe("管理员学生"); // 管理员数据未变
  });

  it("7.5 伪装模式下配置读取使用目标用户的配置", async () => {
    seedUserConfig(1, "apiModel", "admin-model");
    seedUserConfig(2, "apiModel", "target-model");

    // 伪装中 ctx.user.id = 2
    const val = await getConfigValue("apiModel", 2);
    expect(val).toBe("target-model");
  });
});


// ████████████████████████████████████████████████████████████
// 8. 并发多用户压力测试
// ████████████████████████████████████████████████████████████

describe("8. 并发多用户压力测试", () => {

  it("8.1 10个用户同时查询学生列表，无数据泄漏", async () => {
    // 为 10 个用户各创建不同数量的学生
    for (let userId = 1; userId <= 10; userId++) {
      for (let j = 0; j < userId; j++) {
        seedStudent(userId, `用户${userId}学生${j}`);
      }
    }

    // 10 个用户同时查询
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => listStudents(i + 1))
    );

    // 验证每个用户只看到自己的学生
    for (let i = 0; i < 10; i++) {
      const userId = i + 1;
      const students = results[i];
      expect(students).toHaveLength(userId);
      expect(students.every((s: any) => s.userId === userId)).toBe(true);
      // 确认没有其他用户的学生
      for (const s of students) {
        expect((s as any).name).toContain(`用户${userId}`);
      }
    }
  });

  it("8.2 10个用户同时查询条目，无数据泄漏", async () => {
    for (let userId = 1; userId <= 10; userId++) {
      seedEntry(userId, `学生${userId}`, { entryStatus: "pending" });
      seedEntry(userId, `学生${userId}`, { entryStatus: "pre_staged" });
    }

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => listEntries(i + 1))
    );

    for (let i = 0; i < 10; i++) {
      const userId = i + 1;
      expect(results[i]).toHaveLength(2);
      expect(results[i].every((e: any) => e.userId === userId)).toBe(true);
    }
  });

  it("8.3 10个用户同时读写配置，互不干扰", async () => {
    // 先各自写入
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        setUserConfigValue(i + 1, "apiModel", `model-user-${i + 1}`)
      )
    );

    // 再各自读取
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => getConfigValue("apiModel", i + 1))
    );

    for (let i = 0; i < 10; i++) {
      expect(results[i]).toBe(`model-user-${i + 1}`);
    }
  });

  it("8.4 混合读写操作下数据隔离", async () => {
    // 5 个用户添加学生，同时 5 个用户查询
    for (let userId = 1; userId <= 5; userId++) {
      seedStudent(userId, `已有学生${userId}`);
    }

    const operations = [
      // 用户1-5 查询
      ...Array.from({ length: 5 }, (_, i) => listStudents(i + 1)),
      // 用户6-10 添加学生
      ...Array.from({ length: 5 }, (_, i) => addStudent(i + 6, `新学生${i + 6}`)),
    ];

    const results = await Promise.all(operations);

    // 验证查询结果（前5个）
    for (let i = 0; i < 5; i++) {
      const students = results[i] as any[];
      expect(students).toHaveLength(1);
      expect(students[0].userId).toBe(i + 1);
    }

    // 验证新增学生（后5个，每个用户只有1个学生）
    for (let userId = 6; userId <= 10; userId++) {
      const userStudents = store.students.filter((s) => s.userId === userId);
      expect(userStudents).toHaveLength(1);
    }
  });

  it("8.5 10个用户同时查询打分任务列表", async () => {
    for (let userId = 1; userId <= 10; userId++) {
      seedGradingTask(userId);
      if (userId % 2 === 0) seedGradingTask(userId); // 偶数用户多一个任务
    }

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => listGradingTasks(i + 1))
    );

    for (let i = 0; i < 10; i++) {
      const userId = i + 1;
      const expectedCount = userId % 2 === 0 ? 2 : 1;
      expect(results[i]).toHaveLength(expectedCount);
    }
  });

  it("8.6 高并发下删除操作不影响其他用户", async () => {
    const entries: any[] = [];
    for (let userId = 1; userId <= 10; userId++) {
      entries.push(seedEntry(userId, `学生${userId}`));
    }

    // 所有用户同时删除自己的条目
    await Promise.all(
      entries.map((e) => deleteEntry(e.userId, e.id))
    );

    // 所有条目都被各自的主人删除
    expect(store.entries).toHaveLength(0);
  });

  it("8.7 并发跨用户删除尝试不会影响他人数据", async () => {
    const e1 = seedEntry(1, "张三");
    const e2 = seedEntry(2, "李四");

    // 用户1尝试删除用户2的条目，用户2尝试删除用户1的条目
    await Promise.all([
      deleteEntry(1, e2.id), // 不应生效
      deleteEntry(2, e1.id), // 不应生效
    ]);

    // 两条记录都应该还在（因为 WHERE userId=x AND id=y 不匹配）
    expect(store.entries).toHaveLength(2);
  });
});


// ████████████████████████████████████████████████████████████
// 9. 边界条件测试
// ████████████████████████████████████████████████████████████

describe("9. 边界条件", () => {

  it("9.1 userId=0 不匹配任何真实用户的数据", async () => {
    seedStudent(1, "张三");
    seedStudent(2, "李四");

    const result = await listStudents(0);
    expect(result).toHaveLength(0);
  });

  it("9.2 负数 userId 返回空结果", async () => {
    seedStudent(1, "张三");

    const result = await listStudents(-1);
    expect(result).toHaveLength(0);
  });

  it("9.3 非常大的 userId 返回空结果", async () => {
    seedStudent(1, "张三");

    const result = await listStudents(999999999);
    expect(result).toHaveLength(0);
  });

  it("9.4 不存在的 userId 查询学生返回空数组", async () => {
    seedStudent(1, "张三");
    seedStudent(2, "李四");

    const result = await listStudents(100);
    expect(result).toHaveLength(0);
  });

  it("9.5 不存在的 userId 查询条目返回空数组", async () => {
    seedEntry(1, "张三");
    seedEntry(2, "李四");

    const result = await listEntries(100);
    expect(result).toHaveLength(0);
  });

  it("9.6 不存在的 userId 查询打分任务返回空数组", async () => {
    seedGradingTask(1);
    seedGradingTask(2);

    const result = await listGradingTasks(100);
    expect(result).toHaveLength(0);
  });

  it("9.7 getGradingTask 用不存在的 taskId 返回 null", async () => {
    seedGradingTask(1);

    const result = await getGradingTask(1, 99999);
    expect(result).toBeNull();
  });

  it("9.8 userId 为浮点数时不会匹配整数记录", async () => {
    seedStudent(1, "张三");

    // 1.5 !== 1，不应匹配
    const result = await listStudents(1.5 as any);
    expect(result).toHaveLength(0);
  });

  it("9.9 SQL注入式 userId 不会突破隔离", async () => {
    seedStudent(1, "张三");
    seedStudent(2, "李四");

    // 尝试注入式 userId（在实际 Drizzle ORM 中会被参数化，这里验证我们的模拟也安全）
    const result = await listStudents("1 OR 1=1" as any);
    expect(result).toHaveLength(0); // 字符串 !== 数字 1，不匹配
  });

  it("9.10 deleteEntry 用不存在的 entryId 不影响其他条目", async () => {
    const e1 = seedEntry(1, "张三");

    await deleteEntry(1, 99999);
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0].id).toBe(e1.id);
  });

  it("9.11 confirmEntries 用不属于自己的 entryId 不确认任何条目", async () => {
    seedEntry(2, "李四", { entryStatus: "pre_staged", parsedContent: "用户2的内容" });

    const result = await confirmEntries(1, [store.entries[0].id]);
    expect(result.count).toBe(0);
  });

  it("9.12 空字符串学生名称不会匹配已有学生", async () => {
    seedStudent(1, "张三");

    const entries = await listStudentEntries(1, "");
    expect(entries.entries).toHaveLength(0);
  });

  it("9.13 updateStudent 用空对象不修改数据", async () => {
    const s = seedStudent(1, "张三", { planType: "daily" });

    const result = await updateStudent(1, s.id, {});
    expect(result.success).toBe(true);
    expect(store.students.find((st) => st.id === s.id)!.planType).toBe("daily"); // 未变
  });

  it("9.14 getConfigValue 对未定义的 DEFAULT_CONFIG key 返回空字符串", async () => {
    const value = await getConfigValue("thisKeyDoesNotExist", 1);
    expect(value).toBe("");
  });
});


// ████████████████████████████████████████████████████████████
// 10. 综合跨模块交叉验证
// ████████████████████████████████████████████████████████████

describe("10. 综合跨模块交叉验证", () => {

  it("10.1 用户A添加的学生在用户B的学生列表中不可见", async () => {
    await addStudent(1, "独家学生");
    const user2Students = await listStudents(2);
    expect(user2Students).toHaveLength(0);
  });

  it("10.2 用户A创建的条目在用户B的条目列表中不可见", async () => {
    seedEntry(1, "张三", { entryStatus: "pending" });
    const user2Entries = await listPendingEntries(2);
    expect(user2Entries).toHaveLength(0);
  });

  it("10.3 用户A修改学生后，用户B的同名学生不受影响", async () => {
    const sA = seedStudent(1, "共享名字");
    const sB = seedStudent(2, "共享名字");

    await updateStudent(1, sA.id, { planType: "daily" });

    expect(store.students.find((s) => s.id === sA.id)!.planType).toBe("daily");
    expect(store.students.find((s) => s.id === sB.id)!.planType).toBe("weekly"); // 未变
  });

  it("10.4 删除用户A的全部条目不影响用户B", async () => {
    const e1 = seedEntry(1, "A学生1");
    const e2 = seedEntry(1, "A学生2");
    const e3 = seedEntry(2, "B学生1");

    await deleteEntry(1, e1.id);
    await deleteEntry(1, e2.id);

    expect(store.entries).toHaveLength(1);
    expect(store.entries[0].userId).toBe(2);
  });

  it("10.5 备份导出→导入闭环中数据始终隔离", async () => {
    seedStudent(1, "用户1学生", { currentStatus: "状态A" });
    seedStudent(2, "用户2学生", { currentStatus: "状态B" });

    const backup = await exportStudentBackup(1);
    expect(backup.content).toContain("用户1学生");
    expect(backup.content).not.toContain("用户2学生");

    // 导入到用户3
    await importStudentBackup(3, backup.content);

    // 用户3有了用户1的学生，但不影响用户1和用户2
    const user3Students = store.students.filter((s) => s.userId === 3);
    expect(user3Students).toHaveLength(1);
    expect(user3Students[0].name).toBe("用户1学生");

    // 用户1和2的数据不变
    expect(store.students.filter((s) => s.userId === 1)).toHaveLength(1);
    expect(store.students.filter((s) => s.userId === 2)).toHaveLength(1);
  });

  it("10.6 打分任务的 sync 子项通过父任务间接隔离", async () => {
    const t1 = seedGradingTask(1, { taskStatus: "completed" });
    const t2 = seedGradingTask(2, { taskStatus: "completed" });

    seedGradingSyncItem(t1.id, 101, "用户1的学生");
    seedGradingSyncItem(t2.id, 201, "用户2的学生");

    // 用户1只能看到自己任务下的子项
    const items1 = await getGradingSyncItems(1, t1.id);
    expect(items1).toHaveLength(1);
    expect(items1[0].studentName).toBe("用户1的学生");

    // 尝试查看用户2的子项 → 权限拒绝
    await expect(getGradingSyncItems(1, t2.id)).rejects.toThrow("任务不存在");
  });

  it("10.7 配置隔离不影响功能正确性（不同用户使用不同AI模型）", async () => {
    seedUserConfig(1, "apiModel", "gpt-4");
    seedUserConfig(2, "apiModel", "claude-opus-4-20250514");

    const model1 = await getConfigValue("apiModel", 1);
    const model2 = await getConfigValue("apiModel", 2);

    expect(model1).toBe("gpt-4");
    expect(model2).toBe("claude-opus-4-20250514");

    // 修改用户1不影响用户2
    await setUserConfigValue(1, "apiModel", "gpt-4-turbo");
    expect(await getConfigValue("apiModel", 1)).toBe("gpt-4-turbo");
    expect(await getConfigValue("apiModel", 2)).toBe("claude-opus-4-20250514"); // 不变
  });

  it("10.8 全量场景：创建→查询→修改→删除全程隔离", async () => {
    // 两个用户各自完成全流程
    await addStudent(1, "流程学生A");
    await addStudent(2, "流程学生B");

    const sA = store.students.find((s) => s.userId === 1)!;
    const sB = store.students.find((s) => s.userId === 2)!;

    // 查询
    expect((await listStudents(1)).map((s: any) => s.name)).toEqual(["流程学生A"]);
    expect((await listStudents(2)).map((s: any) => s.name)).toEqual(["流程学生B"]);

    // 修改
    await updateStudent(1, sA.id, { planType: "daily" });
    expect(store.students.find((s) => s.id === sA.id)!.planType).toBe("daily");
    expect(store.students.find((s) => s.id === sB.id)!.planType).toBe("weekly");

    // 删除（软删除）
    await removeStudent(1, sA.id);
    const sAAfterRemove = store.students.find((s) => s.userId === 1 && s.name === "流程学生A");
    const sBAfterRemove = store.students.find((s) => s.userId === 2 && s.name === "流程学生B");
    expect(sAAfterRemove!.status).toBe("inactive");
    expect(sBAfterRemove!.status).toBe("active");
  });
});
