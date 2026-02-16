/**
 * 技术手册 — 第一章：系统概述与架构总览
 * 运行方式：node scripts/gen-doc-chapter1.cjs
 * 输出：docs/第一章_系统概述与架构总览.docx
 */

const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, BorderStyle,
  AlignmentType, Tab, TabStopPosition, TabStopType,
  PageBreak, ShadingType, convertInchesToTwip,
} = require("docx");
const fs = require("fs");
const path = require("path");

// ============================================================
// 工具函数
// ============================================================

/** 普通正文段落 */
function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120, line: 360 },
    ...opts,
    children: [
      new TextRun({
        text,
        font: "微软雅黑",
        size: 21, // 10.5pt
        ...opts.run,
      }),
    ],
  });
}

/** 加粗正文 */
function pb(text, opts = {}) {
  return p(text, { ...opts, run: { bold: true, ...opts.run } });
}

/** 多段文字组合的段落 */
function pMulti(runs, opts = {}) {
  return new Paragraph({
    spacing: { after: 120, line: 360 },
    ...opts,
    children: runs.map(r => {
      if (typeof r === "string") {
        return new TextRun({ text: r, font: "微软雅黑", size: 21 });
      }
      const { text, ...rest } = r;
      return new TextRun({ text, font: "微软雅黑", size: 21, ...rest });
    }),
  });
}

/** 标题（H1~H3） */
function heading(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({
    heading: level,
    spacing: { before: 240, after: 120 },
    children: [
      new TextRun({
        text,
        font: "微软雅黑",
        size: level === HeadingLevel.HEADING_1 ? 32 : level === HeadingLevel.HEADING_2 ? 26 : 22,
        bold: true,
      }),
    ],
  });
}

/** 项目符号列表项 */
function bullet(text, level = 0) {
  return new Paragraph({
    spacing: { after: 60, line: 340 },
    indent: { left: convertInchesToTwip(0.3 + level * 0.3) },
    children: [
      new TextRun({ text: level === 0 ? "● " : "○ ", font: "微软雅黑", size: 21 }),
      new TextRun({ text, font: "微软雅黑", size: 21 }),
    ],
  });
}

/** 多行文本的项目符号 */
function bulletMulti(runs, level = 0) {
  const children = [
    new TextRun({ text: level === 0 ? "● " : "○ ", font: "微软雅黑", size: 21 }),
  ];
  for (const r of runs) {
    if (typeof r === "string") {
      children.push(new TextRun({ text: r, font: "微软雅黑", size: 21 }));
    } else {
      const { text, ...rest } = r;
      children.push(new TextRun({ text, font: "微软雅黑", size: 21, ...rest }));
    }
  }
  return new Paragraph({
    spacing: { after: 60, line: 340 },
    indent: { left: convertInchesToTwip(0.3 + level * 0.3) },
    children,
  });
}

/** 代码块（等宽字体灰底） */
function code(text) {
  return new Paragraph({
    spacing: { after: 80, line: 300 },
    shading: { type: ShadingType.SOLID, color: "F5F5F5", fill: "F5F5F5" },
    indent: { left: convertInchesToTwip(0.3) },
    children: [
      new TextRun({
        text,
        font: "Consolas",
        size: 18,
        color: "333333",
      }),
    ],
  });
}

/** 表格单元格 */
function cell(text, opts = {}) {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.shading ? { type: ShadingType.SOLID, color: opts.shading, fill: opts.shading } : undefined,
    children: [
      new Paragraph({
        spacing: { after: 40 },
        children: [
          new TextRun({
            text,
            font: "微软雅黑",
            size: 18,
            bold: !!opts.bold,
            color: opts.color || "000000",
          }),
        ],
      }),
    ],
  });
}

