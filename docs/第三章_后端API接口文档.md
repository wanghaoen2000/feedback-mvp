# 第三章 后端 API 接口文档

> **学情反馈系统 (feedback-mvp) 技术手册**
> 版本 V179 | 2026-02-16

---

## 3.1 概述

系统后端提供两类 API：

| 类型 | 协议 | 路径前缀 | 用途 |
|------|------|----------|------|
| tRPC 路由 | JSON-RPC over HTTP | `/api/trpc/*` | 所有增删改查操作 |
| SSE/HTTP 端点 | REST + Server-Sent Events | `/api/*` | 流式生成 + 文件下载 |

**通用规则：**

- 所有请求需要携带 Session Cookie（登录后自动设置）
- 权限分三级：`publicProcedure`（无需登录）、`protectedProcedure`（需登录）、`adminProcedure`（需管理员）
- 错误统一通过 `TRPCError` 抛出，包含 `code`（如 `UNAUTHORIZED`、`NOT_FOUND`）和 `message`
- 输入参数通过 Zod schema 校验，不合法直接返回 `BAD_REQUEST`

---

## 3.2 认证路由 (auth)

### auth.me

| 属性 | 值 |
|------|------|
| 类型 | Query |
| 权限 | publicProcedure |
| 输入 | 无 |

**返回值：**

```typescript
// 未登录时返回 null
// 已登录时返回：
{
  id: number,           // 用户 ID
  openId: string,       // Manus OAuth ID
  name: string,         // 用户名
  email: string,        // 邮箱
  role: "user" | "admin",
  accountStatus: "active" | "suspended",
  allowed: boolean,     // 是否允许访问（suspended 用户为 false）
  isImpersonating: boolean  // 是否处于管理员伪装模式
}
```

### auth.logout

| 属性 | 值 |
|------|------|
| 类型 | Mutation |
| 权限 | publicProcedure |
| 输入 | 无 |
| 返回 | `{ success: true }` |

清除 Session Cookie，退出登录。

---

## 3.3 管理员路由 (admin)

### admin.listUsers

| 属性 | 值 |
|------|------|
| 类型 | Query |
| 权限 | adminProcedure |
| 输入 | 无 |
| 返回 | 用户数组 |

返回所有用户列表，每个用户包含：`id, openId, name, email, loginMethod, role, accountStatus, createdAt, lastSignedIn`。

### admin.createUser

| 属性 | 值 |
|------|------|
| 类型 | Mutation |
| 权限 | adminProcedure |

**输入：**
```typescript
{
  name: string,
  email: string,
  role: "user" | "admin"
}
```

**返回：** `{ success: true, user: { id, name, email, role } }`

**错误：** 邮箱已存在 → `CONFLICT`

### admin.updateUser

| 属性 | 值 |
|------|------|
| 类型 | Mutation |
| 权限 | adminProcedure |

**输入：**
```typescript
{
  userId: number,
  name?: string,    // 可选
  email?: string,   // 可选
  role?: "user" | "admin"  // 可选
}
```

**返回：** `{ success: true }`

**限制：** 不能将自己降级为 user。

### admin.suspendUser

| 属性 | 值 |
|------|------|
| 类型 | Mutation |
| 权限 | adminProcedure |
| 输入 | `{ userId: number }` |
| 返回 | `{ success: true }` |

暂停用户，立即禁止其使用系统（数据保留）。

### admin.activateUser

| 属性 | 值 |
|------|------|
| 类型 | Mutation |
| 权限 | adminProcedure |
| 输入 | `{ userId: number }` |
| 返回 | `{ success: true }` |

恢复被暂停的用户。

### admin.deleteUser

| 属性 | 值 |
|------|------|
| 类型 | Mutation |
| 权限 | adminProcedure |
| 输入 | `{ userId: number }` |
| 返回 | `{ success: true }` |

永久删除用户。级联删除关联数据：userConfig、backgroundTasks、hwEntries、hwStudents、batchTasks、correctionTasks、gradingTasks 等。

