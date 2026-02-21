# Claude ↔ Manus 协作看板

> **使用说明：** 这个文件是开发端（Claude）和部署端（Manus）之间的共享沟通文档。
> 双方在各自工作时应先读取此文件，了解对方的请求和反馈，然后更新自己的部分。
> 项目负责人可以随时查看此文件了解双方协作状态。

---

## 一、待办事项（互相请求）

### Claude → Manus（开发端请求部署端执行）

- [x] **【已部署】V148 ~ V169：作业管理系统 + 课后信息导入 + Bug修复 + 已入库记录浏览 + 任务记录导入按钮 + 提示词管理 + 学生姓名注入系统提示词 + 移除补充说明 + 迭代更新系统 + 导入AI处理修复 + 报错信息优化 + 作业管理UI优化 + 当前状态复制按钮 + API供应商预设 + 批量并发上限修复 + 实时进度显示修复 + 项目文档整理**

  **分支：** `claude/auto-load-student-files-thGk8`
  **版本跨度：** V147 → V169（21个版本）
  **新增依赖：** 无（无需 npm install）
  **数据库迁移：** 有（新增 `drizzle/0009_homework_management.sql`，CREATE TABLE IF NOT EXISTS，安全幂等）

  **V148 变更（作业管理系统 MVP）：**
  - 新增「作业管理」Tab 页（主界面顶部新标签）
  - 学生名册管理（点选按钮选择学生，日计划/周计划标记）
  - 语音转文字输入 → AI 结构化处理（与反馈系统共用模型预设库，独立记忆上次模型选择）
  - 预入库队列（查看/重试/删除/一键入库）
  - 新增数据库表：`hw_students`（学生名册）、`hw_entries`（条目队列）
  - 新增文件：`HomeworkManagement.tsx`、`server/homeworkManager.ts`、`drizzle/0009_homework_management.sql`

  **V149 变更（课后信息提取 → 作业管理导入）：**
  - 课后信息提取（步骤4）成功后，新增「导入作业管理」按钮
  - 一键将课后信息提取内容导入作业管理系统的预入库队列
  - 自动创建学生名册记录（如该学生尚未添加）
  - 服务端直接从后台任务读取内容，前端只需一次 API 调用
  - 导入状态实时反馈（加载中/已导入/失败可重试）

  **V150 变更（作业管理 Bug 修复）：**
  - 修复 `updateStudent` 字段映射错误：用了 snake_case (plan_type) 而非 Drizzle 的 camelCase (planType)，导致切换日/周计划无法保存到数据库
  - 修复 `addStudent` 重复名处理：删除过的学生（inactive）再添加同名会报 UNIQUE 约束错误，改为自动重新激活
  - 修复 `importFromExtraction` 不激活 inactive 学生：课后信息导入时，如果学生之前被删除过，会保持 inactive 状态导致名册中不可见

  **V151 变更（已入库记录浏览）：**
  - 选中学生后，可点击「已入库记录」按钮查看该学生的所有历史入库记录
  - 记录按时间倒序排列，折叠时显示 AI 解析结果摘要
  - 展开可查看完整 AI 解析结果、原文、使用模型
  - 入库操作后自动刷新记录列表
  - 新增 `listStudentEntries` API（按学生名+分页查询 confirmed 条目）

  **V152 变更（任务记录添加导入按钮）：**
  - 任务记录（TaskHistory）展开详情时，已完成的1对1课程任务显示「导入作业管理」按钮
  - 与主生成页面的导入功能一致，调用 `homework.importFromTask` API
  - 自动从 displayName 提取学生姓名
  - 支持加载中/成功/失败状态反馈，失败可重试

  **V153 变更（已入库记录去折叠 + 作业管理提示词系统）：**
  - 已入库记录不再折叠，选中学生后直接展开显示所有记录完整内容
  - 新增「作业管理提示词」功能：
    - UI：顶部新增「提示词」按钮，展开后可编辑/保存/清空提示词（类似路书管理）
    - 后端：`hwPromptTemplate` 配置项存储在 `system_config` 表，无需新建表
    - AI处理：配置了提示词后自动替代默认系统提示词
    - 系统时间戳：每次AI处理自动注入北京时间（年月日+时分+星期）
  - 未配置提示词时使用原有默认格式作为兜底

  **V154 变更（学生姓名注入系统提示词）：**
  - 学生姓名从用户消息提升到系统提示词，AI 优先级更高
  - 系统提示词明确告诉 AI：「以此处系统提供的姓名为唯一标准，不要被语音转文字带跑」
  - 覆盖所有路径：学情反馈（一对一+小班课）、作业管理、SSE 流式路径
  - 作业管理的用户消息不再重复发送学生姓名和警告语（已移至系统提示词）
  - 无前端改动，纯后端优化

  **V155 变更（移除作业管理「补充说明」字段）：**
  - 删除前端「设置」面板和补充说明输入框（功能冗余，固定规则在提示词中配置，临时信息在主输入框说明）
  - 清理后端 supplementaryNotes 参数（submitEntry、retryEntry、processEntry、getConfig、updateConfig）
  - 无数据库变更

  **V156 变更（作业管理迭代更新系统）：**
  - `hw_students` 表新增 `current_status` 字段，存储每个学生的正式状态文档
  - 入库时自动取每个学生最新预入库条目的内容保存为 `current_status`
  - 入库后删除预入库记录（旧记录不保留，状态已存入 current_status）
  - AI处理时自动读取学生当前状态，在此基础上迭代更新（不再每次从零开始）
  - 前端「已入库记录」列表替换为「当前状态」单文档展示
  - 新增 `getStudentStatus` API
  - 数据库变更：ALTER TABLE 自动添加列，服务启动时执行，无需手动操作

  **V158 变更（导入作业管理AI处理修复）：**
  - 修复「导入作业管理」跳过AI处理的严重Bug
  - 之前：课后信息提取内容直接复制为 `pre_staged` 条目，没有经过AI转换
  - 之后：创建 `pending` 条目 → 后台AI处理（转换格式+迭代更新）→ `pre_staged`
  - 影响范围：任务记录页和主页的「导入作业管理」按钮均已修复
  - 无前端改动，无数据库变更

  **V159 变更（报错信息展示优化）：**
  - 报错信息不再被截断：TaskHistory、BatchProcess 中去掉 `truncate`，错误移到独立行显示
  - 小班课报错中文化：补全与一对一相同的错误翻译逻辑（401/403/429/超时/余额不足等）
  - Home.tsx 错误详情框和步骤报错增加 `break-words` + `whitespace-pre-wrap`，长报错可自动换行
  - ErrorBoundary 英文改中文（"出现了意外错误"/"重新加载页面"）
  - 纯前端改动，无后端/数据库变更

  **V160 变更（作业管理UI优化）：**
  - 提示词文本框：固定高度（约半屏），超长内容内部滚动，右侧一键到顶/到底按钮
  - 预入库条目展开：AI处理结果放上面（蓝色醒目标题），原文放下面
  - 重试按钮：失败和待入库状态均可重试，方便模型不对时重新生成
  - 删除/重试按钮增加确认弹窗，防止误触
  - 按钮尺寸和间距加大，手机端更好操作
  - 服务端 retryEntry 支持 pre_staged 状态重试

  **V161 变更（当前状态一键复制）：**
  - 学生「当前状态」区域标题栏新增「复制」按钮
  - 点击后一键复制完整状态文本到剪贴板
  - 复制成功后显示绿色「已复制」，2秒后自动恢复
  - 兼容旧浏览器/非HTTPS环境（带 fallback）
  - 仅在有状态内容时才显示按钮
  - 纯前端改动，无后端/数据库变更

  **V162 变更（API供应商预设系统）：**
  - 设置页「API配置」Tab 新增「API供应商」下拉菜单，可一键切换预配置的供应商
  - 新增「编辑供应商列表」，可添加/删除多个供应商预设（名称+密钥+地址）
  - 选择供应商后自动填充 API 地址，保存时自动应用该供应商的密钥
  - 密钥安全处理：前端仅显示遮蔽版 (****xxxx)，编辑时留空保持已有密钥不变
  - 数据存储在 system_config 表（key=apiProviderPresets），无需新建表或迁移
  - 类似模型预设的使用方式：先配好可用供应商，之后下拉选择即切换

  **V164 变更（批量并发上限修复 + 实时进度显示修复）：**
  - 批量生成并发上限从硬编码40提升至100（用户设置50实际只跑40的问题）
  - 测试本和课后信息提取SSE端点改为流式生成（invokeWithContinuation），支持实时字符数回传
  - 前端进度处理更新：测试本/课后信息提取不再一直显示"等待AI响应"，改为实时显示"已生成 N 字符"
  - 覆盖一对一和小班课共4个SSE端点 + 6处客户端进度处理代码
  - AbortController替代clientDisconnected布尔值，客户端断开时可中止AI流
  - 后台任务（backgroundTaskRunner）向下兼容，不传回调时仍走非流式路径
  - 纯逻辑改动，无数据库变更，无新依赖

  **V165-V169 变更（项目文档整理，纯文档无代码改动）：**
  - 编写知识交接文档 `docs/HANDOFF.md`（新对话引导入口）和 `docs/deployment-collaboration.md`（部署协作规范）
  - 将项目负责人维护的 6 份完整文档（V1-V152 全量知识）合并到 `docs/` 目录：
    - `docs/项目概述.md`（26.7KB）— 功能、架构、设计决策
    - `docs/迭代记录.md`（64KB）— V1 到 V152 完整版本记录
    - `docs/技术备忘.md`（75.2KB）— 39 章技术经验与实现细节
    - `docs/问题追踪.md`（17.2KB）— 83 个已解决问题 + 待解决问题
    - `docs/Manus协作指南.md`（42.4KB）— Manus 平台操作与部署指南
    - `docs/环境变量配置模板.md`（13.7KB）— 环境变量配置说明
  - 清理冗余文档：删除 `ideas.md`、`todo.md`、`sse_investigation_report.md`、`sse_debug_frontend_log.txt`、`任务书-排查截断问题.md`（均为已完成的历史任务或过期调试文件）
  - 新增文档维护规范：Claude 推送前更新 `docs/迭代记录.md`，Manus 部署后更新本文件版本发布记录
  - **⚠️ 纯文档改动，不影响前端/后端代码、不影响构建产物，无需额外操作**

  **部署操作（⚠️ 顺序重要）：**
  ```bash
  # 1. 设置远程地址（如已设置可跳过）
  git remote set-url origin https://github.com/wanghaoen2000/feedback-mvp.git

  # 2. 拉取分支并合并
  git fetch origin
  git merge origin/claude/auto-load-student-files-thGk8   # 应直接 fast-forward

  # 3. 构建（无需 npm install，无新依赖）
  npm run build

  # 4. ⚠️ 先 checkpoint！
  webdev_save_checkpoint

  # 5. 最后推 GitHub
  git push origin main
  ```

  **数据库说明：** 两张新表 `hw_students` 和 `hw_entries` 使用 `CREATE TABLE IF NOT EXISTS`，服务启动时自动创建，无需手动执行 SQL。

