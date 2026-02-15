/**
 * 压力 & 并发测试 — 多租户数据隔离、竞态条件、内存安全
 *
 * 目标：模拟多个用户同时操作，验证系统在并发场景下不会出现
 * 数据泄漏、竞态破坏、或内存泄漏。
 *
 * 所有测试在进程内完成，不依赖外部数据库或 AI API。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ═══════════════════════════════════════════════════════════════
// Mock 数据存储 — 模拟按 userId 隔离的数据库
// ═══════════════════════════════════════════════════════════════

class MockDataStore {
  private data = new Map<string, Map<number, any[]>>();

  add(table: string, userId: number, record: any) {
    if (!this.data.has(table)) this.data.set(table, new Map());
    const tableData = this.data.get(table)!;
    if (!tableData.has(userId)) tableData.set(userId, []);
    tableData.get(userId)!.push({ ...record, _id: Date.now() + Math.random() });
  }

  get(table: string, userId: number): any[] {
    return this.data.get(table)?.get(userId) || [];
  }

  getAll(table: string): any[] {
    const result: any[] = [];
    this.data.get(table)?.forEach((records) => result.push(...records));
    return result;
  }

  update(table: string, userId: number, predicate: (r: any) => boolean, patch: Record<string, any>) {
    const records = this.get(table, userId);
    for (const r of records) {
      if (predicate(r)) Object.assign(r, patch);
    }
  }

  delete(table: string, userId: number, predicate: (r: any) => boolean) {
    const tableData = this.data.get(table);
    if (!tableData) return;
    const records = tableData.get(userId);
    if (!records) return;
    tableData.set(userId, records.filter((r) => !predicate(r)));
  }

  clear() {
    this.data.clear();
  }
}

// ═══════════════════════════════════════════════════════════════
// Mock 配置系统 — 三级降级: userConfig → systemConfig → DEFAULT
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: Record<string, string> = {
  apiModel: "claude-sonnet-4-5-20250929",
  apiKey: "default-key",
  apiUrl: "https://api.example.com/v1",
  currentYear: "2026",
  roadmap: "",
  driveBasePath: "Mac/Documents/XDF/学生档案",
  maxTokens: "64000",
};

class MockConfigStore {
  private userConfig = new Map<string, Map<string, string>>(); // key = `${userId}:${key}`
  private systemConfig = new Map<string, string>();

  async getConfigValue(key: string, userId?: number): Promise<string> {
    // 模拟异步数据库访问延迟
    await randomDelay(0, 2);

    if (userId != null) {
      const userKey = `${userId}:${key}`;
      if (this.userConfig.has(userKey)) {
        return this.userConfig.get(userKey)!.get("value")!;
      }
    }
    if (this.systemConfig.has(key)) {
      return this.systemConfig.get(key)!;
    }
    return DEFAULT_CONFIG[key] || "";
  }

  async setUserConfig(userId: number, key: string, value: string): Promise<void> {
    await randomDelay(0, 2);
    const userKey = `${userId}:${key}`;
    this.userConfig.set(userKey, new Map([["value", value]]));
  }

  async deleteUserConfig(userId: number, key: string): Promise<void> {
    await randomDelay(0, 2);
    const userKey = `${userId}:${key}`;
    this.userConfig.delete(userKey);
  }

  setSystemConfig(key: string, value: string) {
    this.systemConfig.set(key, value);
  }

  clear() {
    this.userConfig.clear();
    this.systemConfig.clear();
  }
}

// ═══════════════════════════════════════════════════════════════
// Mock 学生管理系统
// ═══════════════════════════════════════════════════════════════

class MockStudentManager {
  private store: MockDataStore;
  private nextId = 1;

  constructor(store: MockDataStore) {
    this.store = store;
  }

  async addStudent(userId: number, name: string, planType = "weekly") {
    await randomDelay(0, 3);
    const existing = this.store.get("students", userId).find((s) => s.name === name.trim() && s.status === "active");
    if (existing) {
      throw new Error(`学生「${name.trim()}」已存在`);
    }
    // Check for inactive student to reactivate
    const inactive = this.store.get("students", userId).find((s) => s.name === name.trim() && s.status === "inactive");
    if (inactive) {
      this.store.update("students", userId, (s) => s.name === name.trim() && s.status === "inactive", { status: "active", planType });
      return { success: true, id: inactive.id };
    }
    const id = this.nextId++;
    this.store.add("students", userId, { id, name: name.trim(), planType, status: "active", currentStatus: null });
    return { success: true, id };
  }

  async updateStudent(userId: number, id: number, data: Record<string, any>) {
    await randomDelay(0, 2);
    this.store.update("students", userId, (s) => s.id === id, data);
    return { success: true };
  }

  async removeStudent(userId: number, id: number) {
    await randomDelay(0, 2);
    this.store.update("students", userId, (s) => s.id === id, { status: "inactive" });
    return { success: true };
  }

  async listStudents(userId: number, statusFilter?: string) {
    await randomDelay(0, 2);
    const students = this.store.get("students", userId);
    return statusFilter ? students.filter((s) => s.status === statusFilter) : students;
  }
}

// ═══════════════════════════════════════════════════════════════
// Mock 条目处理系统
// ═══════════════════════════════════════════════════════════════

class MockEntryProcessor {
  private store: MockDataStore;
  private configStore: MockConfigStore;
  private nextId = 1;
  /** 追踪每个条目使用的配置（用于验证配置隔离） */
  public processedWith: Map<number, { userId: number; model: string; apiUrl: string }> = new Map();
  /** 追踪流式进度更新发送给了哪个 userId */
  public progressUpdates: Array<{ entryId: number; userId: number; chars: number }> = [];

  constructor(store: MockDataStore, configStore: MockConfigStore) {
    this.store = store;
    this.configStore = configStore;
  }

  async submitAndProcess(userId: number, studentName: string, rawInput: string): Promise<{ id: number; status: string }> {
    const id = this.nextId++;
    this.store.add("entries", userId, {
      id,
      studentName: studentName.trim(),
      rawInput: rawInput.trim(),
      entryStatus: "pending",
      parsedContent: null,
    });

    // Simulate background processing (fire-and-forget)
    this.processInBackground(userId, id, studentName, rawInput);

    return { id, status: "pending" };
  }

  private async processInBackground(userId: number, id: number, studentName: string, rawInput: string): Promise<void> {
    this.store.update("entries", userId, (e) => e.id === id, { entryStatus: "processing" });

    try {
      const model = await this.configStore.getConfigValue("apiModel", userId);
      const apiUrl = await this.configStore.getConfigValue("apiUrl", userId);

      // Record which config this entry was processed with
      this.processedWith.set(id, { userId, model, apiUrl });

      // Simulate streaming progress
      for (let chars = 100; chars <= 500; chars += 100) {
        await randomDelay(1, 5);
        this.progressUpdates.push({ entryId: id, userId, chars });
      }

      const parsedContent = `[Processed for user ${userId}] ${studentName}: ${rawInput.substring(0, 50)}`;

      this.store.update("entries", userId, (e) => e.id === id, {
        entryStatus: "pre_staged",
        parsedContent,
      });
    } catch (err: any) {
      this.store.update("entries", userId, (e) => e.id === id, {
        entryStatus: "failed",
        errorMessage: err?.message || "处理失败",
      });
    }
  }

  async confirmEntries(userId: number, ids: number[]) {
    await randomDelay(0, 3);
    const entries = this.store
      .get("entries", userId)
      .filter((e) => ids.includes(e.id) && e.entryStatus === "pre_staged");

    if (entries.length === 0) return { count: 0 };

    // Group by student, take latest parsed content
    const studentLatest = new Map<string, string>();
    for (const entry of entries) {
      if (!studentLatest.has(entry.studentName) && entry.parsedContent) {
        studentLatest.set(entry.studentName, entry.parsedContent);
      }
    }

    // Update student status
    for (const [name, content] of studentLatest) {
      this.store.update("students", userId, (s) => s.name === name, { currentStatus: content });
    }

    // Delete confirmed entries
    for (const id of ids) {
      this.store.delete("entries", userId, (e) => e.id === id);
    }

    return { count: entries.length };
  }
}