### admin.impersonateUser

| 属性 | 值 |
|------|------|
| 类型 | Mutation |
| 权限 | adminProcedure |
| 输入 | `{ userId: number }` |
| 返回 | `{ success: true, targetUser: {...} }` |

管理员伪装为指定用户。保存当前管理员 Session 到 `ADMIN_COOKIE`，创建目标用户的 Session。

### admin.stopImpersonating

| 属性 | 值 |
|------|------|
| 类型 | Mutation |
| 权限 | protectedProcedure |
| 输入 | 无 |
| 返回 | `{ success: true }` |

退出伪装模式，恢复管理员 Session。

### admin.checkImpersonation

| 属性 | 值 |
|------|------|
| 类型 | Query |
| 权限 | protectedProcedure |
| 输入 | 无 |
| 返回 | `{ isImpersonating: boolean }` |

---

## 3.4 配置管理路由 (config)

### config.getAll

| 属性 | 值 |
|------|------|
| 类型 | Query |
| 权限 | protectedProcedure |
| 输入 | 无 |

**返回值：**

```typescript
{
  apiModel: string,          // AI 模型名称
  apiKey: "",                // 永远返回空字符串（安全考虑）
  apiUrl: string,            // API 服务地址
  currentYear: string,       // 年份
  roadmap: string,           // 一对一路书
  roadmapClass: string,      // 小班课路书
  driveBasePath: string,     // Google Drive 基础路径
  classStoragePath: string,  // 小班课存储路径
  batchFilePrefix: string,   // 批量文件前缀
  batchStoragePath: string,  // 批量存储路径
  batchConcurrency: string,  // 批量并发数
  maxTokens: string,         // 最大 Token 数
  gdriveLocalBasePath: string, // 本地 Drive 路径
  gdriveDownloadsPath: string, // 下载目录路径
  gradingStoragePath: string,  // 打分存储路径
  hasApiKey: boolean,        // 是否已配置 API Key
  isDefault: { [key]: boolean } // 标记哪些值使用了系统默认
}
```

**配置优先级：** 用户级配置 (user_config) > 系统默认 (system_config / 代码内置默认值)

### config.update

| 属性 | 值 |
|------|------|
| 类型 | Mutation |
| 权限 | protectedProcedure |

**输入（所有字段可选）：**

```typescript
{
  apiModel?: string,
  apiKey?: string,
  apiUrl?: string,
  roadmap?: string,
  roadmapClass?: string,
  driveBasePath?: string,
  classStoragePath?: string,
  batchFilePrefix?: string,
  batchStoragePath?: string,
  batchConcurrency?: string,   // 范围 1~200
  maxTokens?: string,          // 范围 1000~200000
  gdriveLocalBasePath?: string,
  gdriveDownloadsPath?: string,
  gradingStoragePath?: string,
  applyProviderKey?: string    // 应用供应商预设的密钥
}
```

**返回：** `{ success: true, updated: string[], message: string }`

**验证：** 路径格式检查、数值范围检查。

### config.reset

| 属性 | 值 |
|------|------|
| 类型 | Mutation |
| 权限 | protectedProcedure |
| 输入 | `{ keys: string[] }` |
| 返回 | `{ success: true, reset: string[], message: string }` |

删除指定的用户级配置，恢复为系统默认值。

### config.exportBackup

| 属性 | 值 |
|------|------|
| 类型 | Query |
| 权限 | protectedProcedure |
| 输入 | 无 |

**返回：**

```typescript
{
  version: 1,
  exportedAt: string,        // ISO 时间戳
  userId: number,
  userName: string,
  userEmail: string,
  config: { ... },           // 所有配置（API Key 被遮蔽）
  userOverrideKeys: string[] // 哪些是用户级覆盖
}
```

### config.importBackup

| 属性 | 值 |
|------|------|
| 类型 | Mutation |
| 权限 | protectedProcedure |

**输入：**

