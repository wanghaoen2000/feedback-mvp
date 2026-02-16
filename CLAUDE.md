# 学情反馈系统 (feedback-mvp) — Claude 开发指南

> 此文件在每次新对话时自动加载。请严格按照下方指引操作。

## 新对话启动协议（每次必做）

**开始任何工作之前**，按顺序执行以下步骤：

### 第一步：读取关键文件

依次读取：
1. `COLLAB.md`（仓库根目录）— 协作状态、待部署版本、Manus 反馈
2. `scripts/generate-version.cjs` 第 10 行 — 当前版本号
3. 执行 `git branch --show-current && git log --oneline -5` — 当前分支和最近提交

### 第二步：向用户汇报

读完后，**必须**按以下格式向用户汇报，等用户指示再动手：

```
当前状态：
- 分支：xxx
- 版本：Vxxx
- Manus 待处理反馈：有 / 无（如有，简述内容）
- 最近提交：xxx
已就绪，请告诉我接下来做什么。
```

### 第三步：按需深入

如果任务涉及不熟悉的模块，再读对应源文件（见下方"文件索引"）。
如需了解项目全貌和历史经验，读 auto-memory 目录中的 `HANDOFF.md`。

---

## 关键规则（违反会导致严重问题）

1. **分支基于最新 origin/main**：`git fetch origin && git checkout -b claude/xxx origin/main`
2. **推送前更新版本号**：只改 `scripts/generate-version.cjs` 的 `const VERSION`，不改 `version.generated.ts`（构建产物）
3. **禁止删除 `drizzle/` 下已有文件** — 只允许新增
4. **推送前 rebase**：`git fetch origin && git rebase origin/main`
5. **发布说明必须提醒 Manus**：合并 → npm install → build → **先 checkpoint → 再 push GitHub**
6. **用户语言：中文（简体）** — 所有 UI 文本和与用户沟通均用中文
7. **每次推送前把新版本变更追加到 COLLAB.md** 的 "Claude → Manus" 区域

---

## 技术栈

| 层 | 技术 | 注意 |
|----|------|------|
| 前端 | React 19 + TypeScript + Vite + Tailwind + shadcn/ui | |
| 后端 | Express + tRPC | |
| 数据库 | MySQL + Drizzle ORM | 本地无 DATABASE_URL，不能跑 drizzle-kit |
| 文件存储 | Google Drive OAuth API | **不是 rclone**，封装在 `server/gdrive.ts` |
| SVG 渲染 | @resvg/resvg-js | **不是 sharp** |
| 构建 | esbuild (ESM) | 不能用 require() |

---

## 高频踩坑

- **rclone 不存在** — Drive 操作全用 OAuth API（`server/gdrive.ts`）
- **Manus 沙箱访问不到系统字体** — 字体放项目 `fonts/` 目录
- **本地测试通过 ≠ 服务器能用** — 环境问题先加完整诊断日志一次收集全
- **Zod schema 静默丢弃未声明字段** — 新增前后端数据字段时务必检查 schema
- **drizzle _journal.json 不同步** — 不影响运行，手写 SQL 就行
- **DATABASE_URL 本地没有** — 不能跑 drizzle-kit generate

---

## 文件索引

| 要做什么 | 看哪个文件 |
|---------|-----------|
| 协作状态 / Manus 反馈 | `COLLAB.md` |
| 版本号 | `scripts/generate-version.cjs` |
| 前端主页 | `client/src/pages/Home.tsx` |
| 设置页面 | `client/src/pages/Settings.tsx` |
| 作业管理页面 | `client/src/pages/HomeworkManagement.tsx` |
| 任务记录页面 | `client/src/pages/TaskHistory.tsx` |
| 后端路由 | `server/routers.ts` |
| SSE 端点 | `server/classStreamRoutes.ts` |
| 反馈生成逻辑 | `server/feedbackGenerator.ts` |
| 作业管理后端 | `server/homeworkManager.ts` |
| 后台任务 | `server/backgroundTaskRunner.ts` |
| 批量任务 | `server/batchTaskRunner.ts` + `server/batchExecutor.ts` |
| Google Drive | `server/gdrive.ts` |
| AI 客户端与配置 | `server/core/aiClient.ts` |
| 数据库连接 | `server/db.ts` |
| 数据库迁移 | `drizzle/` 目录（只增不删） |
| 项目全貌与历史经验 | auto-memory 中的 `HANDOFF.md` |
| 部署协作详细规范 | auto-memory 中的 `deployment-collaboration.md` |

---

## 文件命名约定

- 搜索云盘候选：`{name}{lesson}.md`（不加"学情反馈"）
- 上传文件名：`{name}{lesson}学情反馈.md`（要加）

---

## 协作模式

**Claude（你 = 开发端）** — 功能开发、bug 修复、通过 GitHub 分支推送代码、通过 COLLAB.md 与 Manus 沟通

**Manus（部署端）** — 合并分支 → 构建 → 部署 → checkpoint。沙箱环境有限制。也通过 COLLAB.md 沟通

### 推送后更新 COLLAB.md 的模板

```
**分支：** `claude/xxx`
**版本跨度：** Vxxx → Vxxx
**新增依赖：** 有/无
**数据库迁移：** 有/无

**Vxxx 变更（简述）：**
- 变更点1
- 变更点2

**部署操作（顺序重要）：**
1. git fetch origin
2. git merge origin/claude/xxx（应直接 fast-forward）
3. npm install（如有依赖变更）
4. npm run build
5. 先 checkpoint
6. 最后推 GitHub
```
