import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock 依赖 ───
vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("../drizzle/schema", () => ({
  hwStudents: { status: "status", name: "name", id: "id" },
  hwEntries: {},
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col, val) => ({ _eq: val })),
  desc: vi.fn(),
  sql: vi.fn(),
  and: vi.fn(),
  inArray: vi.fn(),
}));
vi.mock("./whatai", () => ({ invokeWhatAIStream: vi.fn() }));
vi.mock("./core/aiClient", () => ({
  getConfigValue: vi.fn().mockResolvedValue(null),
  DEFAULT_CONFIG: { driveBasePath: "Mac/Documents" },
}));
vi.mock("./utils", () => ({
  getBeijingTimeContext: vi.fn().mockReturnValue("2024年1月1日 周一 10:00"),
}));

import { getDb } from "./db";
import {
  parseBackupContent,
  previewBackup,
  exportStudentBackup,
  importStudentBackup,
} from "./homeworkManager";

// ─── 测试用的备份生成工具 ───
function makeBackup(
  students: Array<{ name: string; planType?: string; status?: string }>
): string {
  const sep = "═══════════════════════════════════════";
  const lines = [
    "# 学生管理数据备份",
    "> 导出时间: 2024-01-01 10:00:00",
    `> 学生总数: ${students.length}`,
    "",
  ];
  for (const s of students) {
    lines.push(`## ${sep} 学生: ${s.name} ${sep}`);
    lines.push("");
    lines.push("### 计划类型");
    lines.push(s.planType || "weekly");
    lines.push("");
    lines.push("### 状态记录");
    lines.push(s.status || "(无状态记录)");
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  return lines.join("\n");
}

// ─── Mock DB 工厂 ───
function createMockDb(existingStudents: Array<{ id: number; name: string }> = []) {
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  });

  const mockDb = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockImplementation((condition: any) => {
          // exportStudentBackup: .where(eq(status, "active")).orderBy(...)
          if (condition?._eq === "active") {
            return {
              orderBy: vi.fn().mockResolvedValue(existingStudents),
            };
          }
          // importStudentBackup: .where(eq(name, x)).limit(1)
          const matchName = condition?._eq;
          const found = existingStudents.filter((s) => s.name === matchName);
          return {
            limit: vi.fn().mockResolvedValue(found),
          };
        }),
      })),
    }),
    insert: vi.fn().mockReturnValue({
      values: insertValues,
    }),
    update: vi.fn().mockReturnValue({
      set: updateSet,
    }),
    execute: vi.fn().mockResolvedValue(undefined),
  };

  return { mockDb, insertValues, updateSet };
}