```typescript
{
  config: Record<string, string>,
  onlyUserOverrides?: boolean,  // 是否只恢复用户级覆盖
  keys?: string[]               // 只恢复指定的 key
}
```

**返回：** `{ success: true, restored: number, skipped: number, restoredKeys: string[], message: string }`

自动跳过被遮蔽的敏感字段（如 API Key）。

### config.getStudentHistory

| 属性 | 值 |
|------|------|
| 类型 | Query |
| 权限 | protectedProcedure |
| 输入 | 无 |
| 返回 | `Record<string, { lesson: number, lastUsed: number, students?: string[] }>` |

获取学生/班级使用历史记录（用于前端自动补全）。

### config.saveStudentHistory

| 属性 | 值 |
|------|------|
| 类型 | Mutation |
| 权限 | protectedProcedure |
| 输入 | `{ history: Record<string, { lesson: number, lastUsed: number, students?: string[] }> }` |
| 返回 | `{ success: true }` |

### config.clearStudentHistory

| 属性 | 值 |
|------|------|
| 类型 | Mutation |
| 权限 | protectedProcedure |
| 输入 | 无 |
| 返回 | `{ success: true }` |

### config.clearAllMyConfig

| 属性 | 值 |
|------|------|
| 类型 | Mutation |
| 权限 | protectedProcedure |
| 输入 | 无 |
| 返回 | `{ success: true, message: string }` |

清除当前用户所有用户级配置（用于修复数据污染问题）。

---

## 3.5 学情反馈生成路由 (feedback)

### feedback.previewPrompts

| 属性 | 值 |
|------|------|
| 类型 | Query |
| 权限 | protectedProcedure |
| 输入 | `{ courseType: "oneToOne" \| "class", roadmap?: string }` |
| 返回 | `Record<string, string>` |

预览各步骤的系统提示词（不调用 AI），包含：学情反馈、复习文档、测试本、课后信息提取。

### feedback.generateFeedback（一对一）

| 属性 | 值 |
|------|------|
| 类型 | Mutation |
| 权限 | protectedProcedure |

**输入：**

```typescript
{
  studentName: string,          // 必填：学生姓名
  lessonNumber?: string,        // 课次编号
  lessonDate?: string,          // 本次课日期（如"1月5日"）
  currentYear?: string,         // 年份
  lastFeedback?: string,        // 上次反馈内容
  currentNotes: string,         // 必填：本次课笔记
  transcript: string,           // 必填：录音转文字
  isFirstLesson?: boolean,      // 是否首次课（默认 false）
  specialRequirements?: string, // 特殊要求
  apiModel?: string,            // 配置快照
  apiKey?: string,
  apiUrl?: string,
  roadmap?: string,
  driveBasePath?: string,
  taskId?: string               // 关联的后台任务 ID
}
```

**返回：**

```typescript
{
  success: true,
  content: string,              // 反馈内容全文
  dateStr: string,              // 提取/推断的日期字符串
  uploadResult: {
    fileName: string,           // 上传的文件名（如"张三第12次学情反馈.md"）
    url: string,                // Google Drive 文件链接
    path: string,               // Drive 内路径
    folderUrl?: string          // 所在文件夹链接
  }
}
```

### feedback.generateReview / generateTest / generateExtraction / generateBubbleChart

这四个接口结构相似，均为步骤 2~5 的独立生成接口：

| 接口 | 产物 | 输出格式 |
|------|------|----------|
| generateReview | 复习文档 | DOCX |
| generateTest | 测试本 | DOCX |
| generateExtraction | 课后信息提取 | Markdown |
| generateBubbleChart | 气泡图 | PNG |

**共同输入：**

```typescript
{
  studentName: string,
  dateStr: string,              // 从步骤 1 获得的日期
  feedbackContent: string,      // 从步骤 1 获得的反馈内容
  lessonNumber?: string,
  apiModel?: string,
  apiKey?: string,
  apiUrl?: string,
  roadmap?: string,
  driveBasePath?: string
}
```

**共同返回：**