- [x] **【已完成】复制字体文件到项目目录**（完成于 2026-02-07）：V130 日志确认 Node 进程在沙箱中，无法访问 `/usr/share/fonts`。请执行：
  ```bash
  cp /usr/share/fonts/truetype/wqy/wqy-zenhei.ttc ./fonts/
  ```
  然后提交推送：
  ```bash
  git add fonts/wqy-zenhei.ttc
  git commit -m "添加 WenQuanYi Zen Hei 字体文件（供 resvg 渲染中文）"
  ```
  **背景：** Node 进程在 Manus 沙箱中运行，`existsSync('/usr/share/fonts')` 返回 false。V131 代码已改为优先从项目本地 `fonts/` 目录加载字体，但需要你把字体文件复制进来。文件约 15MB。

- [x] **【已完成】排查服务器字体路径**（完成于 2026-02-07）：
  ```bash
  # 1. 查看 WenQuanYi 字体的实际路径
  fc-list | grep -i wqy

  # 2. 查看 /usr/share/fonts 目录结构（只看前两级）
  find /usr/share/fonts -maxdepth 2 -type d

  # 3. 查看所有中文字体文件
  find /usr/share/fonts -name "*.ttc" -o -name "*.ttf" | grep -iE "wqy|noto.*cjk|wenquan"
  ```
  **背景：** V129 换用 resvg 渲染 SVG，但 resvg 的 `loadSystemFonts` 在服务器上找不到字体，导致气泡图完全空白。V130 已加上 9 个常见路径 + `/usr/share/fonts` 目录扫描，但需要确认服务器上字体的实际路径是否在覆盖范围内。

