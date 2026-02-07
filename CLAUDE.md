# 项目记忆文件

> 这是 Claude Code 的项目记忆文件，每次新对话都会自动读取。
> 记录了项目开发过程中积累的经验和教训，帮助后续开发避免踩坑。

## 项目概述

**项目名称**：托福阅读学情反馈系统（feedback-mvp）

**项目定位**：教学辅助自动化工具，帮助新东方托福阅读教师快速生成课后文档。

**核心功能**：
- 一对一课程：输入课堂信息后自动生成 5 个文档（学情反馈、复习文档、测试本、课后信息提取、气泡图）
- 小班课：支持多学生批量生成
- 批量处理：支持并发批量生成文档

**技术栈**：
- 前端：React 19 + TypeScript + TailwindCSS + shadcn/ui
- 后端：Node.js + Express + tRPC + Drizzle ORM
- 数据库：MySQL
- AI 服务：DMXapi（Claude API 中转）
- 文件存储：Google Drive（REST API）

## 关键文件

| 文件 | 说明 |
|------|------|
| `server/whatai.ts` | AI API 调用（流式输出） |
| `server/gdrive.ts` | Google Drive 上传（REST API） |
| `server/logger.ts` | 日志记录 |
| `server/feedbackGenerator.ts` | 文档生成 |
| `server/core/sseHelper.ts` | SSE 工具函数 |
| `server/core/aiClient.ts` | AI 客户端封装 |
| `server/core/concurrencyPool.ts` | 并发池管理 |
| `server/batch/batchRoutes.ts` | 批量处理路由 |
| `server/templates/wordCardTemplate.ts` | 词汇卡片模板 |

## 常用命令

```bash
pnpm dev          # 开发模式
pnpm build        # 构建
pnpm start        # 生产模式
pnpm check        # TypeScript 类型检查
pnpm test         # 运行测试
pnpm db:push      # 数据库迁移
```

---

## 踩坑经验（重要！）

### 1. SSE 流式输出

**问题**：前端解析 SSE 事件时，数据错乱或丢失。

**教训**：
- 事件类型要用 `event:` 行判断，不是用 `data:` 字段
- `currentEventType` 变量必须在 while 循环外声明
- 响应头需要 `X-Accel-Buffering: no` 防止 Nginx 缓冲

**正确示例**：
```typescript
// 在 while 外声明！
let currentEventType = '';

while (true) {
  const { value, done } = await reader.read();
  if (done) break;

  const text = decoder.decode(value);
  for (const line of text.split('\n')) {
    if (line.startsWith('event:')) {
      currentEventType = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      const data = JSON.parse(line.slice(5));
      // 根据 currentEventType 处理...
    }
  }
}
```

### 2. 并发状态污染

**问题**：多标签页同时生成时，学生名被"污染"，文件存到错误路径。

**教训**：
- 全局变量会导致并发污染（如 logger.ts 的全局 session）
- 需要用"快照"模式：请求开始时创建配置快照，所有步骤使用同一个快照
- React 状态变量也可能在步骤间被修改

**解决方案**：
```typescript
// 在请求开始时创建快照
const snapshot = {
  studentName: currentStudentName,
  lessonDate: currentLessonDate,
  driveBasePath: config.driveBasePath,
  // ...其他配置
};

// 所有后续步骤都使用 snapshot，不再读取状态变量
await generateStep1(snapshot);
await generateStep2(snapshot);
```

### 3. 气泡图中文乱码

**问题**：服务端用 sharp 库将 SVG 转 PNG 时，中文显示为乱码。

**原因**：服务端环境缺少中文字体。

**解决方案**：
- 后端只生成 SVG 字符串返回
- 前端用 Canvas + Image 渲染 SVG
- 前端调用 Canvas.toDataURL() 转 PNG
- 上传 base64 PNG 到 Google Drive

### 4. API 超时

**问题**：复杂任务（如长文档生成）经常超时 fetch failed。

**解决方案**：
- 使用流式输出（SSE），边生成边返回
- 复杂任务超时设 10 分钟，简单任务 3 分钟
- 添加自动重试机制

### 5. Google Drive 授权

**问题**：OAuth token 过期导致上传失败。

**教训**：
- 定期检查授权状态（系统自检功能）
- 生产环境可能没有 rclone，应使用 REST API
- 需要在 Google Cloud Console 配置正确的回调地址

### 6. Word 文档格式

**问题**：生成的 Word 文档格式混乱，有 Markdown 或 HTML 标记。

**教训**：
- 用 docx 库正确生成结构化文档
- AI 提示词要强调"纯文本，无 Markdown 标记"
- 需要自定义 Markdown 解析器处理粗体/斜体/表格

### 7. 时区问题

**问题**：服务器时间是 UTC，文件夹时间戳与用户预期不符。

**解决方案**：
```typescript
// 转换为北京时间（UTC+8）
const now = new Date();
const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
const batchId = beijingTime.toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(0, 15);
```

### 8. JSON 解析容错

**问题**：AI 输出的 JSON 可能带有 \`\`\`json 标记，导致解析失败。

**解决方案**：
```typescript
// 清理 AI 输出
let cleanContent = content
  .replace(/^```json\s*/i, '')
  .replace(/^```\s*/i, '')
  .replace(/```\s*$/i, '')
  .trim();
const data = JSON.parse(cleanContent);
```

### 9. 并发文件夹创建

**问题**：多任务并发创建同名文件夹，出现 `folder(1)` 重复。

**解决方案**：
- 在启动并发池之前先创建批次文件夹
- 所有任务共用同一个已存在的文件夹路径

### 10. 路书透明转发

**问题**：AI 没有按照用户设置的路书格式生成文档。

**教训**：
- 路书应作为 system prompt 透明转发给 AI
- 不要在代码中"转述"或"总结"路书内容
- 添加"请严格按照上述格式生成，不要互动"指令

---

## 系统自检（8 项）

1. 数据库连接
2. API 配置完整性
3. API 连通性
4. API 密钥有效性
5. API 余额
6. Google Drive 授权
7. Google Drive 写入
8. V9 路书配置

## 常见问题速查

| 问题 | 解决 |
|------|------|
| token expired | 重新连接 Google Drive（高级设置） |
| insufficient_user_quota | DMXapi 充值 |
| fetch failed | 检查 API 配置，尝试增加超时 |
| 中文乱码（气泡图） | 确认前端转 PNG 逻辑正常 |
| 并发污染 | 检查是否使用了快照模式 |
| 生成格式错误 | 检查路书是否透明转发 |

---

## 开发建议

1. **先读代码再改**：修改前务必理解现有逻辑
2. **保持简单**：避免过度工程化，只做必要的修改
3. **注意并发**：任何涉及状态的代码都要考虑并发场景
4. **测试流式输出**：SSE 相关修改务必实际测试
5. **检查类型**：修改后运行 `pnpm check` 确保无类型错误
6. **构建验证**：修改后运行 `pnpm build` 确保可以正常构建

---

*文档版本：V49 | 更新日期：2026年2月*