// ════════════════════════════════════════════
// 1. parseBackupContent - 纯解析，无 DB 依赖
// ════════════════════════════════════════════
describe("parseBackupContent - 备份文件解析", () => {
  beforeEach(() => vi.clearAllMocks());

  it("解析标准单学生备份", () => {
    const content = makeBackup([
      { name: "张三", planType: "daily", status: "【学生姓名】张三\n英语四级冲刺中" },
    ]);
    const result = parseBackupContent(content);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("张三");
    expect(result[0].planType).toBe("daily");
    expect(result[0].currentStatus).toBe("【学生姓名】张三\n英语四级冲刺中");
  });

  it("解析多个学生", () => {
    const content = makeBackup([
      { name: "张三", planType: "daily", status: "状态A" },
      { name: "李四", planType: "weekly", status: "状态B" },
      { name: "王五" },
    ]);
    const result = parseBackupContent(content);
    expect(result).toHaveLength(3);
    expect(result[0].name).toBe("张三");
    expect(result[1].name).toBe("李四");
    expect(result[2].name).toBe("王五");
  });

  it("planType 默认为 weekly", () => {
    const content = makeBackup([{ name: "测试" }]);
    const result = parseBackupContent(content);
    expect(result[0].planType).toBe("weekly");
  });

  it("planType 非 daily 时回退到 weekly", () => {
    const content = makeBackup([{ name: "测试", planType: "unknown" }]);
    const result = parseBackupContent(content);
    expect(result[0].planType).toBe("weekly");
  });

  it("planType=daily 能正确识别", () => {
    const content = makeBackup([{ name: "测试", planType: "daily" }]);
    const result = parseBackupContent(content);
    expect(result[0].planType).toBe("daily");
  });

  it("(无状态记录) 解析为空字符串", () => {
    const content = makeBackup([{ name: "新生" }]);
    const result = parseBackupContent(content);
    expect(result[0].currentStatus).toBe("");
  });

  it("空输入返回空数组", () => {
    expect(parseBackupContent("")).toHaveLength(0);
  });

  it("无学生段的随机文本返回空数组", () => {
    expect(parseBackupContent("# 标题\n随便写点什么\n---")).toHaveLength(0);
  });

  it("多行状态记录完整保留", () => {
    const multiLine = "第一行\n第二行\n第三行\n\n第五行（空行后）";
    const content = makeBackup([{ name: "测试", status: multiLine }]);
    const result = parseBackupContent(content);
    expect(result[0].currentStatus).toBe(multiLine);
  });

  it("尾部没有 --- 分隔线也能解析", () => {
    const sep = "═══════════════════════════════════════";
    const content = [
      "# 学生管理数据备份",
      "",
      `## ${sep} 学生: 张三 ${sep}`,
      "",
      "### 计划类型",
      "daily",
      "",
      "### 状态记录",
      "状态内容",
    ].join("\n");
    const result = parseBackupContent(content);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("张三");
    expect(result[0].planType).toBe("daily");
    expect(result[0].currentStatus).toBe("状态内容");
  });

  it("学生名称前后空格被 trim", () => {
    const sep = "═══════════════════════════════════════";
    const content = [
      `## ${sep} 学生:  李四  ${sep}`,
      "",
      "### 计划类型",
      "weekly",
      "",
      "### 状态记录",
      "内容",
      "---",
    ].join("\n");
    const result = parseBackupContent(content);
    expect(result[0].name).toBe("李四");
  });

  it("用中文冒号的标题也能解析", () => {
    const sep = "═══════════════════════════════════════";
    const content = [
      `## ${sep} 学生：赵六 ${sep}`,
      "",
      "### 计划类型",
      "daily",
      "",
      "### 状态记录",
      "内容",
      "---",
    ].join("\n");
    const result = parseBackupContent(content);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("赵六");
  });

  it("状态中包含 Markdown 标题不会被误判", () => {
    const statusWithHeaders = "## 考试计划\n### 目标：四级\n分数：500+";
    const content = makeBackup([{ name: "测试", status: statusWithHeaders }]);
    const result = parseBackupContent(content);
    // "## 考试计划" 不匹配 STUDENT_HEADER_RE（缺少 ═ 和 学生:），不应被截断
    expect(result).toHaveLength(1);
    expect(result[0].currentStatus).toContain("## 考试计划");
    expect(result[0].currentStatus).toContain("分数：500+");
  });

  it("连续两个学生之间没有空行也能解析", () => {
    const sep = "═══════════════════════════════════════";
    const content = [
      `## ${sep} 学生: A ${sep}`,
      "### 计划类型",
      "daily",
      "### 状态记录",
      "状态A",
      "---",
      `## ${sep} 学生: B ${sep}`,
      "### 计划类型",
      "weekly",
      "### 状态记录",
      "状态B",
      "---",
    ].join("\n");
    const result = parseBackupContent(content);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: "A", planType: "daily", currentStatus: "状态A" });
    expect(result[1]).toEqual({ name: "B", planType: "weekly", currentStatus: "状态B" });
  });
});