```typescript
{
  success: true,
  uploadResult: { fileName, url, path, folderUrl },
  chars: number                 // 生成的字符数
}
```

### feedback.uploadBubbleChart

| 属性 | 值 |
|------|------|
| 类型 | Mutation |
| 权限 | protectedProcedure |

**输入：**

```typescript
{
  svgContent: string,          // 前端生成的 SVG 字符串
  studentName: string,
  dateStr: string,
  lessonNumber?: string,
  driveBasePath?: string
}
```

用于上传前端渲染的气泡图（SVG → PNG 转换在服务端完成）。

### 小班课版本

以下接口功能与一对一版本相同，但输入参数改为小班课格式：

- `feedback.generateClassFeedback` — 小班课学情反馈
- `feedback.generateClassReview` — 小班课复习文档
- `feedback.generateClassTest` — 小班课测试本
- `feedback.generateClassExtraction` — 小班课课后信息提取
- `feedback.generateClassBubbleChart` — 小班课气泡图（为指定学生生成）
- `feedback.uploadClassFile` — 上传小班课文件到指定位置

小班课输入的主要区别：

```typescript
{
  classNumber: string,                    // 班号（替代 studentName）
  attendanceStudents: string[],           // 出勤学生列表
  roadmapClass?: string,                  // 使用小班课路书
  // 其余字段相同
}
```

### feedback.verifyAll

| 属性 | 值 |
|------|------|
| 类型 | Query |
| 权限 | protectedProcedure |
| 输入 | `{ fileIds?: string[], fileNames?: string[] }` |
| 返回 | `{ valid: boolean[], allValid: boolean }` |

批量验证 Google Drive 中的文件是否存在。

### feedback.readFromDownloads

| 属性 | 值 |
|------|------|
| 类型 | Mutation |
| 权限 | protectedProcedure |

**输入：**

```typescript
{
  fileName: string,            // 要读取的文件名
  gdriveLocalBasePath?: string // 本地 Drive 路径（可选）
}
```

**返回：** `{ content: string, error?: string }`

从本地下载目录或 Google Drive 本地挂载路径读取文件内容。

### feedback.readLastFeedback

| 属性 | 值 |
|------|------|
| 类型 | Mutation |
| 权限 | protectedProcedure |
| 输入 | `{ studentName: string, driveBasePath?: string }` |
| 返回 | `{ content: string, fileName: string, error?: string }` |

从 Google Drive 搜索并读取该学生最新的学情反馈文件。

### feedback.systemCheck

| 属性 | 值 |
|------|------|
| 类型 | Query |
| 权限 | protectedProcedure |
| 输入 | 无 |
| 返回 | 诊断结果数组 |

执行系统诊断，检测数据库、API、Drive 等各项服务状态。

### feedback.diagnose

| 属性 | 值 |
|------|------|
| 类型 | Mutation |
| 权限 | protectedProcedure |

诊断反馈生成流程，记录详细日志并返回诊断结果。

### 日志相关

| 接口 | 类型 | 功能 |
|------|------|------|
| feedback.getLatestLog | Query | 获取最新生成日志 |
| feedback.exportLog | Query | 导出指定日志文件 |
| feedback.listLogs | Query | 列出所有日志文件 |

---

## 3.6 Google Drive 认证路由

| 接口 | 类型 | 功能 | 输入 | 返回 |
|------|------|------|------|------|
| feedback.googleAuthStatus | Query | 检查授权状态 | 无 | `{ authorized: boolean, email?: string }` |
| feedback.googleAuthUrl | Query | 获取授权 URL | 无 | `{ authUrl: string }` |
| feedback.googleAuthCallback | Query | 处理授权回调 | `{ code: string }` | `{ success: boolean, message: string }` |
| feedback.googleAuthDisconnect | Mutation | 断开授权 | 无 | `{ success: boolean }` |

---

## 3.7 后台任务路由 (backgroundTasks)

### backgroundTasks.submit

| 属性 | 值 |
|------|------|
| 类型 | Mutation |
| 权限 | protectedProcedure |