- [ ] **复制 Noto Sans CJK 字体到项目目录**（V134 气泡图字体优化）：
  ```bash
  cp /usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc ./fonts/
  ```
  然后提交推送：
  ```bash
  git add fonts/NotoSansCJK-Regular.ttc
  git commit -m "添加 Noto Sans CJK 字体文件（气泡图字体优化）"
  ```
  **背景：** V134 代码将气泡图字体优先级改为 Noto Sans CJK SC（思源黑体），比 WenQuanYi Zen Hei 更美观。代码已做兜底处理——如果 Noto 字体不存在，仍然使用 WenQuanYi Zen Hei。字体文件约 20MB。

- [x] **【已部署】V171：作业批改系统（新功能模块）**（Manus 已部署，具体版本号待确认）

  **分支：** `claude/setup-feedback-mvp-6wqxE`

- [ ] **【部署任务】多租户数据隔离深度修复 + 配置权限修复**

  **分支：** `claude/fix-account-data-isolation-7GWPP`
  **新增依赖：** 无
  **数据库迁移：** 无

  **变更内容（7 个提交）：**

  1. **修复学生历史记录跨租户泄露**（6c6ee46）
     - `getStudentHistory` 不再 fallback 到 `systemConfig`，只查 `user_config`
  2. **彻底修复全部配置数据跨租户泄露**（84349c2）
     - `getConfigValue(key, userId)` 有 userId 时仅查 `user_config`，永不 fallback 到 `systemConfig`
  3. **彻底修复前端学生历史数据跨账户泄露**（fbb802f）
     - localStorage key 不再使用 `'default'` 回退，改为按用户隔离
  4. **修复 migrateSystemConfigToAdmin 导致数据扩散**（5adb995）
     - 一次性迁移只对 owner 执行（`openId === ENV.ownerOpenId`），不再对所有 admin 复制 owner 数据
     - `exportBackup` 不再读取 systemConfig 作为 fallback
     - 新增 `clearAllMyConfig` API 端点（用于清理已污染数据）
  5. **路径输入框默认值改为 placeholder**（b2fada9）
     - `config.getAll` 未配置的路径字段返回空字符串，前端显示为灰色提示文字
  6. **允许非管理员用户修改自己的配置**（dc1b2d5）
     - `config.update` 和 `config.reset` 从 `adminProcedure` 改为 `protectedProcedure`
  7. **全面更新 7 份核心文档至当前状态**（dd8be2a）
     - HANDOFF.md、迭代记录.md、项目概述.md、租户隔离改造清单.md、问题追踪.md、技术备忘.md

  **部署操作：**
  ```bash
  git fetch origin
  git merge origin/claude/fix-account-data-isolation-7GWPP
  npm run build
  webdev_save_checkpoint
  git push origin main
  ```

