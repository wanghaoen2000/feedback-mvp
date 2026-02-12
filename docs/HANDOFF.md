# 新对话知识交接文档（Knowledge Handoff）

> **用途：** 当开始新对话时，通过引导词让新 Claude 阅读本文档，快速了解项目全貌、积累的经验、工作流程规范。
> **最后更新：** 2026-02-12

---

## 一、项目概述

**项目名称：** feedback-mvp（学情反馈系统）
**仓库：** https://github.com/wanghaoen2000/feedback-mvp
**部署环境：** Manus 沙箱服务器（manus.space，Ubuntu 22.04）
**用户语言：** 中文（简体）。所有 UI 文本必须用中文。

### 功能简述
这是一个面向教育培训场景的「学情反馈」生成系统：
1. **学情反馈生成**：老师上传/录入课堂语音转文字稿 → AI 生成学情反馈报告（支持一对一和小班课）
2. **作业管理系统**：语音转文字 → AI 结构化处理 → 学生状态跟踪与迭代更新
3. **测试本/课后信息提取**：从课堂记录中提取测试题目、课后作业等结构化信息
4. **气泡图生成**：将反馈内容可视化为 SVG 气泡图，渲染为 PNG 图片
5. **Google Drive 集成**：自动从 Drive 加载课堂录音转文字稿，自动上传生成的反馈文档

### 技术栈
| 层 | 技术 |
|----|------|
| 前端 | React 19 + TypeScript + Vite + TailwindCSS + shadcn/ui |
| 后端 | Express + tRPC |
| 数据库 | MySQL + Drizzle ORM |
| 文件存储 | Google Drive OAuth API（**不是 rclone！服务器上没装 rclone**） |
| SVG 渲染 | @resvg/resvg-js（**不是 sharp！sharp 在 ESM 构建中有问题**） |
| 构建 | esbuild（ESM 格式，所有包标记为 external） |

---

## 二、项目目录结构

```
feedback-mvp/
├── client/src/           # 前端 React 代码
│   ├── pages/            # 页面组件（Home.tsx, Settings.tsx, HomeworkManagement.tsx, TaskHistory.tsx）
│   ├── components/       # 可复用组件
│   ├── contexts/         # React Context
│   ├── hooks/            # 自定义 Hooks
│   └── version.generated.ts  # 构建产物（不要手动改！）
├── server/               # 后端 Express + tRPC
│   ├── index.ts          # 服务入口
│   ├── routers.ts        # tRPC 路由定义
│   ├── classStreamRoutes.ts  # SSE 流式端点
│   ├── feedbackGenerator.ts  # 反馈生成核心逻辑
│   ├── homeworkManager.ts    # 作业管理后端
│   ├── backgroundTaskRunner.ts  # 后台任务运行器
│   ├── gdrive.ts         # Google Drive OAuth API 封装
│   ├── db.ts             # 数据库连接
│   ├── core/             # 核心模块
│   │   └── aiClient.ts   # AI 客户端 + getConfigValue
│   └── templates/        # 模板文件
├── drizzle/              # 数据库迁移文件（⚠️ 只允许新增，不允许删除已有文件！）
│   ├── 0000-0007         # 早期迁移文件（journal 不同步，但无妨）
│   ├── 0008_background_tasks.sql  # 后台任务表
│   ├── 0009_homework_management.sql  # 作业管理表
│   ├── 0010_batch_tasks.sql  # 批量任务表
│   └── meta/             # Drizzle 元数据（不要修改！）
├── scripts/
│   └── generate-version.cjs  # ⚠️ 版本号源文件！改这里的 const VERSION
├── fonts/                # 字体文件（供 resvg 渲染中文）
├── docs/                 # 项目文档
│   ├── HANDOFF.md        # 本文档（知识交接）
│   └── deployment-collaboration.md  # 部署协作规范
├── COLLAB.md             # 协作看板（每次开始工作先读！）
└── package.json
```

