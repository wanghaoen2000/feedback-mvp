import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import type { User } from "../drizzle/schema";

// Mock LLM调用
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [{ message: { content: "2" } }],
  }),
}));

// Mock Google Drive上传
vi.mock("./gdrive", () => ({
  uploadToGoogleDrive: vi.fn().mockResolvedValue({
    url: "https://drive.google.com/mock-url",
    path: "Mac/Documents/XDF/学生档案/李四/课后信息/李四计算结果.md",
  }),
}));

function createTestContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "test-open-id",
      name: "测试用户",
      email: "admin@test.com",
      loginMethod: "password",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as User,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("calculate.compute", () => {
  it("should compute expression and return result", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.calculate.compute({
      expression: "1+1",
      studentName: "李四",
    });

    expect(result.expression).toBe("1+1");
    expect(result.result).toBe("2");
    expect(result.success).toBe(true);
    expect(result.driveUrl).toBe("https://drive.google.com/mock-url");
  });

  it("should use default student name when not provided", async () => {
    const ctx = createTestContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.calculate.compute({
      expression: "2+2",
    });

    expect(result.expression).toBe("2+2");
    expect(result.success).toBe(true);
  });
});