- [x] **【已解决】版本号对齐 V171-V179**（Claude 从 main 的 git log 提取了 Manus 的实际部署记录，已填入版本发布记录表）

- [ ] **【部署任务】V180：新增技术说明书文档**

  **分支：** `claude/add-project-documentation-TLCmj`
  **版本跨度：** V179 → V180
  **新增依赖：** 无
  **数据库迁移：** 无

  **V180 变更：**
  - 新增 `docs/技术说明书.md` — 完整的项目技术说明文档
  - 内容涵盖：项目定位、技术栈、目录结构、数据库设计、核心模块详解、认证权限、前端架构、构建部署、数据流示例、版本管理、错误处理、关键设计决策
  - **⚠️ 纯文档改动，不影响前端/后端代码、不影响构建产物**

  **部署操作：**
  ```bash
  git fetch origin
  git merge origin/claude/add-project-documentation-TLCmj   # 应直接 fast-forward
  npm run build
  webdev_save_checkpoint
  git push origin main
  ```

- [ ] **【部署任务】V181-V184：max_tokens 修复 + AI模型选择去耦合**

  **分支：** `claude/fix-status-max-value-miLpB`
  **版本跨度：** V180 → V184
  **新增依赖：** 无
  **数据库迁移：** 无

  **V181 变更（学生状态截断修复）：**
  - 修复作业管理学生状态生成的 `max_tokens`：4000 → 64000
  - 添加截断标记清理逻辑

  **V182 变更（全局 max_tokens 统一为 64000）：**
  - whatai.ts 默认值 32000→64000、feedbackGenerator 录音压缩+SVG 气泡图、gradingRunner 打分+同步、reminderRunner 提醒

  **V183 变更（max_tokens 改为从系统设置读取）：**
  - whatai.ts fallback 链：`options > config.maxTokens > 64000`
  - 各模块去掉硬编码，改走 config

  **V184 变更（AI模型选择去耦合 — 各功能独立设置）：**
  - 新增配置键 `gradingAiModel`（作业打分专用）、`reminderAiModel`（作业提醒专用）
  - `gradingRunner.ts`：3处 `hwAiModel` → `gradingAiModel`
  - `reminderRunner.ts`：1处 `hwAiModel` → `reminderAiModel`
  - `routers.ts`：hwConfig 查询/保存 + submit schema 加入 `aiModel`
  - `HomeworkManagement.tsx`：打分面板和提醒面板各加独立的模型下拉选择器，选择即保存
  - 改后各功能模型配置完全独立：
    - 学情反馈 → `apiModel`
    - 批量任务 → `apiModel`（创建时快照）
    - 作业管理 → `hwAiModel`
    - 作业批改 → `corrAiModel`
    - 作业打分 → `gradingAiModel`（新增）
    - 作业提醒 → `reminderAiModel`（新增）

  **部署操作：**
  ```bash
  git fetch origin
  git merge origin/claude/fix-status-max-value-miLpB   # 应直接 fast-forward
  npm run build
  webdev_save_checkpoint
  git push origin main
  ```