---

## 三、关键架构与代码模式

### 3.1 版本号管理
- **源文件：** `scripts/generate-version.cjs` 里的 `const VERSION = 'Vxxx';`
- **构建产物：** `client/src/version.generated.ts`（构建时自动生成，不要手动改）
- **规则：** 每次推送前版本号 +1，作为单独 commit

### 3.2 数据库
- Drizzle ORM + MySQL
- **本地没有 DATABASE_URL**，不能跑 `drizzle-kit generate`
- 新建表用手写 SQL + `CREATE TABLE IF NOT EXISTS`（安全幂等）
- 新增字段用 `ALTER TABLE ... ADD COLUMN` 或启动时检查
- drizzle `_journal.json` 和实际 SQL 文件不同步（0003-0007），但不影响运行

### 3.3 Google Drive 集成
- OAuth scope 是 `drive`（完整访问权限，不是 `drive.file`）
- 关键函数：`navigateToFolder()`, `downloadFileById()`, `uploadToGoogleDrive()`, `uploadBinaryToGoogleDrive()`
- 都在 `server/gdrive.ts` 中

### 3.4 SSE 流式生成
- `server/classStreamRoutes.ts` 定义 SSE 端点
- 支持实时字符数回传（`invokeWithContinuation`）
- AbortController 支持客户端断开时中止 AI 流

### 3.5 后台任务系统
- `server/backgroundTaskRunner.ts` 负责离线安全的后台生成
- `background_tasks` 表存储任务状态
- 前端 `TaskHistory.tsx` 展示任务记录

### 3.6 作业管理系统
- 前端：`HomeworkManagement.tsx`
- 后端：`server/homeworkManager.ts`
- 表：`hw_students`（学生名册 + current_status 状态文档）、`hw_entries`（条目队列）
- 流程：语音 → AI处理 → 预入库队列 → 入库 → 更新学生状态

### 3.7 AI 配置读取
- `getConfigValue(key)` 从 `system_config` 表读配置
- 用于读取 API 密钥、模型预设、提示词模板等

### 3.8 文件命名约定（用户偏好）
- 搜索云盘文件时**不加**"学情反馈"后缀：`{name}{lesson}.md`, `{name} {lesson}.md`
- 上传文件名**要加**：`{name}{lesson}学情反馈.md`

---

## 四、开发工作流规范（⚠️ 必须遵守）

### 4.1 分支管理
```bash
# 1. 创建分支必须基于最新 origin/main
git fetch origin && git checkout -b claude/feature-name origin/main

# 2. 推送前必须 rebase
git fetch origin && git rebase origin/main

# 3. 推送
git push -u origin claude/feature-name
```

### 4.2 版本号更新（每次推送前必做）
1. Rebase 到最新 main 后，查看 `scripts/generate-version.cjs` 中的当前版本号
2. 版本号 +1
3. 作为单独 commit：`chore: 版本号更新为 Vxxx`
4. **只改 `scripts/generate-version.cjs`**，不改 `version.generated.ts`

### 4.3 数据库迁移
- `drizzle/` 下的已有文件**绝对不能删除**
- 只允许新增迁移文件（如 `0011_xxx.sql`）
- 用 `CREATE TABLE IF NOT EXISTS` 保证幂等

### 4.4 协作看板（COLLAB.md）
- **每次开始工作先读 `COLLAB.md`**，看 Manus 有没有反馈或请求
- 开发完后更新看板状态（添加新的部署任务到 "Claude → Manus" 区域）

### 4.5 发布说明模板
每次写发布说明，必须提醒 Manus 操作顺序：
```
⚠️ 操作顺序提醒：
合并 → npm install（如有依赖变更）→ npm run build →
先 checkpoint → 再 push GitHub
不要先 push GitHub 再 checkpoint，否则 checkpoint 会失败。
```

---

## 五、血泪教训（踩过的坑）