// ════════════════════════════════════════════
// 2. previewBackup - 预览采样
// ════════════════════════════════════════════
describe("previewBackup - 备份预览", () => {
  beforeEach(() => vi.clearAllMocks());

  it("空备份返回 total=0", () => {
    const result = previewBackup("");
    expect(result.total).toBe(0);
    expect(result.samples).toHaveLength(0);
    expect(result.allNames).toHaveLength(0);
  });

  it("1个学生 → 1个 sample", () => {
    const content = makeBackup([{ name: "张三", status: "状态" }]);
    const result = previewBackup(content);
    expect(result.total).toBe(1);
    expect(result.samples).toHaveLength(1);
    expect(result.samples[0].name).toBe("张三");
    expect(result.allNames).toEqual(["张三"]);
  });

  it("2个学生 → 首+尾 = 2个 sample", () => {
    const content = makeBackup([
      { name: "张三", status: "A" },
      { name: "李四", status: "B" },
    ]);
    const result = previewBackup(content);
    expect(result.total).toBe(2);
    expect(result.samples).toHaveLength(2);
    expect(result.samples[0].name).toBe("张三");
    expect(result.samples[1].name).toBe("李四");
  });

  it("3个学生 → 首+中+尾 = 3个 sample", () => {
    const content = makeBackup([
      { name: "A" },
      { name: "B" },
      { name: "C" },
    ]);
    const result = previewBackup(content);
    expect(result.total).toBe(3);
    expect(result.samples).toHaveLength(3);
    expect(result.samples[0].name).toBe("A");
    expect(result.samples[1].name).toBe("B");
    expect(result.samples[2].name).toBe("C");
  });

  it("5个学生 → 首+中+尾 = 3个 sample", () => {
    const names = ["A", "B", "C", "D", "E"];
    const content = makeBackup(names.map((n) => ({ name: n })));
    const result = previewBackup(content);
    expect(result.total).toBe(5);
    expect(result.samples).toHaveLength(3);
    expect(result.samples[0].name).toBe("A");
    expect(result.samples[1].name).toBe("C"); // Math.floor(5/2) = 2 → index 2
    expect(result.samples[2].name).toBe("E");
  });

  it("状态超过 200 字符时截断并加 ...", () => {
    const longStatus = "字".repeat(300);
    const content = makeBackup([{ name: "测试", status: longStatus }]);
    const result = previewBackup(content);
    expect(result.samples[0].statusPreview.length).toBeLessThanOrEqual(203); // 200 + "..."
    expect(result.samples[0].statusPreview).toMatch(/\.\.\.$/);
  });

  it("状态刚好 200 字不截断", () => {
    const exactStatus = "字".repeat(200);
    const content = makeBackup([{ name: "测试", status: exactStatus }]);
    const result = previewBackup(content);
    expect(result.samples[0].statusPreview).toBe(exactStatus);
    expect(result.samples[0].statusPreview).not.toMatch(/\.\.\.$/);
  });

  it("无状态记录显示 (无)", () => {
    const content = makeBackup([{ name: "新生" }]);
    const result = previewBackup(content);
    expect(result.samples[0].statusPreview).toBe("(无)");
  });

  it("allNames 包含所有学生名", () => {
    const content = makeBackup([
      { name: "张三" },
      { name: "李四" },
      { name: "王五" },
      { name: "赵六" },
    ]);
    const result = previewBackup(content);
    expect(result.allNames).toEqual(["张三", "李四", "王五", "赵六"]);
  });
});

// ════════════════════════════════════════════
// 3. exportStudentBackup - 导出（DB 交互）
// ════════════════════════════════════════════
describe("exportStudentBackup - 数据库导出", () => {
  beforeEach(() => vi.clearAllMocks());

  it("数据库不可用时抛出异常", async () => {
    (getDb as any).mockResolvedValue(null);
    await expect(exportStudentBackup()).rejects.toThrow("数据库不可用");
  });

  it("无活跃学生时返回空备份", async () => {
    const { mockDb } = createMockDb([]);
    (getDb as any).mockResolvedValue(mockDb);

    const result = await exportStudentBackup();
    expect(result.studentCount).toBe(0);
    expect(result.content).toContain("学生总数: 0");
    expect(result.timestamp).toMatch(/^\d{14}$/);
  });

  it("导出单个学生包含正确内容", async () => {
    const students = [
      { id: 1, name: "张三", planType: "daily", currentStatus: "英语四级冲刺", status: "active" },
    ];
    const { mockDb } = createMockDb(students as any);
    (getDb as any).mockResolvedValue(mockDb);

    const result = await exportStudentBackup();
    expect(result.studentCount).toBe(1);
    expect(result.content).toContain("学生: 张三");
    expect(result.content).toContain("### 计划类型");
    expect(result.content).toContain("daily");
    expect(result.content).toContain("### 状态记录");
    expect(result.content).toContain("英语四级冲刺");
  });

  it("导出多个学生都包含", async () => {
    const students = [
      { id: 1, name: "A", planType: "weekly", currentStatus: "状态A", status: "active" },
      { id: 2, name: "B", planType: "daily", currentStatus: "状态B", status: "active" },
    ];
    const { mockDb } = createMockDb(students as any);
    (getDb as any).mockResolvedValue(mockDb);

    const result = await exportStudentBackup();
    expect(result.studentCount).toBe(2);
    expect(result.content).toContain("学生: A");
    expect(result.content).toContain("学生: B");
    expect(result.content).toContain("状态A");
    expect(result.content).toContain("状态B");
  });

  it("currentStatus 为 null 时使用 (无状态记录)", async () => {
    const students = [
      { id: 1, name: "新生", planType: "weekly", currentStatus: null, status: "active" },
    ];
    const { mockDb } = createMockDb(students as any);
    (getDb as any).mockResolvedValue(mockDb);

    const result = await exportStudentBackup();
    expect(result.content).toContain("(无状态记录)");
  });

  it("planType 为空时默认 weekly", async () => {
    const students = [
      { id: 1, name: "测试", planType: null, currentStatus: "状态", status: "active" },
    ];
    const { mockDb } = createMockDb(students as any);
    (getDb as any).mockResolvedValue(mockDb);

    const result = await exportStudentBackup();
    expect(result.content).toContain("weekly");
  });

  it("导出的内容能被 parseBackupContent 正确解析回来", async () => {
    const students = [
      { id: 1, name: "张三", planType: "daily", currentStatus: "多行\n状态\n记录", status: "active" },
      { id: 2, name: "李四", planType: "weekly", currentStatus: null, status: "active" },
    ];
    const { mockDb } = createMockDb(students as any);
    (getDb as any).mockResolvedValue(mockDb);

    const { content } = await exportStudentBackup();
    const parsed = parseBackupContent(content);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ name: "张三", planType: "daily", currentStatus: "多行\n状态\n记录" });
    expect(parsed[1]).toEqual({ name: "李四", planType: "weekly", currentStatus: "" });
  });
});