- [ ] **【部署任务】V182：修复作业批改→待入库内容截断 + 一键复制 + 字数显示**

  **分支：** `claude/fix-word-count-transfer-6ycjX`
  **版本跨度：** V181 → V182
  **新增依赖：** 无
  **数据库迁移：** 无

  **V182 变更：**
  - **修复批改内容截断**：去除 `correction.slice(0, 500)` 硬截断，批改全文完整传递到待入库
  - **修复双标签问题**：去除 `[从课后信息提取导入]` 多余标签，批改导入只显示 `[从作业批改导入]`
  - **修复"批改类型"重复**：去除 importContent 中重复的批改类型行
  - **待入库一键复制**：预入库条目展开后，AI处理结果标题栏新增「复制」按钮
  - **字数显示**：待入库条目（折叠/展开均显示）和学生当前状态均显示总字数

  **部署操作：**
  ```bash
  git fetch origin
  git merge origin/claude/fix-word-count-transfer-6ycjX   # 应直接 fast-forward
  npm run build
  webdev_save_checkpoint
  git push origin main
  ```

- [ ] **【部署任务】V183：路书及范例管理按钮移入课堂反馈分页**

  **分支：** `claude/fix-word-count-transfer-6ycjX`
  **版本跨度：** V182 → V183
  **新增依赖：** 无
  **数据库迁移：** 无

  **V183 变更：**
  - 将「路书及范例管理」按钮从系统级标题区域移入「课堂反馈」Tab 的 CardHeader 中
  - 按钮现在与「课堂信息录入」标题并排显示在右侧
  - 路书和范例仅在学情反馈中使用，放在课堂反馈分页内更合理
  - 纯 UI 布局调整，无功能变更

  **部署操作：**
  ```bash
  git fetch origin
  git merge origin/claude/fix-word-count-transfer-6ycjX   # 应直接 fast-forward
  npm run build
  webdev_save_checkpoint
  git push origin main
  ```

- [ ] **【部署任务】V186：修复手机端"已接收XX字"等信息被截断不可见**

  **分支：** `claude/fix-mobile-message-counter-2EHXt`
  **版本跨度：** V185 → V186
  **新增依赖：** 无
  **数据库迁移：** 无

  **V186 变更：**
  - 修复任务记录元数据行（时间/耗时/已接收字数）在手机窄屏上溢出不可见
  - 修复作业批改任务卡片头部信息在手机上被截断
  - 修复步骤进度标题行（步骤名+完成耗时）在手机上溢出
  - 原因：flex 布局未设置 `flex-wrap`，窄屏幕上后面的元素被挤出可见区域
  - 纯前端 CSS 修复，无功能变更

  **部署操作：**
  ```bash
  git fetch origin
  git merge origin/claude/fix-mobile-message-counter-2EHXt   # 应直接 fast-forward
  npm run build
  webdev_save_checkpoint
  git push origin main
  ```

### Manus → Claude（部署端请求开发端处理）

（暂无）

---

## 二、Manus 反馈区（部署端在此填写排查结果）

> Manus 请在这里贴上面请求的命令输出结果，Claude 下次会读取并据此调整代码。

**排查时间：** 2026-02-07 17:45 (GMT+8)
**排查环境：** Manus 沙箱服务器 (Ubuntu 22.04)