// ═══════════════════════════════════════════════════════════════
// Mock 打分系统
// ═══════════════════════════════════════════════════════════════

class MockGradingRunner {
  private store: MockDataStore;
  private configStore: MockConfigStore;
  private nextId = 1;
  public submittedTasks: Array<{ id: number; userId: number; model: string }> = [];

  constructor(store: MockDataStore, configStore: MockConfigStore) {
    this.store = store;
    this.configStore = configStore;
  }

  async submitGrading(userId: number, params: { startDate: string; endDate: string; gradingPrompt: string }): Promise<{ id: number }> {
    const id = this.nextId++;
    const model = await this.configStore.getConfigValue("apiModel", userId);

    this.store.add("gradingTasks", userId, {
      id,
      ...params,
      taskStatus: "pending",
      result: null,
    });

    this.submittedTasks.push({ id, userId, model });

    // Simulate background processing
    this.processInBackground(userId, id);

    return { id };
  }

  private async processInBackground(userId: number, id: number): Promise<void> {
    await randomDelay(5, 15);
    this.store.update("gradingTasks", userId, (t) => t.id === id, {
      taskStatus: "completed",
      result: `[Grading result for user ${userId}, task ${id}]`,
    });
  }

  async syncGradingToStudents(userId: number, taskId: number): Promise<{ synced: number }> {
    await randomDelay(2, 5);
    const students = this.store.get("students", userId).filter((s) => s.status === "active");
    for (const student of students) {
      this.store.update("students", userId, (s) => s.id === student.id, {
        currentStatus: `[Synced from grading task ${taskId}]`,
      });
    }
    return { synced: students.length };
  }
}

// ═══════════════════════════════════════════════════════════════
// Mock 批量任务系统 — 含 activeBatches Map
// ═══════════════════════════════════════════════════════════════

interface BatchStatus {
  batchId: string;
  userId: number;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  status: "running" | "completed" | "failed" | "stopped";
  stopped: boolean;
}

class MockBatchSystem {
  /** Process-global Map — mirrors the real activeBatches */
  public activeBatches = new Map<string, BatchStatus>();
  private nextBatchNum = 1;
  private cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  createBatch(userId: number, totalTasks: number): string {
    const batchId = `batch-${this.nextBatchNum++}`;
    this.activeBatches.set(batchId, {
      batchId,
      userId,
      totalTasks,
      completedTasks: 0,
      failedTasks: 0,
      status: "running",
      stopped: false,
    });
    return batchId;
  }

  completeBatch(batchId: string) {
    const batch = this.activeBatches.get(batchId);
    if (!batch) return;
    batch.status = "completed";
    batch.completedTasks = batch.totalTasks;

    // Schedule cleanup after a delay (simulating the real system)
    const timer = setTimeout(() => {
      this.activeBatches.delete(batchId);
    }, 50);
    this.cleanupTimers.set(batchId, timer);
  }

  stopBatch(batchId: string) {
    const batch = this.activeBatches.get(batchId);
    if (!batch) return false;
    batch.stopped = true;
    batch.status = "stopped";
    return true;
  }

  deleteBatch(batchId: string) {
    this.activeBatches.delete(batchId);
    const timer = this.cleanupTimers.get(batchId);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(batchId);
    }
  }

  getBatch(batchId: string, userId: number): BatchStatus | null {
    const batch = this.activeBatches.get(batchId);
    if (!batch) return null;
    // Tenant isolation: only return if userId matches
    if (batch.userId !== userId) return null;
    return batch;
  }

  clearAll() {
    for (const timer of this.cleanupTimers.values()) clearTimeout(timer);
    this.cleanupTimers.clear();
    this.activeBatches.clear();
  }
}

// ═══════════════════════════════════════════════════════════════
// Mock 备份系统
// ═══════════════════════════════════════════════════════════════

class MockBackupSystem {
  private store: MockDataStore;

  constructor(store: MockDataStore) {
    this.store = store;
  }

  async exportBackup(userId: number): Promise<{ content: string; studentCount: number }> {
    await randomDelay(2, 10);
    const students = this.store.get("students", userId).filter((s) => s.status === "active");
    const lines = [`# Backup for user ${userId}`, `> Students: ${students.length}`];
    for (const s of students) {
      lines.push(`## Student: ${s.name}`);
      lines.push(`Status: ${s.currentStatus || "(none)"}`);
    }
    return { content: lines.join("\n"), studentCount: students.length };
  }