// ════════════════════════════════════════════
// 4. importStudentBackup - 导入（DB 交互）
// ════════════════════════════════════════════
describe("importStudentBackup - 数据库导入", () => {
  beforeEach(() => vi.clearAllMocks());

  it("数据库不可用时抛出异常", async () => {
    (getDb as any).mockResolvedValue(null);
    const content = makeBackup([{ name: "测试" }]);
    await expect(importStudentBackup(content)).rejects.toThrow("数据库不可用");
  });

  it("空备份内容抛出异常", async () => {
    const { mockDb } = createMockDb();
    (getDb as any).mockResolvedValue(mockDb);
    await expect(importStudentBackup("")).rejects.toThrow("备份文件中未找到学生数据");
  });

  it("无学生段的文本抛出异常", async () => {
    const { mockDb } = createMockDb();
    (getDb as any).mockResolvedValue(mockDb);
    await expect(importStudentBackup("# 标题\n无效内容")).rejects.toThrow("备份文件中未找到学生数据");
  });

  it("全部新建 → created 计数正确", async () => {
    const { mockDb, insertValues } = createMockDb([]); // 没有已有学生
    (getDb as any).mockResolvedValue(mockDb);

    const content = makeBackup([
      { name: "张三", planType: "daily", status: "状态A" },
      { name: "李四", planType: "weekly", status: "状态B" },
    ]);
    const result = await importStudentBackup(content);

    expect(result.imported).toBe(2);
    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);
    expect(insertValues).toHaveBeenCalledTimes(2);
    expect(insertValues).toHaveBeenCalledWith({
      name: "张三",
      planType: "daily",
      currentStatus: "状态A",
    });
    expect(insertValues).toHaveBeenCalledWith({
      name: "李四",
      planType: "weekly",
      currentStatus: "状态B",
    });
  });

  it("全部更新 → updated 计数正确", async () => {
    const existing = [
      { id: 1, name: "张三" },
      { id: 2, name: "李四" },
    ];
    const { mockDb, updateSet } = createMockDb(existing);
    (getDb as any).mockResolvedValue(mockDb);

    const content = makeBackup([
      { name: "张三", planType: "daily", status: "新状态A" },
      { name: "李四", planType: "weekly", status: "新状态B" },
    ]);
    const result = await importStudentBackup(content);

    expect(result.imported).toBe(2);
    expect(result.created).toBe(0);
    expect(result.updated).toBe(2);
    expect(updateSet).toHaveBeenCalledTimes(2);
    expect(updateSet).toHaveBeenCalledWith({
      planType: "daily",
      currentStatus: "新状态A",
      status: "active",
    });
  });

  it("混合新建和更新", async () => {
    const existing = [{ id: 1, name: "张三" }]; // 张三已存在，李四不存在
    const { mockDb, insertValues, updateSet } = createMockDb(existing);
    (getDb as any).mockResolvedValue(mockDb);

    const content = makeBackup([
      { name: "张三", planType: "weekly", status: "更新状态" },
      { name: "李四", planType: "daily", status: "新状态" },
    ]);
    const result = await importStudentBackup(content);

    expect(result.imported).toBe(2);
    expect(result.created).toBe(1);
    expect(result.updated).toBe(1);
    expect(updateSet).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledTimes(1);
  });

  it("状态为空时传 null", async () => {
    const { mockDb, insertValues } = createMockDb([]);
    (getDb as any).mockResolvedValue(mockDb);

    const content = makeBackup([{ name: "新生" }]); // 无状态记录
    await importStudentBackup(content);

    expect(insertValues).toHaveBeenCalledWith({
      name: "新生",
      planType: "weekly",
      currentStatus: null,
    });
  });
});