### 命令1：fc-list | grep -i wqy
```
/usr/share/fonts/truetype/wqy/wqy-microhei.ttc: WenQuanYi Micro Hei,文泉驛微米黑,文泉驿微米黑:style=Regular
/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc: WenQuanYi Zen Hei,文泉驛正黑,文泉驿正黑:style=Regular
/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc: WenQuanYi Zen Hei Sharp,文泉驛點陣正黑,文泉驿点阵正黑:style=Regular
/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc: WenQuanYi Zen Hei Mono,文泉驛等寬正黑,文泉驿等宽正黑:style=Regular
/usr/share/fonts/truetype/wqy/wqy-microhei.ttc: WenQuanYi Micro Hei Mono,文泉驛等寬微米黑,文泉驿等宽微米黑:style=Regular
```

### 命令2：find /usr/share/fonts -maxdepth 2 -type d
```
/usr/share/fonts
/usr/share/fonts/opentype
/usr/share/fonts/opentype/fonts-hosny-amiri
/usr/share/fonts/opentype/ipafont-gothic
/usr/share/fonts/opentype/noto
/usr/share/fonts/truetype
/usr/share/fonts/truetype/abyssinica
/usr/share/fonts/truetype/droid
/usr/share/fonts/truetype/liberation
/usr/share/fonts/truetype/libreoffice
/usr/share/fonts/truetype/lohit-devanagari
/usr/share/fonts/truetype/lohit-gujarati
/usr/share/fonts/truetype/lohit-tamil
/usr/share/fonts/truetype/noto
/usr/share/fonts/truetype/padauk
/usr/share/fonts/truetype/scheherazade
/usr/share/fonts/truetype/tlwg
/usr/share/fonts/truetype/wqy
```

### 命令3：find /usr/share/fonts -name "*.ttc" -o -name "*.ttf" | grep -iE "wqy|noto.*cjk|wenquan"
```
/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc
/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc
/usr/share/fonts/opentype/noto/NotoSansCJK-DemiLight.ttc
/usr/share/fonts/opentype/noto/NotoSansCJK-Light.ttc
/usr/share/fonts/opentype/noto/NotoSansCJK-Medium.ttc
/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc
/usr/share/fonts/opentype/noto/NotoSansCJK-Thin.ttc
/usr/share/fonts/opentype/noto/NotoSerifCJK-Black.ttc
/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc
/usr/share/fonts/opentype/noto/NotoSerifCJK-ExtraLight.ttc
/usr/share/fonts/opentype/noto/NotoSerifCJK-Light.ttc
/usr/share/fonts/opentype/noto/NotoSerifCJK-Medium.ttc
/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc
/usr/share/fonts/opentype/noto/NotoSerifCJK-SemiBold.ttc
/usr/share/fonts/truetype/wqy/wqy-microhei.ttc
/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc
```

### Manus 分析总结

**关键发现：** 服务器上中文字体分布在两个目录中：

| 字体系列 | 路径 | 格式 | 注意 |
|---------|------|------|------|
| WenQuanYi Micro Hei | `/usr/share/fonts/truetype/wqy/wqy-microhei.ttc` | TrueType (.ttc) | 在 truetype 目录下 |
| WenQuanYi Zen Hei | `/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc` | TrueType (.ttc) | 在 truetype 目录下 |
| Noto Sans CJK (7个粗细) | `/usr/share/fonts/opentype/noto/NotoSansCJK-*.ttc` | **OpenType (.ttc)** | **在 opentype 目录下，不在 truetype 下！** |
| Noto Serif CJK (7个粗细) | `/usr/share/fonts/opentype/noto/NotoSerifCJK-*.ttc` | **OpenType (.ttc)** | **在 opentype 目录下，不在 truetype 下！** |

**⚠️ 重要：** Noto CJK 字体在 `/usr/share/fonts/opentype/noto/` 目录下，不是 `/usr/share/fonts/truetype/noto/`。如果 V130 的代码只扫描了 truetype 目录或者预定义路径中没有 opentype 路径，那 Noto CJK 字体就会被漏掉。建议确认 resvg 的字体扫描目录是否包含 `/usr/share/fonts/opentype/`。

---

## 三、部署操作规范（每次部署前必读）

### 正确的部署顺序（⚠️ 顺序很重要）

```
1. git remote set-url origin https://github.com/wanghaoen2000/feedback-mvp.git
2. git fetch origin
3. git merge origin/claude/xxx    （应该直接 fast-forward）
4. npm install                    （如有依赖变更）
5. npm run build
6. webdev_save_checkpoint          ← 先 checkpoint！
7. git push origin main            ← 最后推 GitHub
8. ⚠️ 更新本文件「版本发布记录」中的部署状态  ← 不要忘！
```

### 部署后必须更新状态（⚠️ 每次都要做）