/** 表格辅助函数 */
function table(headers, rows) {
  const headerRow = new TableRow({
    children: headers.map(h => cell(h, { bold: true, shading: "D9E2F3" })),
  });
  const dataRows = rows.map(
    row => new TableRow({
      children: row.map(c => cell(c)),
    })
  );
  return new Table({
    rows: [headerRow, ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

/** 空行 */
function blank() {
  return new Paragraph({ spacing: { after: 120 }, children: [] });
}

// ============================================================
// 文档内容
// ============================================================

function buildChapter1() {
  const sections = [];

  // ──────────── 封面 ────────────
  sections.push(
    blank(), blank(), blank(), blank(), blank(), blank(),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({ text: "学情反馈系统", font: "微软雅黑", size: 52, bold: true }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [
        new TextRun({ text: "feedback-mvp", font: "Consolas", size: 28, color: "666666" }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [
        new TextRun({ text: "技术手册 — 第一章：系统概述与架构总览", font: "微软雅黑", size: 28, color: "333333" }),
      ],
    }),
    blank(),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: `版本 V179  |  ${new Date().toISOString().slice(0, 10)}`, font: "微软雅黑", size: 21, color: "888888" }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: "文档基于代码库自动生成", font: "微软雅黑", size: 18, color: "AAAAAA", italics: true }),
      ],
    }),
    // 分页
    new Paragraph({ children: [new PageBreak()] }),
  );

  // ──────────── 1.1 项目背景 ────────────
  sections.push(
    heading("第一章  系统概述与架构总览"),
    blank(),
    heading("1.1  项目背景", HeadingLevel.HEADING_2),
    p("「学情反馈系统」（项目代号 feedback-mvp）是一个面向教育行业的智能教学辅助平台，核心目标是利用 AI 能力自动化生成课后学情反馈报告，同时提供作业管理、作业批改、批量文档处理等配套功能。"),
    blank(),
    pb("系统解决的核心痛点："),
    bullet("教师每次课后需要花费大量时间手工撰写学情反馈，包括课堂表现总结、知识点掌握分析、复习建议等。"),
    bullet("作业批改需要逐一处理文字、图片等多模态输入，效率低下。"),
    bullet("学生状态跟踪分散在各处，缺乏系统化管理。"),
    blank(),
    pb("系统的目标用户："),
    bullet("一对一辅导教师（主要场景）"),
    bullet("小班课教师（3~10 人班级）"),
    bullet("教学管理者（查看系统运行状态、管理用户权限）"),
    blank(),
    pb("系统的核心价值："),
    bullet("一键生成课后学情反馈（Markdown 格式），自动上传至 Google Drive"),
    bullet("同时并行生成复习文档、测试本（Word 格式）和气泡图（PNG 格式）"),
    bullet("支持后台执行 — 提交任务后可关闭浏览器，任务在服务端继续完成"),
    bullet("作业管理系统支持语音输入 → AI 结构化 → 学生状态迭代更新"),
    bullet("作业批改系统支持文字 + 图片 + 文件多模态输入，AI 自动批改并回写学生状态"),
    bullet("批量处理系统支持一次性处理数十到上百个文档生成任务"),
  );

  // ──────────── 1.2 技术栈 ────────────
  sections.push(
    new Paragraph({ children: [new PageBreak()] }),
    heading("1.2  技术栈总览", HeadingLevel.HEADING_2),
    p("系统采用全栈 TypeScript 架构，前后端共享类型定义，通过 tRPC 实现端到端类型安全的 API 调用。"),
    blank(),
    heading("1.2.1  前端技术栈", HeadingLevel.HEADING_3),
    table(
      ["技术", "版本", "用途", "备注"],
      [
        ["React", "19.2", "UI 框架", "使用最新的 React 19 并发特性"],
        ["TypeScript", "5.9", "类型系统", "全栈共享类型"],
        ["Vite", "7.1", "构建工具", "开发热重载 + 生产构建"],
        ["Tailwind CSS", "4.x", "样式框架", "原子化 CSS，v4 使用新的配置方式"],
        ["shadcn/ui", "-", "组件库", "基于 Radix UI 的无头组件"],
        ["@tanstack/react-query", "5.90", "数据获取", "服务端状态缓存与同步"],
        ["@trpc/react-query", "11.6", "API 客户端", "与后端 tRPC 路由端到端类型安全"],
        ["Recharts", "2.15", "图表", "气泡图可视化"],
        ["framer-motion", "12.x", "动画", "页面过渡和微交互"],
      ]
    ),
    blank(),
    heading("1.2.2  后端技术栈", HeadingLevel.HEADING_3),
    table(
      ["技术", "版本", "用途", "备注"],
      [
        ["Node.js", "22.x", "运行时", "ESM 模式，不能用 require()"],
        ["Express", "4.21", "HTTP 服务器", "中间件架构，15 分钟超时"],
        ["tRPC", "11.6", "RPC 框架", "类型安全的 API 层"],
        ["Drizzle ORM", "0.44", "数据库 ORM", "轻量级，支持原生 SQL"],
        ["MySQL", "8.x", "关系数据库", "通过 mysql2 驱动连接"],
        ["esbuild", "0.25", "后端构建", "ESM bundle，不用 webpack"],
        ["@resvg/resvg-js", "2.6", "SVG → PNG", "替代 sharp，支持中文字体"],
        ["mammoth", "1.11", "DOCX 文本提取", "用于作业批改的文件处理"],
        ["pdf-parse", "2.4", "PDF 文本提取", "用于作业批改的文件处理"],
      ]
    ),
    blank(),
    heading("1.2.3  外部服务依赖", HeadingLevel.HEADING_3),
    table(
      ["服务", "用途", "接入方式"],
      [
        ["AI API（多供应商）", "文本生成、批改、信息提取", "自定义 HTTP 客户端，支持流式输出"],
        ["Google Drive", "文件存储与分享", "OAuth 2.0 API（非 rclone）"],
        ["Manus 平台", "用户认证与托管", "OAuth 回调 + iframe 嵌入"],
      ]
    ),
    blank(),
    pMulti([
      { text: "重要提醒：", bold: true },
      "Google Drive 的接入方式是 OAuth API（封装在 server/gdrive.ts），",
      { text: "不是 rclone", bold: true, underline: {} },
      "。这是历史开发中的一个常见误解。",
    ]),
  );

  // ──────────── 1.3 系统架构 ────────────
  sections.push(
    new Paragraph({ children: [new PageBreak()] }),
    heading("1.3  系统架构", HeadingLevel.HEADING_2),

    heading("1.3.1  整体分层", HeadingLevel.HEADING_3),
    p("系统采用经典的三层架构，外加异步任务层："),
    blank(),
    code("┌─────────────────────────────────────────────────────────┐"),
    code("│                    浏览器（前端）                         │"),
    code("│  React 19 + Tailwind + shadcn/ui + tRPC Client          │"),
    code("│  ┌──────────┬──────────┬──────────┬──────────┐          │"),
    code("│  │ 课堂反馈  │ 学生管理  │ 作业批改  │ 批量处理  │          │"),
    code("│  └──────────┴──────────┴──────────┴──────────┘          │"),
    code("├─────────────────────────────────────────────────────────┤"),
    code("│               Express + tRPC Server                     │"),
    code("│  ┌──────────────────┬────────────────────────┐          │"),
    code("│  │   tRPC 路由       │   SSE 流式端点          │          │"),
    code("│  │  (JSON-RPC)      │  (Server-Sent Events)  │          │"),
    code("│  └────────┬─────────┴────────────┬───────────┘          │"),
    code("│           │                      │                      │"),
    code("│  ┌────────▼──────────────────────▼───────────┐          │"),
    code("│  │          核心业务逻辑层                      │          │"),
    code("│  │  feedbackGenerator / homeworkManager /     │          │"),
    code("│  │  correctionRunner / batchExecutor          │          │"),
    code("│  └────────┬──────────────────────┬───────────┘          │"),
    code("│           │                      │                      │"),
    code("│  ┌────────▼────────┐  ┌──────────▼───────────┐          │"),
    code("│  │  后台任务调度器   │  │  AI 客户端 (aiClient) │          │"),
    code("│  │  backgroundTask │  │  流式/非流式 API 调用   │          │"),
    code("│  │  batchTask      │  └──────────────────────┘          │"),
    code("│  └────────┬────────┘                                    │"),
    code("├───────────┼─────────────────────────────────────────────┤"),
    code("│  ┌────────▼────────┐  ┌─────────────────────┐          │"),
    code("│  │  MySQL (Drizzle) │  │  Google Drive (OAuth)│          │"),
    code("│  │  13 张数据表      │  │  文件上传/下载/搜索   │          │"),
    code("│  └─────────────────┘  └─────────────────────┘          │"),
    code("└─────────────────────────────────────────────────────────┘"),
    blank(),

    heading("1.3.2  通信机制", HeadingLevel.HEADING_3),
    p("系统使用两种前后端通信方式，各有其适用场景："),
    blank(),
    pb("1. tRPC（JSON-RPC over HTTP）"),
    bullet("用于所有非流式的请求-响应操作（增删改查、配置管理、任务提交等）"),
    bullet("端到端类型安全：前端调用 trpc.xxx.yyy() 时，TypeScript 自动推断参数和返回值类型"),
    bullet("统一的错误处理：所有错误通过 TRPCError 抛出，前端统一 catch"),
    bullet("请求路径：/api/trpc/*"),
    blank(),
    pb("2. SSE（Server-Sent Events）"),
    bullet("用于实时流式生成（学情反馈、复习文档、测试本等长时间 AI 生成任务）"),
    bullet("单向推送：服务器持续向客户端发送文本片段，客户端拼接显示"),
    bullet("事件类型：start（开始）→ progress（进度/文本块）→ complete（完成）或 error（失败）"),
    bullet("支持客户端中断：前端关闭连接后，后端通过 AbortController 取消 AI 调用"),
    bullet("请求路径：/api/feedback-stream、/api/class-feedback-stream、/api/review-stream 等"),
    blank(),
    pMulti([
      { text: "设计决策：", bold: true },
      "为什么同时用 tRPC 和 SSE？tRPC 不原生支持 Server-Sent Events 的流式推送。tRPC 的 subscription 机制基于 WebSocket，",
      "但本系统不需要双向通信，SSE 更轻量且无需额外的 WebSocket 服务。因此，普通操作走 tRPC，流式生成走原生 Express SSE 端点。",
    ]),

    blank(),
    heading("1.3.3  认证与权限", HeadingLevel.HEADING_3),
    p("系统通过 Manus 平台的 OAuth 实现用户认证，登录后使用 Cookie-based Session 维持会话。"),
    blank(),
    pb("用户角色："),
    table(
      ["角色", "权限范围", "典型操作"],
      [
        ["user（普通用户）", "只能操作自己的数据", "生成反馈、管理自己的学生、批改作业"],
        ["admin（管理员）", "可管理所有用户", "创建/暂停/删除用户、修改角色、伪装登录"],
      ]
    ),
    blank(),
    pb("权限守卫（三级）："),
    bullet("publicProcedure — 不需要登录（仅用于 auth.me 和 auth.logout）"),
    bullet("protectedProcedure — 需要有效登录且账号状态为 active"),
    bullet("adminProcedure — 需要 admin 角色"),
    blank(),
    pb("数据隔离机制："),
    p("所有用户数据表都包含 userId 列，每次查询和写入都以当前登录用户的 userId 作为过滤条件。即使知道其他用户的数据 ID，也无法跨用户访问。管理员通过「伪装登录」（impersonate）功能切换身份来查看/调试其他用户的数据，而不是直接绕过隔离。"),
  );

  // ──────────── 1.4 功能模块总览 ────────────
  sections.push(
    new Paragraph({ children: [new PageBreak()] }),
    heading("1.4  功能模块总览", HeadingLevel.HEADING_2),
    p("系统的前端界面以顶部 Tab 页组织，共包含四大功能模块，外加全局设置和路书管理两个弹窗："),
    blank(),

    heading("1.4.1  课堂反馈（Tab 1）", HeadingLevel.HEADING_3),
    p("核心功能模块，支持一对一和小班课两种模式，完成从输入到输出的完整反馈生成流水线。"),
    blank(),
    pb("生成产物（5 步流水线）："),
    table(
      ["步骤", "产物", "格式", "说明"],
      [
        ["1. 学情反馈", "课后反馈报告", "Markdown → Google Drive", "主报告，包含课堂表现、知识点分析、建议等"],
        ["2. 复习文档", "复习资料", "DOCX → Google Drive", "根据反馈内容生成结构化复习材料"],
        ["3. 测试本", "测试题", "DOCX → Google Drive", "根据课程内容生成测试题和答案"],
        ["4. 课后信息提取", "结构化数据", "Markdown → Google Drive", "提取课程关键信息，可导入作业管理"],
        ["5. 气泡图", "可视化图表", "PNG → Google Drive", "学生各维度表现的气泡图"],
      ]
    ),
    blank(),
    pb("输入材料："),
    bullet("上次课反馈 — 可从 Google Drive 自动读取，也可手动粘贴/上传"),
    bullet("课堂笔记（必填） — 可从本地下载目录自动读取，也可手动粘贴/上传"),
    bullet("录音转文字（必填） — 可从本地下载目录自动读取，支持多段录音合并"),
    blank(),
    pb("执行模式："),
    bullet("实时模式（SSE）— 页面保持打开，实时看到生成进度和文本"),
    bullet("后台模式（Background Task）— 提交后可关闭页面，通过「任务记录」查看状态"),

    blank(),
    heading("1.4.2  学生管理（Tab 2）", HeadingLevel.HEADING_3),
    p("管理学生名册和作业状态，是教学管理的核心模块。"),
    blank(),
    pb("子功能："),
    bullet("学生名册 — 添加/删除学生，设置日计划/周计划类型"),
    bullet("语音输入处理 — 语音转文字 → AI 结构化 → 预入库队列 → 确认入库"),
    bullet("学生状态管理 — 每个学生维护一个「当前状态」文档，每次入库迭代更新"),
    bullet("一键打分 — 选择日期范围 + 打分要求，AI 为全部学生批量生成评分"),
    bullet("打分同步 — 打分结果可一键同步回各学生的状态文档"),
    bullet("作业提醒 — AI 根据学生状态生成个性化提醒文案"),
    bullet("数据备份/恢复 — 导出/导入学生数据（Markdown 格式），支持 Google Drive 自动备份"),

    blank(),
    heading("1.4.3  作业批改（Tab 3）", HeadingLevel.HEADING_3),
    p("支持多模态输入的 AI 自动批改系统。"),
    blank(),
    pb("输入方式："),
    bullet("文字输入 — 直接粘贴文本"),
    bullet("图片输入 — 拖拽/粘贴/上传图片（自动压缩，支持多张）"),
    bullet("文件输入 — 上传 Word (.docx)、PDF (.pdf)、文本 (.txt) 文件"),
    blank(),
    pb("批改类型（可自定义）："),
    bullet("豆包翻译 — 检查翻译准确性、流畅性、用词"),
    bullet("学术文章 — 检查论点逻辑、论据、用语规范性"),
    bullet("日常文章 — 检查语法、用词、表达地道性"),
    bullet("词汇填空 — 检查答案正确性、解释错误选项"),
    blank(),
    pb("输出："),
    bullet("批改结果 — 详细的批改内容，一键复制"),
    bullet("状态更新 — 自动推送到学生管理系统，更新学生的当前状态"),

    blank(),
    heading("1.4.4  批量处理（Tab 4）", HeadingLevel.HEADING_3),
    p("面向需要一次性处理大量文档的场景，如批量生成教学材料。"),
    blank(),
    pb("核心特性："),
    bullet("支持指定任务编号范围（如 1~100）"),
    bullet("可控并发数（默认 50，上限 200）"),
    bullet("多种输出模板：教学材料（带样式）、通用文档、Markdown、词汇卡片、写作素材"),
    bullet("支持独立文件（每个任务一个）和共享文件（所有任务共用）"),
    bullet("实时进度追踪，单个子任务失败可独立重试"),

    blank(),
    heading("1.4.5  全局设置与路书管理", HeadingLevel.HEADING_3),
    pb("全局设置（弹窗）："),
    bullet("API 配置 — 模型选择、API Key、API 地址、最大 Token 数"),
    bullet("API 供应商预设 — 预配置多个供应商，一键切换"),
    bullet("Google Drive 连接 — OAuth 授权/断开"),
    bullet("存储路径 — Google Drive 基础路径、分类路径、本地路径"),
    bullet("系统诊断 — 一键检测 API、Drive、数据库等各项连通性"),
    bullet("管理员面板 — 用户管理（创建/暂停/删除/伪装/改角色）"),
    blank(),
    pb("路书及范例管理（弹窗）："),
    bullet("一对一路书 — 指导 AI 生成反馈的风格、格式、重点"),
    bullet("小班课路书 — 小班课专用的 AI 指导模板"),
    bullet("首次课范例 — 新生第一次课的反馈模板（一对一 + 小班课各一份）"),
  );

  // ──────────── 1.5 项目文件结构 ────────────
  sections.push(
    new Paragraph({ children: [new PageBreak()] }),
    heading("1.5  项目文件结构", HeadingLevel.HEADING_2),
    p("以下是项目的核心文件结构及各文件的职责说明："),
    blank(),
    heading("1.5.1  前端文件", HeadingLevel.HEADING_3),
    table(
      ["文件路径", "职责"],
      [
        ["client/src/App.tsx", "应用根组件，路由定义"],
        ["client/src/pages/Home.tsx", "主页面（4000+ 行），包含所有 Tab 和核心逻辑"],
        ["client/src/components/TaskHistory.tsx", "任务记录组件（课堂反馈历史）"],
        ["client/src/components/HomeworkManagement.tsx", "学生管理组件"],
        ["client/src/components/HomeworkCorrection.tsx", "作业批改组件"],
        ["client/src/components/BatchProcess.tsx", "批量处理组件"],
        ["client/src/components/GlobalSettings.tsx", "全局设置弹窗"],
        ["client/src/components/RoadmapSettings.tsx", "路书及范例管理弹窗"],
      ]
    ),
    blank(),
    heading("1.5.2  后端文件", HeadingLevel.HEADING_3),
    table(
      ["文件路径", "职责"],
      [
        ["server/_core/index.ts", "服务器入口，Express 初始化、中间件注册"],
        ["server/_core/authMiddleware.ts", "认证中间件（requireAuth / optionalAuth）"],
        ["server/_core/cookies.ts", "Cookie 安全配置（httpOnly、SameSite、Secure）"],
        ["server/routers.ts", "所有 tRPC 路由定义（核心 API 层）"],
        ["server/classStreamRoutes.ts", "所有 SSE 流式端点定义"],
        ["server/feedbackGenerator.ts", "反馈生成核心逻辑（5 步流水线）"],
        ["server/backgroundTaskRunner.ts", "后台任务调度与执行"],
        ["server/batchTaskRunner.ts", "批量任务调度"],
        ["server/batchExecutor.ts", "批量任务子项执行"],
        ["server/homeworkManager.ts", "作业管理核心逻辑（学生、条目、备份）"],
        ["server/correctionRunner.ts", "作业批改任务执行"],
        ["server/gdrive.ts", "Google Drive API 封装"],
        ["server/core/aiClient.ts", "AI 客户端与配置管理"],
        ["server/db.ts", "数据库连接与用户管理"],
      ]
    ),
    blank(),
    heading("1.5.3  数据库与配置文件", HeadingLevel.HEADING_3),
    table(
      ["文件路径", "职责"],
      [
        ["drizzle/schema.ts", "Drizzle ORM 表定义（13 张表）"],
        ["drizzle/0000~0013_*.sql", "数据库迁移文件（只增不删）"],
        ["scripts/generate-version.cjs", "版本号管理（每次发布手动更新）"],
        ["vite.config.ts", "Vite 构建配置（前端 + 路径别名）"],
        [".env", "环境变量（DATABASE_URL、OAuth 密钥等）"],
        ["COLLAB.md", "Claude ↔ Manus 协作看板"],
        ["CLAUDE.md", "Claude Code 开发指南"],
      ]
    ),
  );

  // ──────────── 1.6 版本与协作 ────────────
  sections.push(
    new Paragraph({ children: [new PageBreak()] }),
    heading("1.6  版本管理与协作模式", HeadingLevel.HEADING_2),

    heading("1.6.1  版本号规则", HeadingLevel.HEADING_3),
    p("系统使用简单递增版本号（V1、V2、……V179），不使用语义化版本。每次发布前手动更新 scripts/generate-version.cjs 中的 VERSION 常量。构建时自动生成 version.generated.ts，前端显示在页面右上角。"),
    blank(),
    pb("当前版本：V179"),
    p("版本从 V1 迭代至今，经历了从最初的基础反馈生成到完整的教学辅助平台的演进。"),

    blank(),
    heading("1.6.2  协作模式", HeadingLevel.HEADING_3),
    p("项目采用双角色协作开发模式："),
    blank(),
    table(
      ["角色", "职责", "工具"],
      [
        ["Claude（开发端）", "功能开发、Bug 修复、推送 GitHub 分支", "Claude Code CLI"],
        ["Manus（部署端）", "合并分支 → 构建 → 部署 → Checkpoint", "Manus 沙箱环境"],
      ]
    ),
    blank(),
    p("两端通过 COLLAB.md 文件进行异步沟通。Claude 在推送代码前将变更说明写入 COLLAB.md 的「Claude → Manus」区域，Manus 部署后在「Manus 反馈区」填写部署结果。"),
    blank(),
    pb("部署流程（严格顺序）："),
    bullet("1. git fetch origin"),
    bullet("2. git merge origin/claude/xxx（应直接 fast-forward）"),
    bullet("3. npm install（如有依赖变更）"),
    bullet("4. npm run build"),
    bullet("5. 先 checkpoint（保存沙箱快照）"),
    bullet("6. 最后推 GitHub（checkpoint 之后）"),
    blank(),
    pMulti([
      { text: "顺序原因：", bold: true },
      "Manus 的 checkpoint 会把 Git remote 切换到 S3 地址。如果先推了 GitHub 再 checkpoint，本地历史和 S3 历史会分叉，导致后续 checkpoint 失败。",
    ]),
  );

  // ──────────── 1.7 运行环境 ────────────
  sections.push(
    blank(),
    heading("1.7  运行环境要求", HeadingLevel.HEADING_2),
    table(
      ["项目", "要求", "说明"],
      [
        ["Node.js", "≥ 22.x", "使用 ESM 模式，低版本可能不兼容"],
        ["MySQL", "≥ 8.0", "支持 JSON 类型和 MEDIUMTEXT"],
        ["操作系统", "Linux / macOS", "部署在 Manus 沙箱（Ubuntu 22.04）"],
        ["字体文件", "WenQuanYi Zen Hei 或 Noto Sans CJK", "放在项目 fonts/ 目录，用于 SVG→PNG 渲染"],
        ["网络", "需要访问外部 AI API 和 Google Drive API", "无法离线运行"],
      ]
    ),
    blank(),
    heading("1.7.1  环境变量", HeadingLevel.HEADING_3),
    table(
      ["变量名", "必填", "说明"],
      [
        ["DATABASE_URL", "是", "MySQL 连接字符串，如 mysql://user:pass@host:3306/dbname"],
        ["OWNER_OPEN_ID", "是", "系统 Owner 的 Manus OpenID，用于初始管理员权限"],
        ["GOOGLE_OAUTH_CLIENT_ID", "是", "Google Cloud Console 的 OAuth Client ID"],
        ["GOOGLE_OAUTH_CLIENT_SECRET", "是", "Google Cloud Console 的 OAuth Client Secret"],
        ["NODE_ENV", "否", "production 或 development，影响日志级别和静态文件服务"],
        ["PORT", "否", "服务端口，默认 3000（被占用时自动递增）"],
      ]
    ),
    blank(),
    pMulti([
      { text: "注意：", bold: true },
      "AI API 的密钥和地址不通过环境变量配置，而是存储在数据库的 system_config / user_config 表中，",
      "通过前端「全局设置」界面管理。这是因为系统支持多用户各自配置不同的 AI 供应商。",
    ]),
  );

  return sections;
}

// ============================================================
// 生成 Word 文件
// ============================================================

async function main() {
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: "微软雅黑", size: 21 },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(1),
            bottom: convertInchesToTwip(1),
            left: convertInchesToTwip(1.2),
            right: convertInchesToTwip(1),
          },
        },
      },
      children: buildChapter1(),
    }],
  });

  const outDir = path.join(__dirname, "..", "docs");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outPath = path.join(outDir, "第一章_系统概述与架构总览.docx");
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buffer);
  console.log(`✅ 已生成：${outPath}  (${(buffer.length / 1024).toFixed(1)} KB)`);
}

main().catch(err => {
  console.error("生成失败：", err);
  process.exit(1);
});