**输入：** 完整的一对一或小班课生成参数（同 feedbackInputSchema / classFeedbackInputSchema）

**返回：** `{ taskId: string, displayName: string }`

提交后台任务（fire-and-forget），立即返回 taskId，任务在后台异步执行。

### backgroundTasks.status

| 属性 | 值 |
|------|------|
| 类型 | Query |
| 权限 | protectedProcedure |
| 输入 | `{ taskId: string }` |

**返回：**

```typescript
{
  id: string,
  status: "pending" | "running" | "completed" | "partial" | "failed" | "cancelled",
  currentStep: number,           // 当前步骤（1~5）
  totalSteps: number,            // 总步骤数
  displayName: string,           // 显示名称（如"张三 第12次"）
  stepResults: {                 // 各步骤结果
    feedback?: StepResult,
    review?: StepResult,
    test?: StepResult,
    extraction?: StepResult,
    bubbleChart?: StepResult
  },
  errorMessage?: string,
  createdAt: string,
  completedAt?: string
}
```

**StepResult 结构：**

```typescript
{
  status: "pending" | "running" | "completed" | "truncated" | "failed",
  fileName?: string,
  url?: string,                  // Google Drive 链接
  path?: string,
  chars?: number,                // 生成字符数
  duration?: number,             // 耗时（秒）
  error?: string,
  genInfo?: string               // 生成诊断信息（模式、轮次、token 用量）
}
```

### backgroundTasks.history

| 属性 | 值 |
|------|------|
| 类型 | Query |
| 权限 | protectedProcedure |
| 输入 | 无 |
| 返回 | 任务数组（按创建时间倒序） |

### backgroundTasks.feedbackContent

| 属性 | 值 |
|------|------|
| 类型 | Query |
| 权限 | protectedProcedure |
| 输入 | `{ taskId: string }` |
| 返回 | `{ content: string }` |

获取后台任务生成的反馈内容（用于前端展示）。

### backgroundTasks.extractionContent

| 属性 | 值 |
|------|------|
| 类型 | Query |
| 权限 | protectedProcedure |
| 输入 | `{ taskId: string }` |
| 返回 | `{ content: string }` |

获取后台任务生成的课后信息提取内容。

### backgroundTasks.inputMaterials

| 属性 | 值 |
|------|------|
| 类型 | Query |
| 权限 | protectedProcedure |
| 输入 | `{ taskId: string }` |
| 返回 | `{ notes: string, transcript: string, lastFeedback?: string }` |

获取后台任务的输入材料（笔记、录音转文字等）。

### backgroundTasks.cancel

| 属性 | 值 |
|------|------|
| 类型 | Mutation |
| 权限 | protectedProcedure |
| 输入 | `{ taskId: string }` |
| 返回 | `{ success: boolean, message: string }` |

取消正在执行的后台任务。

---

## 3.8 批量任务路由 (batchTasks)

### batchTasks.submit

| 属性 | 值 |
|------|------|
| 类型 | Mutation |
| 权限 | protectedProcedure |

**输入：**

```typescript
{
  roadmap: string,              // 路书内容
  templateType?: string,        // 模板类型
  startNumber: number,          // 起始编号
  endNumber: number,            // 结束编号
  filePrefix?: string,          // 文件名前缀
  fileNames?: string[],         // 自定义文件名列表
  concurrency?: number,         // 并发数
  files?: Array<{               // 独立文件
    name: string,
    content: string
  }>,
  sharedFiles?: Array<{         // 共享文件
    name: string,
    content: string
  }>
}
```

**返回：** `{ taskId: string, totalCount: number }`

### batchTasks.history

| 属性 | 值 |
|------|------|
| 类型 | Query |
| 权限 | protectedProcedure |
| 输入 | 无 |
| 返回 | 批量任务列表（按创建时间倒序） |

### batchTasks.items

| 属性 | 值 |
|------|------|
| 类型 | Query |
| 权限 | protectedProcedure |
| 输入 | `{ taskId: string }` |
| 返回 | `{ items: Array<{ taskNumber, status, filename, url, error, chars, truncated }> }` |