// ════════════════════════════════════════════
// 5. 导出→解析→导入 round-trip 集成测试
// ════════════════════════════════════════════
describe("Round-trip - 导出→解析→导入 完整流程", () => {
  beforeEach(() => vi.clearAllMocks());

  it("导出的内容能完整 round-trip", async () => {
    const originalStudents = [
      { id: 1, name: "张三", planType: "daily", currentStatus: "【学生姓名】张三\n英语四级\n分数目标：500+", status: "active" },
      { id: 2, name: "李四", planType: "weekly", currentStatus: "【学生姓名】李四\n托福备考", status: "active" },
      { id: 3, name: "王五", planType: "weekly", currentStatus: null, status: "active" },
    ];
    const { mockDb } = createMockDb(originalStudents as any);
    (getDb as any).mockResolvedValue(mockDb);

    // 导出
    const { content, studentCount } = await exportStudentBackup();
    expect(studentCount).toBe(3);

    // 解析
    const parsed = parseBackupContent(content);
    expect(parsed).toHaveLength(3);

    // 验证每个学生
    expect(parsed[0].name).toBe("张三");
    expect(parsed[0].planType).toBe("daily");
    expect(parsed[0].currentStatus).toContain("英语四级");
    expect(parsed[0].currentStatus).toContain("分数目标：500+");

    expect(parsed[1].name).toBe("李四");
    expect(parsed[1].planType).toBe("weekly");
    expect(parsed[1].currentStatus).toContain("托福备考");

    expect(parsed[2].name).toBe("王五");
    expect(parsed[2].currentStatus).toBe(""); // null → (无状态记录) → ""

    // 预览
    const preview = previewBackup(content);
    expect(preview.total).toBe(3);
    expect(preview.samples).toHaveLength(3);
    expect(preview.allNames).toEqual(["张三", "李四", "王五"]);
  });

  it("含特殊字符的状态 round-trip 不丢失", async () => {
    const specialStatus = [
      "## 标题不会被截断",
      "### 子标题也安全",
      "```python",
      'print("hello")',
      "```",
      "---中间有分隔线的文本---",
      "> 引用文本",
      "| 表格 | 内容 |",
      "emoji: 🎉🎊",
    ].join("\n");

    const students = [
      { id: 1, name: "特殊字符测试", planType: "daily", currentStatus: specialStatus, status: "active" },
    ];
    const { mockDb } = createMockDb(students as any);
    (getDb as any).mockResolvedValue(mockDb);

    const { content } = await exportStudentBackup();
    const parsed = parseBackupContent(content);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].currentStatus).toContain('print("hello")');
    expect(parsed[0].currentStatus).toContain("emoji: 🎉🎊");
    expect(parsed[0].currentStatus).toContain("> 引用文本");
  });

  it("大量学生 round-trip 不遗漏", async () => {
    const count = 50;
    const students = Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      name: `学生${String(i + 1).padStart(3, "0")}`,
      planType: i % 2 === 0 ? "daily" : "weekly",
      currentStatus: `这是学生${i + 1}的状态记录`,
      status: "active",
    }));
    const { mockDb } = createMockDb(students as any);
    (getDb as any).mockResolvedValue(mockDb);

    const { content, studentCount } = await exportStudentBackup();
    expect(studentCount).toBe(count);

    const parsed = parseBackupContent(content);
    expect(parsed).toHaveLength(count);

    // 抽样验证
    expect(parsed[0].name).toBe("学生001");
    expect(parsed[0].planType).toBe("daily");
    expect(parsed[24].name).toBe("学生025");
    expect(parsed[24].planType).toBe("daily");
    expect(parsed[49].name).toBe("学生050");
    expect(parsed[49].planType).toBe("weekly");

    const preview = previewBackup(content);
    expect(preview.total).toBe(count);
    expect(preview.allNames).toHaveLength(count);
  });

  it("手动编辑过的备份文件也能解析（多余空行/缩进不影响）", () => {
    const sep = "═══════════════════════════════════════";
    // 模拟人手动编辑后的不规则格式
    const content = [
      "# 学生管理数据备份",
      "",
      "",
      `## ${sep} 学生: 测试生 ${sep}`,
      "",
      "",
      "### 计划类型",
      "",
      "daily",
      "",
      "### 状态记录",
      "",
      "手动编辑的状态",
      "第二行",
      "",
      "---",
    ].join("\n");

    const parsed = parseBackupContent(content);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("测试生");
    expect(parsed[0].planType).toBe("daily");
    expect(parsed[0].currentStatus).toContain("手动编辑的状态");
    expect(parsed[0].currentStatus).toContain("第二行");
  });
});