部署完成后，**必须**更新本文件「五、版本发布记录」中对应版本的「部署是否顺利」列：
- 部署成功 → 写 `✅ 部署成功` 或 `部署成功，XX功能验证通过`
- 部署失败 → 写具体问题，如 `❌ build失败：XXX` 或 `❌ 气泡图仍空白`
- 部分成功 → 写 `⚠️ 部署成功但XX功能异常`

**目的：** 让 Claude 和项目负责人能随时看到每个版本的实际部署状态，而不是一串"待部署"。

### 为什么顺序很重要

checkpoint 会把 origin 切换到 S3 地址。如果先推了 GitHub，本地历史和 S3 历史会分叉，导致 checkpoint 失败。**先 checkpoint 再推 GitHub** 可以避免这个问题。

### 依赖变更判断

如果 Claude 的发布说明中提到了"新增依赖"或"移除依赖"，合并后必须运行 `npm install`。不确定的话也可以直接跑一次 `npm install`，不会有副作用。

---

## 四、已知问题与状态

| 问题 | 状态 | 备注 |
|------|------|------|
| 气泡图中文乱码（□□□） | V129 已修复渲染引擎 | 从 sharp/librsvg 换为 resvg |
| 气泡图完全空白（无文字） | V131 已修复 | 项目 fonts/ 目录加载字体，绕过沙箱限制 |
| 前端幽灵数据残留 | V129 已修复 | 取消云盘读取时清除 ref/state |
| 测试本答案无分页符 | V132 已修复 | 检测 ===== 答案 ===== 等多种AI输出格式 |
| 输入班号不填充历史学生名单 | V137 修复 | V132 前端逻辑正确但 Zod schema 丢弃 students 字段 |
| Checkpoint 反复失败 | 待验证 | Manus 调整操作顺序后应解决 |

---

## 五、版本发布记录