查询批量任务中各子项的详细状态。

### batchTasks.retryItem

| 属性 | 值 |
|------|------|
| 类型 | Mutation |
| 权限 | protectedProcedure |
| 输入 | `{ taskId: string, itemId: number }` |
| 返回 | `{ success: boolean }` |

重试失败的子任务。

### batchTasks.cancel

| 属性 | 值 |
|------|------|
| 类型 | Mutation |
| 权限 | protectedProcedure |
| 输入 | `{ taskId: string }` |
| 返回 | `{ success: boolean }` |

### batchTasks.compute

| 属性 | 值 |
|------|------|
| 类型 | Query |
| 权限 | protectedProcedure |
| 输入 | `{ taskId: string }` |
| 返回 | 任务统计信息 |

---

## 3.9 作业管理路由 (homework)

### 学生管理

| 接口 | 类型 | 输入 | 返回 | 说明 |
|------|------|------|------|------|
| homework.listStudents | Query | 无 | 学生数组 | 获取当前用户的所有活跃学生 |
| homework.addStudent | Mutation | `{ name, planType? }` | `{ success: true }` | 添加学生（已删除的自动重新激活） |
| homework.updateStudent | Mutation | `{ id, name?, planType?, status? }` | `{ success: true }` | 更新学生信息 |
| homework.removeStudent | Mutation | `{ id }` | `{ success: true }` | 软删除学生（标记 inactive） |

### 条目管理

| 接口 | 类型 | 输入 | 返回 | 说明 |
|------|------|------|------|------|
| homework.submitEntry | Mutation | `{ studentName, rawInput, aiModel? }` | `{ id, status }` | 提交语音输入，后台 AI 处理 |
| homework.listPendingEntries | Query | 无 | 条目数组 | 获取待处理条目（pending/processing/pre_staged/failed） |
| homework.listEntries | Query | `{ statusFilter? }` | 条目数组 | 获取所有条目 |
| homework.listStudentEntries | Query | `{ studentName, limit?, offset? }` | `{ entries, total }` | 获取指定学生的已入库记录（分页） |
| homework.retryEntry | Mutation | `{ id }` | `{ id, status }` | 重试失败或预入库条目 |
| homework.deleteEntry | Mutation | `{ id }` | `{ success: true }` | 删除条目 |
| homework.confirmEntries | Mutation | `{ ids: number[] }` | `{ count }` | 确认入库（更新学生状态） |
| homework.confirmAll | Mutation | 无 | `{ success: true, updatedStudents }` | 全部入库 |

### 学生状态与导入

| 接口 | 类型 | 输入 | 返回 | 说明 |
|------|------|------|------|------|
| homework.getStudentStatus | Query | `{ studentName }` | `{ status: string \| null }` | 获取学生当前状态文档 |
| homework.importFromExtraction | Mutation | `{ studentName, content }` | `{ id, studentCreated }` | 从课后信息提取导入 |
| homework.importFromTask | Mutation | `{ taskId, studentName }` | `{ id, studentCreated }` | 从后台任务导入（一对一） |
| homework.importClassFromTask | Mutation | `{ taskId, classNumber, students }` | `{ total, results }` | 从后台任务导入（小班课，N+1 模式） |

### 配置与提示词

| 接口 | 类型 | 输入 | 返回 | 说明 |
|------|------|------|------|------|
| homework.getConfig | Query | 无 | `{ hwPromptTemplate, hwModel, ... }` | 获取作业管理配置 |
| homework.updateConfig | Mutation | `{ hwPromptTemplate?, hwModel? }` | `{ success: true }` | 更新作业管理配置 |
| homework.previewEntryPrompt | Query | `{ studentName }` | `{ systemPrompt, userPrompt }` | 预览 AI 处理提示词 |

### 打分系统