### 5.1 构建与环境
| 问题 | 教训 |
|------|------|
| ESM 构建不能用 `require()` | esbuild --format=esm，所有包标记为 external |
| Manus 沙箱访问不到 `/usr/share/fonts` | 字体文件必须放在项目 `fonts/` 目录中 |
| sharp 在 ESM 中报错 | 用 `@resvg/resvg-js` 替代 sharp 做 SVG 渲染 |
| 本地测试通过 ≠ 服务器能用 | 遇到环境问题：第一步加完整诊断日志一次收集全，不要逐步试错浪费版本号 |

### 5.2 Git 与部署
| 问题 | 教训 |
|------|------|
| 分支基于旧 main 创建 → 版本号回退 | **必须** `git checkout -b xxx origin/main`（不是本地 main） |
| 先推 GitHub 再 checkpoint → S3 历史分叉 | **先 checkpoint 再推 GitHub** |
| drizzle journal 不同步 | 别管它，手写 SQL 迁移就行 |

### 5.3 业务逻辑
| 问题 | 教训 |
|------|------|
| rclone 不存在 | 所有 Drive 操作必须用 OAuth API（gdrive.ts） |
| Zod schema 丢弃未声明字段 | 前端传的数据如果 schema 没声明就会被静默丢弃，很难发现 |
| AI 被语音转文字中的错误姓名误导 | 学生姓名注入系统提示词，优先级高于用户消息 |

---

## 六、关键文件快速索引

| 要做什么 | 看哪个文件 |
|---------|-----------|
| 了解协作状态和 Manus 反馈 | `COLLAB.md` |
| 修改版本号 | `scripts/generate-version.cjs` |
| 前端主页面 | `client/src/pages/Home.tsx` |
| 设置页面 | `client/src/pages/Settings.tsx` |
| 作业管理页面 | `client/src/pages/HomeworkManagement.tsx` |
| 任务记录页面 | `client/src/pages/TaskHistory.tsx` |
| 后端路由定义 | `server/routers.ts` |
| SSE 流式端点 | `server/classStreamRoutes.ts` |
| 反馈生成逻辑 | `server/feedbackGenerator.ts` |
| 作业管理后端 | `server/homeworkManager.ts` |
| 后台任务系统 | `server/backgroundTaskRunner.ts` |
| Google Drive API | `server/gdrive.ts` |
| AI 客户端和配置 | `server/core/aiClient.ts` |
| 数据库连接 | `server/db.ts` |
| 数据库迁移 | `drizzle/` 目录 |
| 部署协作规范 | `docs/deployment-collaboration.md` |

---

## 七、协作双方介绍

### Claude（开发端 — 就是你）
- 负责所有代码开发、bug 修复、功能实现
- 通过 GitHub 分支推送代码
- 通过 COLLAB.md 与 Manus 沟通

### Manus（部署端）
- 负责合并分支、构建、部署到服务器
- 通过 checkpoint 保存状态
- 沙箱环境有限制（如字体访问、网络等）
- 也通过 COLLAB.md 与 Claude 沟通

### 项目负责人（用户）
- 中文沟通
- 提出功能需求、反馈 bug
- 查看 COLLAB.md 了解双方协作状态

---

## 八、新对话开始时的检查清单

1. ✅ 读取本文档（`docs/HANDOFF.md`）了解项目全貌
2. ✅ 读取 `docs/deployment-collaboration.md` 了解部署协作规范
3. ✅ 读取 `COLLAB.md` 看 Manus 是否有新反馈或请求
4. ✅ 读取 `scripts/generate-version.cjs` 确认当前版本号
5. ✅ 确认当前在哪个分支（`git branch`）
6. ✅ 如果要开新功能，基于 `origin/main` 创建新分支
7. ✅ 开发完成后更新 COLLAB.md 的部署任务
8. ✅ 推送前 rebase + 版本号 +1