| 版本 | 日期 | 主要变更 | 部署是否顺利 |
|------|------|---------|------------|
| V129 | 2026-02-07 | resvg 替代 sharp + 幽灵数据修复 + require(sharp) ESM 修复 | 合并顺利，气泡图空白 |
| V130 | 2026-02-07 | resvg 显式字体路径 + 字体发现日志 | 合并顺利，字体仍空白（沙箱限制） |
| V131 | 2026-02-07 | 项目本地 fonts/ 目录加载 + COLLAB.md 协作看板 | 部署成功，气泡图中文正常 |
| V132 | 2026-02-07 | 测试本答案分页符修复 + 装饰性标记处理 + 班号输入自动填充学生名单 | ✅ 部署成功 |
| V133 | 2026-02-07 | 1对1与小班课生成函数模块化合并 + addWeekdayToDate 抽取共享 + 1对1改非流式 | ✅ 部署成功 |
| V134 | 2026-02-07 | 原始AI输出日志（排查换行问题） + 气泡图字体升级 Noto Sans CJK SC | ✅ 部署成功 |
| V137 | 2026-02-09 | 修复学生名持久化(Zod schema) + 任务记录UI优化 + 模型选择器移到主界面 | ✅ 部署成功 |
| V138 | 2026-02-09 | 后台任务实时字符数显示 + 反馈预览区导航按钮 | ✅ 部署成功 |
| V143 | 2026-02-09 | 查看链接恢复 + 下载按钮(复习/测试/气泡图) + 任务记录去折叠 | ✅ 部署成功 |
| V145 | 2026-02-09 | 步骤2-5进度实时更新 + 小班课markdown保底指令 + 多段录音构成功能 | ✅ 部署成功 |
| V148 | 2026-02-10 | 作业管理系统 MVP — 学生名册、语音输入AI处理、预入库队列 | ✅ 部署成功 |
| V149 | 2026-02-10 | 课后信息提取一键导入作业管理 — 打通反馈系统与作业管理 | ✅ 部署成功 |
| V150 | 2026-02-10 | 作业管理Bug修复 — 日/周计划切换保存、deleted学生重新激活 | ✅ 部署成功 |
| V151 | 2026-02-10 | 已入库记录浏览 — 选中学生可查看历史入库记录 | ✅ 部署成功 |
| V152 | 2026-02-10 | 任务记录页添加「导入作业管理」按钮 | ✅ 部署成功 |
| V153 | 2026-02-10 | 已入库记录去折叠 + 作业管理提示词系统 | ✅ 部署成功 |
| V154 | 2026-02-10 | 学生姓名注入系统提示词 — 防止语音转文字中错误姓名误导AI | ✅ 部署成功 |
| V155 | 2026-02-10 | 移除作业管理「补充说明」字段 — 功能冗余，统一用提示词+主输入框 | ✅ 部署成功 |
| V156 | 2026-02-10 | 作业管理迭代更新系统 — 学生状态文档+AI迭代处理+入库自动清理 | ✅ 部署成功 |
| V158 | 2026-02-10 | 修复「导入作业管理」跳过AI处理Bug — 导入内容现经AI转换再入队列 | ✅ 部署成功 |
| V159 | 2026-02-10 | 报错信息展示优化 — 去截断+中文化+可换行 | ✅ 部署成功 |
| V160 | 2026-02-10 | 作业管理UI优化 — 提示词限高+预入库顺序调整+重试/删除确认 | ✅ 部署成功 |
| V161 | 2026-02-11 | 学生当前状态一键复制按钮 | ✅ 部署成功 |
| V162 | 2026-02-11 | API供应商预设系统 — 预配置供应商一键切换密钥和地址 | ✅ 部署成功 |
| V164 | 2026-02-11 | 批量并发上限修复(40→100) + 测试本/课后信息提取实时字符数显示 | ✅ 部署成功 |
| V165-V169 | 2026-02-12 | 项目文档整理 — 知识交接文档+6份完整文档合并+冗余文件清理+文档维护规范 | ✅ 部署成功 |
| V170 | 2026-02-12 | 版本号更新 + COLLAB.md 部署任务更新 | ✅ 部署成功 |
| V171 | 2026-02-12 | 作业批改系统 — 第四个独立 Tab + correction_tasks 表 + AI模型选择器 + 任务队列UX + 3天自动清理 | ✅ 部署成功 |
| V172 | 2026-02-15 | 多租户隔离全面改造 — 邮箱必填+确认弹窗区分+所有软配/GDrive/localStorage按用户隔离+批量任务漏洞修复+230个测试+日志隔离+ContentStore归属校验 | ✅ 部署成功 |
| V173 | 2026-02-15 | 修复切换账户后仍看到上一用户设置 — useAuth增加userId变化监听+退出时清理本地状态 | ✅ 部署成功 |
| V174 | 2026-02-15 | config.update改写user_config+Manus平台密钥确认任务书+修复作业批改提交失败(correction_tasks表缺列+迁移脚本) | ✅ 部署成功 |
| V175 | 2026-02-16 | 修复作业批改图片SQL插入失败(图片改外部存储)+添加作业提醒功能(催作业)+修复localStorage key隔离+打分超时调整 | ✅ 部署成功 |
| V176 | 2026-02-16 | 彻底修复getConfigValue/getStudentHistory不再fallback到systemConfig — 跨租户泄露根因修复 | ✅ 部署成功 |
| V177 | 2026-02-16 | 彻底修复前端学生历史数据跨账户泄露+后端学生历史查询API新增userId校验 | ✅ 部署成功 |
| V178 | 2026-02-16 | 修复migrateSystemConfigToAdmin只对owner执行+路径输入框默认值改为placeholder灰色提示 | ✅ 部署成功 |
| V179 | 2026-02-16 | 允许非管理员用户修改自己的配置 — config.update/reset改为protectedProcedure | ✅ 部署成功 |
| V180 | 2026-02-16 | 新增技术说明书 — 完整的项目技术架构与实现说明文档 | 待部署 |
| V181 | 2026-02-21 | 修复学生状态文档截断（max_tokens 4000→64000）+ 截断标记清理 | 待部署 |
| V182 | 2026-02-21 | 修复批改→待入库内容截断(.slice(0,500))+双标签修复+待入库一键复制+字数显示 | 待部署 |
| V182 | 2026-02-21 | 全局 max_tokens 统一为 64000 — whatai默认值+录音压缩+气泡图+打分+提醒 | 待部署 |
| V183 | 2026-02-21 | max_tokens 改为从系统设置读取 — 去掉所有硬编码，统一走 config.maxTokens | 待部署 |
| V184 | 2026-02-21 | AI模型选择去耦合 — 打分/提醒各自独立模型设置(gradingAiModel/reminderAiModel) | 待部署 |
| V183 | 2026-02-21 | 路书及范例管理按钮从系统级位置移入课堂反馈Tab内 | 待部署 |
| V186 | 2026-02-21 | 修复手机端"已接收XX字"等信息被截断不可见 — flex-wrap修复窄屏溢出 | 待部署 |