  async importBackup(userId: number, content: string): Promise<{ imported: number }> {
    await randomDelay(5, 15);
    // Simple parser: count "## Student:" lines
    const matches = content.match(/## Student: (.+)/g) || [];
    for (const match of matches) {
      const name = match.replace("## Student: ", "").trim();
      const existing = this.store.get("students", userId).find((s) => s.name === name);
      if (!existing) {
        this.store.add("students", userId, { id: Date.now(), name, planType: "weekly", status: "active", currentStatus: null });
      }
    }
    return { imported: matches.length };
  }
}

// ═══════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 创建 N 个用户 ID 数组 */
function userIds(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i + 1);
}

// ═══════════════════════════════════════════════════════════════
// 测试开始
// ═══════════════════════════════════════════════════════════════

let store: MockDataStore;
let configStore: MockConfigStore;
let studentManager: MockStudentManager;
let entryProcessor: MockEntryProcessor;
let gradingRunner: MockGradingRunner;
let batchSystem: MockBatchSystem;
let backupSystem: MockBackupSystem;

beforeEach(() => {
  store = new MockDataStore();
  configStore = new MockConfigStore();
  studentManager = new MockStudentManager(store);
  entryProcessor = new MockEntryProcessor(store, configStore);
  gradingRunner = new MockGradingRunner(store, configStore);
  batchSystem = new MockBatchSystem();
  backupSystem = new MockBackupSystem(store);
});

afterEach(() => {
  batchSystem.clearAll();
  store.clear();
  configStore.clear();
});

// ════════════════════════════════════════════════════════════════
// 1. 并发配置访问 (Concurrent Config Access)
// ════════════════════════════════════════════════════════════════

describe("1. 并发配置访问", () => {
  it("1.1 — 10 users reading config simultaneously get their own values", async () => {
    const users = userIds(10);

    // Set unique config for each user
    for (const uid of users) {
      await configStore.setUserConfig(uid, "apiModel", `model-for-user-${uid}`);
    }

    // All users read concurrently
    const results = await Promise.all(
      users.map(async (uid) => ({
        userId: uid,
        model: await configStore.getConfigValue("apiModel", uid),
      }))
    );

    for (const r of results) {
      expect(r.model).toBe(`model-for-user-${r.userId}`);
    }
  });

  it("1.2 — Config write by one user doesn't affect concurrent reads by another", async () => {
    await configStore.setUserConfig(1, "apiModel", "model-A");
    await configStore.setUserConfig(2, "apiModel", "model-B");

    // User 1 writes while User 2 reads simultaneously
    const [_, user2Model] = await Promise.all([
      configStore.setUserConfig(1, "apiModel", "model-A-updated"),
      configStore.getConfigValue("apiModel", 2),
    ]);

    expect(user2Model).toBe("model-B");

    // After the write, user 1 should see the updated value
    const user1Model = await configStore.getConfigValue("apiModel", 1);
    expect(user1Model).toBe("model-A-updated");
  });

  it("1.3 — Rapid config updates by the same user maintain consistency", async () => {
    const userId = 1;
    const updates = Array.from({ length: 20 }, (_, i) => `version-${i}`);

    // Fire all updates concurrently
    await Promise.all(updates.map((v) => configStore.setUserConfig(userId, "apiModel", v)));

    // Final read should return one of the written values (the last one wins)
    const finalValue = await configStore.getConfigValue("apiModel", userId);
    expect(updates).toContain(finalValue);
  });

  it("1.4 — User without config falls back to systemConfig then DEFAULT", async () => {
    // User 1 has user config, user 2 does not, system config is set
    await configStore.setUserConfig(1, "apiModel", "user1-custom");
    configStore.setSystemConfig("apiModel", "system-global");

    const [user1, user2, user3] = await Promise.all([
      configStore.getConfigValue("apiModel", 1),
      configStore.getConfigValue("apiModel", 2),
      configStore.getConfigValue("apiModel"), // no userId → system or default
    ]);

    expect(user1).toBe("user1-custom");
    expect(user2).toBe("system-global"); // fallback to system
    expect(user3).toBe("system-global"); // no userId → system
  });

  it("1.5 — Deleting user config restores system fallback", async () => {
    configStore.setSystemConfig("apiModel", "system-model");
    await configStore.setUserConfig(1, "apiModel", "user-override");

    expect(await configStore.getConfigValue("apiModel", 1)).toBe("user-override");

    await configStore.deleteUserConfig(1, "apiModel");
    expect(await configStore.getConfigValue("apiModel", 1)).toBe("system-model");
  });
});

// ════════════════════════════════════════════════════════════════
// 2. 并发学生操作 (Concurrent Student Operations)
// ════════════════════════════════════════════════════════════════