| 接口 | 类型 | 输入 | 返回 | 说明 |
|------|------|------|------|------|
| homework.submitGrading | Mutation | `{ startDate, endDate, gradingPrompt, userNotes?, aiModel? }` | `{ taskId }` | 提交打分任务 |
| homework.getGradingTask | Query | `{ taskId }` | 任务详情 | 获取打分任务状态和结果 |
| homework.listGradingTasks | Query | 无 | 任务列表 | 获取打分历史 |
| homework.updateGradingResult | Mutation | `{ taskId, editedResult }` | `{ success: true }` | 保存编辑后的打分结果 |
| homework.syncGradingToStudents | Mutation | `{ taskId, concurrency?, systemPrompt? }` | `{ success: true }` | 将打分结果同步到学生状态 |
| homework.getSyncItems | Query | `{ taskId }` | 同步子项列表 | 获取同步进度 |
| homework.retrySyncItem | Mutation | `{ itemId }` | `{ success: true }` | 重试失败的同步子项 |
| homework.importSyncToStudents | Mutation | `{ taskId }` | `{ success: true }` | 直接导入同步结果（跳过 AI） |
| homework.getDefaultSyncPrompt | Query | 无 | `{ prompt: string }` | 获取默认同步提示词 |

### 作业提醒

| 接口 | 类型 | 输入 | 返回 | 说明 |
|------|------|------|------|------|
| homework.submitReminder | Mutation | `{ reminderPrompt, aiModel? }` | `{ taskId }` | 提交提醒生成任务 |
| homework.getReminderTask | Query | `{ taskId }` | 任务详情 | 获取提醒任务结果 |
| homework.listReminderTasks | Query | 无 | 任务列表 | 获取提醒历史 |
| homework.previewReminderPrompt | Query | `{ reminderPrompt }` | `{ systemPrompt }` | 预览提醒提示词 |

### 数据备份

| 接口 | 类型 | 输入 | 返回 | 说明 |
|------|------|------|------|------|
| homework.exportBackup | Query | 无 | `{ content, studentCount, timestamp }` | 导出学生数据备份（Markdown） |
| homework.previewBackup | Mutation | `{ content }` | `{ total, samples, allNames }` | 预览待导入的备份 |
| homework.importBackup | Mutation | `{ content }` | `{ imported, created, updated }` | 导入备份 |

---

## 3.10 作业批改路由 (correction)

### correction.submit

| 属性 | 值 |
|------|------|
| 类型 | Mutation |
| 权限 | protectedProcedure |

**输入：**

```typescript
{
  studentName: string,
  correctionType: string,       // 批改类型 ID
  rawText?: string,             // 文字内容
  images?: string[],            // base64 编码的图片数组
  files?: Array<{               // 上传的文件
    name: string,
    content: string,            // base64 编码
    mimeType: string
  }>,
  aiModel?: string
}
```

**返回：** `{ id: number }` （任务 ID，用于轮询状态）

**处理流程：**
1. 文件提取文字（DOCX → mammoth、PDF → pdf-parse、TXT → UTF-8 解码）
2. 图片上传到存储（如超 2MB 用外部存储，否则 inline）
3. 创建任务记录（status=pending）
4. 后台异步执行 AI 批改
5. 结果分为：批改内容 + 状态更新（自动推送到学生管理）

### correction.getTask

| 属性 | 值 |
|------|------|
| 类型 | Query |
| 权限 | protectedProcedure |
| 输入 | `{ taskId: number }` |
| 返回 | 完整任务记录 |

### correction.listTasks

| 属性 | 值 |
|------|------|
| 类型 | Query |
| 权限 | protectedProcedure |
| 输入 | `{ studentName?, limit? }` |
| 返回 | 任务列表（最近 20 条） |

### 批改类型与提示词管理