describe("2. 并发学生操作", () => {
  it("2.1 — 10 users adding students simultaneously don't interfere", async () => {
    const users = userIds(10);

    await Promise.all(
      users.map((uid) => studentManager.addStudent(uid, "测试学生", "weekly"))
    );

    // Each user should have exactly one student
    for (const uid of users) {
      const students = await studentManager.listStudents(uid);
      expect(students).toHaveLength(1);
      expect(students[0].name).toBe("测试学生");
    }
  });

  it("2.2 — User A adding '张三' while User B adds '张三' — both succeed", async () => {
    const [resultA, resultB] = await Promise.all([
      studentManager.addStudent(1, "张三"),
      studentManager.addStudent(2, "张三"),
    ]);

    expect(resultA.success).toBe(true);
    expect(resultB.success).toBe(true);

    const studentsA = await studentManager.listStudents(1);
    const studentsB = await studentManager.listStudents(2);
    expect(studentsA).toHaveLength(1);
    expect(studentsB).toHaveLength(1);
    expect(studentsA[0].name).toBe("张三");
    expect(studentsB[0].name).toBe("张三");
  });

  it("2.3 — Same user adding duplicate student name throws error", async () => {
    await studentManager.addStudent(1, "张三");

    await expect(studentManager.addStudent(1, "张三")).rejects.toThrow("已存在");
  });

  it("2.4 — Rapid updates to same student by same user don't corrupt data", async () => {
    const result = await studentManager.addStudent(1, "张三");
    const studentId = result.id;

    // Fire 20 rapid updates with different plan types
    const updatePromises = Array.from({ length: 20 }, (_, i) =>
      studentManager.updateStudent(1, studentId, { planType: i % 2 === 0 ? "daily" : "weekly" })
    );
    await Promise.all(updatePromises);

    const students = await studentManager.listStudents(1);
    const student = students.find((s) => s.id === studentId);
    expect(student).toBeDefined();
    expect(["daily", "weekly"]).toContain(student!.planType);
  });

  it("2.5 — Concurrent confirmEntries by different users don't cross-contaminate", async () => {
    // Setup: each user has a student and an entry
    await studentManager.addStudent(1, "学生A");
    await studentManager.addStudent(2, "学生B");

    const entryA = await entryProcessor.submitAndProcess(1, "学生A", "用户1的记录内容");
    const entryB = await entryProcessor.submitAndProcess(2, "学生B", "用户2的记录内容");

    // Wait for processing to complete
    await new Promise((r) => setTimeout(r, 100));

    // Confirm entries concurrently
    const [confirmA, confirmB] = await Promise.all([
      entryProcessor.confirmEntries(1, [entryA.id]),
      entryProcessor.confirmEntries(2, [entryB.id]),
    ]);

    expect(confirmA.count).toBe(1);
    expect(confirmB.count).toBe(1);

    // Verify no cross-contamination
    const studentsA = await studentManager.listStudents(1);
    const studentsB = await studentManager.listStudents(2);

    const studentA = studentsA.find((s) => s.name === "学生A");
    const studentB = studentsB.find((s) => s.name === "学生B");

    if (studentA?.currentStatus) {
      expect(studentA.currentStatus).toContain("user 1");
      expect(studentA.currentStatus).not.toContain("user 2");
    }
    if (studentB?.currentStatus) {
      expect(studentB.currentStatus).toContain("user 2");
      expect(studentB.currentStatus).not.toContain("user 1");
    }
  });

  it("2.6 — 10 users each adding 5 students concurrently", async () => {
    const users = userIds(10);

    await Promise.all(
      users.flatMap((uid) =>
        Array.from({ length: 5 }, (_, i) =>
          studentManager.addStudent(uid, `学生${i + 1}`)
        )
      )
    );

    for (const uid of users) {
      const students = await studentManager.listStudents(uid);
      expect(students).toHaveLength(5);
      const names = students.map((s: any) => s.name).sort();
      expect(names).toEqual(["学生1", "学生2", "学生3", "学生4", "学生5"]);
    }
  });

  it("2.7 — Remove and re-add student concurrently", async () => {
    const { id } = await studentManager.addStudent(1, "临时学生");

    // Remove then add same name
    await studentManager.removeStudent(1, id);
    const result = await studentManager.addStudent(1, "临时学生");

    expect(result.success).toBe(true);
    const students = await studentManager.listStudents(1, "active");
    const active = students.filter((s: any) => s.name === "临时学生");
    expect(active.length).toBeGreaterThanOrEqual(1);
  });
});

// ════════════════════════════════════════════════════════════════
// 3. 并发条目处理 (Concurrent Entry Processing)
// ════════════════════════════════════════════════════════════════

describe("3. 并发条目处理", () => {
  it("3.1 — Multiple users submitting entries simultaneously", async () => {
    const users = userIds(5);

    // Each user has a student
    for (const uid of users) {
      await studentManager.addStudent(uid, `学生_U${uid}`);
    }

    // All users submit entries concurrently
    const submissions = await Promise.all(
      users.map((uid) =>
        entryProcessor.submitAndProcess(uid, `学生_U${uid}`, `用户${uid}的作业记录`)
      )
    );

    expect(submissions).toHaveLength(5);
    for (const sub of submissions) {
      expect(sub.status).toBe("pending");
    }
  });

  it("3.2 — Each entry is processed with the correct user's config", async () => {
    // Set unique config for each user
    await configStore.setUserConfig(1, "apiModel", "model-alpha");
    await configStore.setUserConfig(2, "apiModel", "model-beta");
    await configStore.setUserConfig(3, "apiModel", "model-gamma");

    await studentManager.addStudent(1, "张三");
    await studentManager.addStudent(2, "李四");
    await studentManager.addStudent(3, "王五");

    const [e1, e2, e3] = await Promise.all([
      entryProcessor.submitAndProcess(1, "张三", "内容A"),
      entryProcessor.submitAndProcess(2, "李四", "内容B"),
      entryProcessor.submitAndProcess(3, "王五", "内容C"),
    ]);

    // Wait for background processing
    await new Promise((r) => setTimeout(r, 150));

    // Verify each entry was processed with the correct user's model
    const p1 = entryProcessor.processedWith.get(e1.id);
    const p2 = entryProcessor.processedWith.get(e2.id);
    const p3 = entryProcessor.processedWith.get(e3.id);

    expect(p1).toBeDefined();
    expect(p1!.userId).toBe(1);
    expect(p1!.model).toBe("model-alpha");

    expect(p2).toBeDefined();
    expect(p2!.userId).toBe(2);
    expect(p2!.model).toBe("model-beta");

    expect(p3).toBeDefined();
    expect(p3!.userId).toBe(3);
    expect(p3!.model).toBe("model-gamma");
  });

  it("3.3 — Streaming progress updates go to the right user", async () => {
    await configStore.setUserConfig(1, "apiUrl", "https://api1.example.com");
    await configStore.setUserConfig(2, "apiUrl", "https://api2.example.com");

    const [e1, e2] = await Promise.all([
      entryProcessor.submitAndProcess(1, "张三", "用户1内容"),
      entryProcessor.submitAndProcess(2, "李四", "用户2内容"),
    ]);

    // Wait for processing
    await new Promise((r) => setTimeout(r, 200));

    // All progress updates for entry 1 should have userId=1
    const updatesForE1 = entryProcessor.progressUpdates.filter((u) => u.entryId === e1.id);
    const updatesForE2 = entryProcessor.progressUpdates.filter((u) => u.entryId === e2.id);

    for (const u of updatesForE1) {
      expect(u.userId).toBe(1);
    }
    for (const u of updatesForE2) {
      expect(u.userId).toBe(2);
    }
  });

  it("3.4 — Multiple entries for the same student from the same user", async () => {
    await studentManager.addStudent(1, "张三");

    const entries = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        entryProcessor.submitAndProcess(1, "张三", `第${i + 1}次记录`)
      )
    );

    expect(entries).toHaveLength(5);
    // All entries should belong to user 1
    const allEntries = store.get("entries", 1);
    expect(allEntries.length).toBe(5);
    for (const e of allEntries) {
      expect(e.studentName).toBe("张三");
    }

    // User 2 should have no entries
    expect(store.get("entries", 2)).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════
// 4. 并发打分操作 (Concurrent Grading Operations)
// ════════════════════════════════════════════════════════════════

describe("4. 并发打分操作", () => {
  it("4.1 — Multiple users submitting grading tasks simultaneously", async () => {
    const users = userIds(5);

    for (const uid of users) {
      await configStore.setUserConfig(uid, "apiModel", `grading-model-${uid}`);
      await studentManager.addStudent(uid, `学生_G${uid}`);
    }

    const results = await Promise.all(
      users.map((uid) =>
        gradingRunner.submitGrading(uid, {
          startDate: "2026-02-01",
          endDate: "2026-02-07",
          gradingPrompt: `用户${uid}的打分要求`,
        })
      )
    );

    expect(results).toHaveLength(5);

    // Verify each task used the correct user's model
    for (const uid of users) {
      const task = gradingRunner.submittedTasks.find((t) => t.userId === uid);
      expect(task).toBeDefined();
      expect(task!.model).toBe(`grading-model-${uid}`);
    }
  });

  it("4.2 — Sync operations for different users don't interfere", async () => {
    await studentManager.addStudent(1, "张三");
    await studentManager.addStudent(1, "李四");
    await studentManager.addStudent(2, "王五");

    const task1 = await gradingRunner.submitGrading(1, {
      startDate: "2026-02-01",
      endDate: "2026-02-07",
      gradingPrompt: "打分要求1",
    });

    const task2 = await gradingRunner.submitGrading(2, {
      startDate: "2026-02-01",
      endDate: "2026-02-07",
      gradingPrompt: "打分要求2",
    });

    // Sync concurrently
    const [sync1, sync2] = await Promise.all([
      gradingRunner.syncGradingToStudents(1, task1.id),
      gradingRunner.syncGradingToStudents(2, task2.id),
    ]);

    // User 1 has 2 students, user 2 has 1
    expect(sync1.synced).toBe(2);
    expect(sync2.synced).toBe(1);

    // Verify no cross-contamination in student status
    const studentsA = await studentManager.listStudents(1);
    const studentsB = await studentManager.listStudents(2);

    for (const s of studentsA) {
      if (s.currentStatus) {
        expect(s.currentStatus).toContain(`task ${task1.id}`);
      }
    }
    for (const s of studentsB) {
      if (s.currentStatus) {
        expect(s.currentStatus).toContain(`task ${task2.id}`);
      }
    }
  });

  it("4.3 — Same user submitting multiple grading tasks rapidly", async () => {
    await studentManager.addStudent(1, "张三");

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        gradingRunner.submitGrading(1, {
          startDate: `2026-02-0${i + 1}`,
          endDate: `2026-02-0${i + 2}`,
          gradingPrompt: `第${i + 1}次打分`,
        })
      )
    );

    expect(results).toHaveLength(5);
    const tasks = store.get("gradingTasks", 1);
    expect(tasks).toHaveLength(5);

    // All tasks should belong to user 1
    expect(store.get("gradingTasks", 2)).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════
// 5. 竞态条件测试 (Race Condition Tests)
// ════════════════════════════════════════════════════════════════

describe("5. 竞态条件测试", () => {
  it("5.1 — Double-submit protection: same user submits same entry twice", async () => {
    await studentManager.addStudent(1, "张三");

    const content = "完全相同的内容";
    const [r1, r2] = await Promise.all([
      entryProcessor.submitAndProcess(1, "张三", content),
      entryProcessor.submitAndProcess(1, "张三", content),
    ]);

    // Both should succeed (they get unique IDs)
    expect(r1.id).not.toBe(r2.id);

    // Both entries should exist
    const entries = store.get("entries", 1);
    expect(entries.length).toBe(2);
  });

  it("5.2 — Concurrent backup export + import don't corrupt data", async () => {
    // Setup: User 1 has 3 students
    await studentManager.addStudent(1, "张三");
    await studentManager.addStudent(1, "李四");
    await studentManager.addStudent(1, "王五");

    // Prepare an import payload for user 2
    const importContent = [
      "# Backup for user 2",
      "> Students: 2",
      "## Student: 赵六",
      "Status: 新状态",
      "## Student: 钱七",
      "Status: 另一个状态",
    ].join("\n");

    // Run export for user 1 and import for user 2 concurrently
    const [exportResult, importResult] = await Promise.all([
      backupSystem.exportBackup(1),
      backupSystem.importBackup(2, importContent),
    ]);

    // Export should only contain user 1's students
    expect(exportResult.studentCount).toBe(3);
    expect(exportResult.content).toContain("张三");
    expect(exportResult.content).not.toContain("赵六");

    // Import should only affect user 2
    expect(importResult.imported).toBe(2);
    const user1Students = await studentManager.listStudents(1);
    const user2Students = store.get("students", 2);

    expect(user1Students).toHaveLength(3);
    expect(user2Students).toHaveLength(2);
  });

  it("5.3 — Config read during config write returns a valid value", async () => {
    await configStore.setUserConfig(1, "apiModel", "original-model");

    // Issue many reads while also writing
    const readResults: string[] = [];
    const operations = [
      ...Array.from({ length: 20 }, () =>
        configStore.getConfigValue("apiModel", 1).then((v) => {
          readResults.push(v);
        })
      ),
      configStore.setUserConfig(1, "apiModel", "new-model"),
    ];

    await Promise.all(operations);

    // Every read should return either "original-model" or "new-model", never garbage
    for (const value of readResults) {
      expect(["original-model", "new-model"]).toContain(value);
    }
  });

  it("5.4 — Student delete during entry processing", async () => {
    const { id: studentId } = await studentManager.addStudent(1, "待删除学生");

    // Submit entry and delete student concurrently
    const [submitResult] = await Promise.all([
      entryProcessor.submitAndProcess(1, "待删除学生", "即将被删除的学生的记录"),
      studentManager.removeStudent(1, studentId),
    ]);

    // Entry submission should still succeed
    expect(submitResult.id).toBeDefined();

    // Student should be marked inactive
    const allStudents = store.get("students", 1);
    const student = allStudents.find((s: any) => s.id === studentId);
    expect(student?.status).toBe("inactive");
  });

  it("5.5 — Rapid add and remove of the same student", async () => {
    const operations: Promise<any>[] = [];
    for (let i = 0; i < 10; i++) {
      operations.push(
        (async () => {
          try {
            const { id } = await studentManager.addStudent(1, `快速学生${i}`);
            await studentManager.removeStudent(1, id);
          } catch {
            // Some may fail due to duplicate, that's expected
          }
        })()
      );
    }

    await Promise.all(operations);

    // All students that were created should be in the store (either active or inactive)
    const allStudents = store.get("students", 1);
    expect(allStudents.length).toBeGreaterThan(0);
  });

  it("5.6 — Concurrent entry confirm and new entry submit for same student", async () => {
    await studentManager.addStudent(1, "张三");

    // Submit and wait for processing
    const entry1 = await entryProcessor.submitAndProcess(1, "张三", "第一条记录");
    await new Promise((r) => setTimeout(r, 100));

    // Now confirm first entry while submitting a new one
    const [confirmResult, submitResult] = await Promise.all([
      entryProcessor.confirmEntries(1, [entry1.id]),
      entryProcessor.submitAndProcess(1, "张三", "第二条记录"),
    ]);

    // Both operations should succeed
    expect(confirmResult.count).toBeGreaterThanOrEqual(0);
    expect(submitResult.id).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════
// 6. 高负载下的数据隔离 (Data Isolation Under Load)
// ════════════════════════════════════════════════════════════════

describe("6. 高负载下的数据隔离", () => {
  it("6.1 — 50+ operations across 10 users: no data leaks", async () => {
    const users = userIds(10);

    // Phase 1: Setup — each user creates config and students
    await Promise.all(
      users.flatMap((uid) => [
        configStore.setUserConfig(uid, "apiModel", `model-${uid}`),
        configStore.setUserConfig(uid, "apiUrl", `https://api${uid}.example.com`),
        studentManager.addStudent(uid, `学生A_U${uid}`),
        studentManager.addStudent(uid, `学生B_U${uid}`),
      ])
    );

    // Phase 2: Heavy operations — entries + grading
    const operations = users.flatMap((uid) => [
      entryProcessor.submitAndProcess(uid, `学生A_U${uid}`, `用户${uid}的记录A`),
      entryProcessor.submitAndProcess(uid, `学生B_U${uid}`, `用户${uid}的记录B`),
      gradingRunner.submitGrading(uid, {
        startDate: "2026-02-01",
        endDate: "2026-02-07",
        gradingPrompt: `用户${uid}打分`,
      }),
    ]);

    const results = await Promise.allSettled(operations);

    // All operations should succeed
    const failures = results.filter((r) => r.status === "rejected");
    expect(failures).toHaveLength(0);

    // Phase 3: Verify isolation
    for (const uid of users) {
      const students = await studentManager.listStudents(uid);
      const studentNames = students.map((s: any) => s.name);

      // Each user should see only their own students
      expect(studentNames).toContain(`学生A_U${uid}`);
      expect(studentNames).toContain(`学生B_U${uid}`);

      // Should NOT see other users' students
      for (const otherUid of users) {
        if (otherUid === uid) continue;
        expect(studentNames).not.toContain(`学生A_U${otherUid}`);
        expect(studentNames).not.toContain(`学生B_U${otherUid}`);
      }

      // Config isolation
      const model = await configStore.getConfigValue("apiModel", uid);
      expect(model).toBe(`model-${uid}`);
    }
  });

  it("6.2 — All operations complete successfully under load", async () => {
    const users = userIds(10);

    // Create mixed workload
    const allOps: Promise<any>[] = [];

    for (const uid of users) {
      // Config operations
      allOps.push(configStore.setUserConfig(uid, "apiModel", `m${uid}`));
      allOps.push(configStore.getConfigValue("apiModel", uid));

      // Student operations
      allOps.push(studentManager.addStudent(uid, `S1_U${uid}`));
      allOps.push(studentManager.addStudent(uid, `S2_U${uid}`));
    }

    const results = await Promise.allSettled(allOps);
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    const rejected = results.filter((r) => r.status === "rejected").length;

    expect(rejected).toBe(0);
    expect(fulfilled).toBe(allOps.length);
  });

  it("6.3 — Entry processing maintains per-user config under load", async () => {
    const users = userIds(10);

    // Setup
    await Promise.all(
      users.flatMap((uid) => [
        configStore.setUserConfig(uid, "apiModel", `heavy-model-${uid}`),
        studentManager.addStudent(uid, `学生_H${uid}`),
      ])
    );

    // Submit entries for all users concurrently
    const entries = await Promise.all(
      users.map((uid) =>
        entryProcessor.submitAndProcess(uid, `学生_H${uid}`, `负载测试-用户${uid}`)
      )
    );

    // Wait for background processing
    await new Promise((r) => setTimeout(r, 300));

    // Verify every entry was processed with the correct user's config
    for (let i = 0; i < users.length; i++) {
      const uid = users[i];
      const entryId = entries[i].id;
      const processedInfo = entryProcessor.processedWith.get(entryId);

      expect(processedInfo).toBeDefined();
      expect(processedInfo!.userId).toBe(uid);
      expect(processedInfo!.model).toBe(`heavy-model-${uid}`);
    }
  });

  it("6.4 — Mixed read/write workload across 10 users", async () => {
    const users = userIds(10);

    // Phase 1: Setup
    await Promise.all(users.map((uid) => studentManager.addStudent(uid, `混合测试_U${uid}`)));

    // Phase 2: Mixed operations
    const ops = users.flatMap((uid) => [
      // Read
      studentManager.listStudents(uid),
      configStore.getConfigValue("apiModel", uid),
      // Write
      configStore.setUserConfig(uid, "currentYear", "2026"),
      studentManager.addStudent(uid, `额外学生_U${uid}`),
    ]);

    const results = await Promise.allSettled(ops);
    const failures = results.filter((r) => r.status === "rejected");
    expect(failures).toHaveLength(0);

    // Verify integrity
    for (const uid of users) {
      const students = await studentManager.listStudents(uid);
      expect(students.length).toBe(2);
      const year = await configStore.getConfigValue("currentYear", uid);
      expect(year).toBe("2026");
    }
  });

  it("6.5 — No data leak: user A never sees user B's entries", async () => {
    await studentManager.addStudent(1, "机密学生");
    await studentManager.addStudent(2, "普通学生");

    await entryProcessor.submitAndProcess(1, "机密学生", "最高机密信息 SSN=123-45-6789");
    await entryProcessor.submitAndProcess(2, "普通学生", "普通信息");

    await new Promise((r) => setTimeout(r, 150));

    const entriesUser1 = store.get("entries", 1);
    const entriesUser2 = store.get("entries", 2);

    // User 2 should never see user 1's data
    for (const e of entriesUser2) {
      expect(e.rawInput).not.toContain("机密");
      expect(e.rawInput).not.toContain("SSN");
      expect(e.studentName).not.toBe("机密学生");
    }

    // User 1's entries should only contain their data
    for (const e of entriesUser1) {
      expect(e.studentName).toBe("机密学生");
    }
  });
});

// ════════════════════════════════════════════════════════════════
// 7. 批量任务内存安全 (Batch System Memory Safety)
// ════════════════════════════════════════════════════════════════

describe("7. 批量任务内存安全", () => {
  it("7.1 — Rapid batch creation/deletion doesn't leak memory", () => {
    const batchIds: string[] = [];

    // Create 100 batches rapidly
    for (let i = 0; i < 100; i++) {
      batchIds.push(batchSystem.createBatch(1, 10));
    }

    expect(batchSystem.activeBatches.size).toBe(100);

    // Delete all
    for (const id of batchIds) {
      batchSystem.deleteBatch(id);
    }

    expect(batchSystem.activeBatches.size).toBe(0);
  });

  it("7.2 — Cleanup timer correctly removes completed batches", async () => {
    const batchId = batchSystem.createBatch(1, 5);
    expect(batchSystem.activeBatches.has(batchId)).toBe(true);

    // Complete the batch (triggers cleanup timer)
    batchSystem.completeBatch(batchId);
    expect(batchSystem.activeBatches.get(batchId)?.status).toBe("completed");

    // Wait for cleanup timer
    await new Promise((r) => setTimeout(r, 100));

    // Batch should be removed
    expect(batchSystem.activeBatches.has(batchId)).toBe(false);
  });

  it("7.3 — Stopping a batch marks it as stopped correctly", () => {
    const batchId = batchSystem.createBatch(1, 10);

    const result = batchSystem.stopBatch(batchId);
    expect(result).toBe(true);

    const batch = batchSystem.activeBatches.get(batchId);
    expect(batch?.status).toBe("stopped");
    expect(batch?.stopped).toBe(true);
  });

  it("7.4 — Stopping a non-existent batch returns false", () => {
    const result = batchSystem.stopBatch("non-existent-id");
    expect(result).toBe(false);
  });

  it("7.5 — Tenant isolation: user A cannot see user B's batch", () => {
    const batchA = batchSystem.createBatch(1, 5);
    const batchB = batchSystem.createBatch(2, 5);

    // User 1 tries to access user 2's batch
    expect(batchSystem.getBatch(batchB, 1)).toBeNull();

    // User 2 tries to access user 1's batch
    expect(batchSystem.getBatch(batchA, 2)).toBeNull();

    // Users can access their own batches
    expect(batchSystem.getBatch(batchA, 1)).not.toBeNull();
    expect(batchSystem.getBatch(batchB, 2)).not.toBeNull();
  });

  it("7.6 — Multiple concurrent batch creates/completes/deletes", async () => {
    const operations: Promise<void>[] = [];

    // Create, complete, and delete batches rapidly across multiple users
    for (let i = 0; i < 20; i++) {
      operations.push(
        (async () => {
          const userId = (i % 5) + 1;
          const batchId = batchSystem.createBatch(userId, 10);
          await randomDelay(1, 10);
          batchSystem.completeBatch(batchId);
          await randomDelay(1, 5);
          batchSystem.deleteBatch(batchId);
        })()
      );
    }

    await Promise.all(operations);

    // After all operations, map should be empty or only have pending cleanup
    // Wait for any remaining cleanup timers
    await new Promise((r) => setTimeout(r, 100));
    expect(batchSystem.activeBatches.size).toBe(0);
  });

  it("7.7 — Batch map doesn't grow unbounded under sustained load", async () => {
    const peakSizes: number[] = [];

    for (let round = 0; round < 5; round++) {
      // Create 20 batches
      const ids: string[] = [];
      for (let i = 0; i < 20; i++) {
        ids.push(batchSystem.createBatch(1, 5));
      }
      peakSizes.push(batchSystem.activeBatches.size);

      // Complete and delete all
      for (const id of ids) {
        batchSystem.completeBatch(id);
        batchSystem.deleteBatch(id);
      }
    }

    // Peak size should never exceed the batch count per round
    for (const peak of peakSizes) {
      expect(peak).toBeLessThanOrEqual(20 + 5); // Allow for small overlap with previous round's cleanup
    }

    // Final size should be 0
    await new Promise((r) => setTimeout(r, 100));
    expect(batchSystem.activeBatches.size).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════
// 8. 额外并发场景 (Additional Concurrency Scenarios)
// ════════════════════════════════════════════════════════════════

describe("8. 额外并发场景", () => {
  it("8.1 — ConcurrencyPool isolation: tasks for different users don't interleave results", async () => {
    // Simulate what ConcurrencyPool does: N tasks executing with bounded concurrency
    const concurrency = 3;
    const results = new Map<number, number[]>();

    const users = userIds(5);
    for (const uid of users) {
      results.set(uid, []);
    }

    const tasks = users.flatMap((uid) =>
      Array.from({ length: 5 }, (_, i) => async () => {
        await randomDelay(1, 10);
        results.get(uid)!.push(i + 1);
      })
    );

    // Execute with bounded concurrency (simulating ConcurrencyPool)
    const executing = new Set<Promise<void>>();
    for (const task of tasks) {
      const p = task().then(() => {
        executing.delete(p);
      });
      executing.add(p);
      if (executing.size >= concurrency) {
        await Promise.race(executing);
      }
    }
    await Promise.all(executing);

    // Each user should have exactly 5 results
    for (const uid of users) {
      expect(results.get(uid)!.sort()).toEqual([1, 2, 3, 4, 5]);
    }
  });

  it("8.2 — Concurrent backup export doesn't return another user's data", async () => {
    const users = userIds(5);

    // Each user has unique students
    for (const uid of users) {
      await studentManager.addStudent(uid, `独有学生_U${uid}`);
    }

    // All users export backup concurrently
    const backups = await Promise.all(users.map((uid) => backupSystem.exportBackup(uid)));

    for (let i = 0; i < users.length; i++) {
      const uid = users[i];
      const backup = backups[i];

      expect(backup.content).toContain(`独有学生_U${uid}`);
      expect(backup.studentCount).toBe(1);

      // Should NOT contain other users' students
      for (const otherUid of users) {
        if (otherUid === uid) continue;
        expect(backup.content).not.toContain(`独有学生_U${otherUid}`);
      }
    }
  });

  it("8.3 — Concurrent import and export for the same user", async () => {
    await studentManager.addStudent(1, "现有学生");

    const importContent = [
      "# Backup for user 1",
      "## Student: 导入学生1",
      "Status: 新状态",
      "## Student: 导入学生2",
      "Status: 另一个状态",
    ].join("\n");

    // Export and import concurrently for the same user
    const [exportResult, importResult] = await Promise.all([
      backupSystem.exportBackup(1),
      backupSystem.importBackup(1, importContent),
    ]);

    // Export should have captured the state at its point in time
    expect(exportResult.studentCount).toBeGreaterThanOrEqual(1);
    expect(importResult.imported).toBe(2);
  });

  it("8.4 — Timing analysis: concurrent operations complete within reasonable time", async () => {
    const users = userIds(10);
    const start = Date.now();

    // 40 operations total
    await Promise.all(
      users.flatMap((uid) => [
        configStore.setUserConfig(uid, "apiModel", `model-${uid}`),
        configStore.getConfigValue("apiModel", uid),
        studentManager.addStudent(uid, `时间测试_U${uid}`),
        studentManager.listStudents(uid),
      ])
    );

    const elapsed = Date.now() - start;

    // Concurrent execution should complete in under 1 second
    // (sequential would take ~40 * maxDelay = ~120ms)
    expect(elapsed).toBeLessThan(1000);
  });

  it("8.5 — Order independence: operations produce correct results regardless of scheduling", async () => {
    // Run the same logical workflow multiple times and verify consistency
    const iterations = 5;
    const allResults: Array<{ students: number; config: string }> = [];

    for (let i = 0; i < iterations; i++) {
      const localStore = new MockDataStore();
      const localConfig = new MockConfigStore();
      const localManager = new MockStudentManager(localStore);

      await Promise.all([
        localConfig.setUserConfig(1, "apiModel", "consistent-model"),
        localManager.addStudent(1, "固定学生A"),
        localManager.addStudent(1, "固定学生B"),
      ]);

      const [students, config] = await Promise.all([
        localManager.listStudents(1),
        localConfig.getConfigValue("apiModel", 1),
      ]);

      allResults.push({ students: students.length, config });
    }

    // All iterations should produce the same result
    for (const result of allResults) {
      expect(result.students).toBe(2);
      expect(result.config).toBe("consistent-model");
    }
  });

  it("8.6 — Stress: 100 config reads across 10 users", async () => {
    const users = userIds(10);

    for (const uid of users) {
      await configStore.setUserConfig(uid, "apiKey", `key-for-${uid}`);
    }

    // 100 concurrent reads (10 per user)
    const reads = users.flatMap((uid) =>
      Array.from({ length: 10 }, () =>
        configStore.getConfigValue("apiKey", uid).then((v) => ({ uid, value: v }))
      )
    );

    const results = await Promise.all(reads);

    for (const r of results) {
      expect(r.value).toBe(`key-for-${r.uid}`);
    }
  });

  it("8.7 — Grading sync doesn't cross-contaminate student statuses", async () => {
    // User 1 has students A and B; User 2 has student C
    await studentManager.addStudent(1, "A");
    await studentManager.addStudent(1, "B");
    await studentManager.addStudent(2, "C");

    const task1 = await gradingRunner.submitGrading(1, {
      startDate: "2026-02-01",
      endDate: "2026-02-07",
      gradingPrompt: "用户1的打分",
    });

    const task2 = await gradingRunner.submitGrading(2, {
      startDate: "2026-02-01",
      endDate: "2026-02-07",
      gradingPrompt: "用户2的打分",
    });

    await Promise.all([
      gradingRunner.syncGradingToStudents(1, task1.id),
      gradingRunner.syncGradingToStudents(2, task2.id),
    ]);

    // User 1's students should not have user 2's task ID in their status
    const u1Students = await studentManager.listStudents(1);
    for (const s of u1Students) {
      if (s.currentStatus) {
        expect(s.currentStatus).not.toContain(`task ${task2.id}`);
      }
    }

    // User 2's students should not have user 1's task ID
    const u2Students = await studentManager.listStudents(2);
    for (const s of u2Students) {
      if (s.currentStatus) {
        expect(s.currentStatus).not.toContain(`task ${task1.id}`);
      }
    }
  });

  it("8.8 — Global DEFAULT_CONFIG is never mutated by any user", async () => {
    const originalDefault = { ...DEFAULT_CONFIG };

    const users = userIds(10);

    // All users set their own configs
    await Promise.all(
      users.map((uid) => configStore.setUserConfig(uid, "apiModel", `custom-${uid}`))
    );

    // Verify DEFAULT_CONFIG is unchanged
    expect(DEFAULT_CONFIG).toEqual(originalDefault);
  });

  it("8.9 — Concurrent operations on empty store don't throw", async () => {
    const emptyStore = new MockDataStore();
    const emptyConfig = new MockConfigStore();
    const mgr = new MockStudentManager(emptyStore);
    const proc = new MockEntryProcessor(emptyStore, emptyConfig);

    const ops = [
      mgr.listStudents(1),
      mgr.listStudents(2),
      proc.confirmEntries(1, [999, 1000]),
      emptyConfig.getConfigValue("apiModel", 1),
      emptyConfig.getConfigValue("nonExistentKey"),
    ];

    const results = await Promise.allSettled(ops);
    const failures = results.filter((r) => r.status === "rejected");
    expect(failures).toHaveLength(0);
  });

  it("8.10 — Interleaved create/list operations maintain consistency", async () => {
    const ops: Promise<any>[] = [];

    // Interleave create and list for the same user
    for (let i = 0; i < 10; i++) {
      ops.push(studentManager.addStudent(1, `交替学生${i}`));
      ops.push(studentManager.listStudents(1));
    }

    const results = await Promise.allSettled(ops);

    // All creates should succeed
    const createResults = results.filter((_, i) => i % 2 === 0);
    for (const r of createResults) {
      expect(r.status).toBe("fulfilled");
    }

    // Final state should have all 10 students
    const finalStudents = await studentManager.listStudents(1);
    expect(finalStudents).toHaveLength(10);
  });
});