| 接口 | 类型 | 输入 | 返回 | 说明 |
|------|------|------|------|------|
| correction.getTypes | Query | 无 | 批改类型数组 | 获取所有批改类型 |
| correction.updateTypes | Mutation | `{ types: CorrectionType[] }` | `{ success: true }` | 更新批改类型列表 |
| correction.getPrompt | Query | 无 | `{ prompt: string }` | 获取通用批改提示词 |
| correction.updatePrompt | Mutation | `{ prompt: string }` | `{ success: true }` | 更新通用批改提示词 |
| correction.previewPrompt | Query | `{ studentName, correctionTypeId }` | `{ systemPrompt, studentStatus }` | 预览批改提示词 |
| correction.getConfig | Query | 无 | `{ correctionModel }` | 获取批改配置 |
| correction.updateConfig | Mutation | `{ correctionModel }` | `{ success: true }` | 更新批改配置 |

---

## 3.11 SSE 流式端点

这些端点通过原生 Express 路由注册，不经过 tRPC。所有端点均需要认证（`requireAuth` 中间件）。

### POST /api/feedback-stream

一对一学情反馈流式生成。

**请求体：** 同 `feedbackInputSchema`

**SSE 事件流：**

```
event: start
data: {"message":"开始生成...","studentName":"张三"}

event: progress
data: {"chars":156,"message":"已生成 156 字符"}

event: progress
data: {"chars":892,"message":"已生成 892 字符"}

...

event: complete
data: {"success":true,"contentId":"xxx","chars":3256,"dateStr":"1月15日","uploadResult":{...}}
```

**错误事件：**

```
event: error
data: {"message":"API 调用失败: 401 Unauthorized"}
```

### POST /api/class-feedback-stream

小班课学情反馈流式生成。请求体使用 `classFeedbackInputSchema`，事件格式相同。

### POST /api/review-stream

一对一复习文档流式生成。

**请求体：**

```typescript
{
  studentName: string,
  dateStr: string,
  feedbackContent: string,
  lessonNumber?: string,
  apiModel?: string,
  apiKey?: string,
  apiUrl?: string,
  roadmap?: string,
  driveBasePath?: string
}
```

### POST /api/test-stream

一对一测试本流式生成。请求体同 review-stream。

### POST /api/extraction-stream

一对一课后信息提取流式生成。请求体同 review-stream。

### POST /api/class-review-stream

小班课复习文档流式生成。

### POST /api/class-test-stream

小班课测试本流式生成。

### POST /api/class-extraction-stream

小班课课后信息提取流式生成。

### GET /api/feedback-content/:id

获取存储的反馈内容（SSE 断开后的兜底方案）。

| 参数 | 说明 |
|------|------|
| `:id` | contentId（从 SSE complete 事件获取） |

**返回：** `{ content: string, meta?: object }`

内容在内存中短期存储，支持用户隔离。

### GET /api/download-drive-file

从 Google Drive 下载文件的代理端点。

| 查询参数 | 说明 |
|----------|------|
| `fileId` | Google Drive 文件 ID |
| `fileName` | 下载时的文件名 |

**返回：** 文件二进制流（设置正确的 Content-Type 和 Content-Disposition）。

---

## 3.12 错误码参考

| TRPCError Code | HTTP 状态码 | 含义 | 常见场景 |
|----------------|-------------|------|----------|
| `BAD_REQUEST` | 400 | 请求参数不合法 | Zod 校验失败、缺少必填字段 |
| `UNAUTHORIZED` | 401 | 未登录或 Session 过期 | 未携带 Cookie |
| `FORBIDDEN` | 403 | 无权限 | 普通用户调用管理员接口、账号被暂停 |
| `NOT_FOUND` | 404 | 资源不存在 | 任务 ID 不存在、用户不存在 |
| `CONFLICT` | 409 | 资源冲突 | 邮箱已存在、学生名重复 |
| `INTERNAL_SERVER_ERROR` | 500 | 服务器内部错误 | 数据库异常、AI API 调用失败 |

**错误响应格式：**

```typescript
{
  error: {
    message: string,     // 中文错误信息
    code: string,        // 错误码（如 "UNAUTHORIZED"）
    data?: {
      stack?: string     // 堆栈信息（仅开发环境）
    }
  }
}
```
