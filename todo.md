# 学情反馈MVP - TODO

## 核心功能
- [x] 前端：简单输入表单（算术题输入框）
- [x] 后端：tRPC接口调用Claude API计算
- [x] 后端：Google Drive文件上传功能
- [x] 集成：将计算结果保存到指定路径

## 测试
- [x] 端到端测试：输入算术题 → 计算 → 保存到Google Drive

## 完整版功能（V2）
- [x] 前端：三个长文本输入框（上次反馈/本次笔记/录音转文字）
- [x] 前端：学生姓名、课次、日期输入
- [x] 前端：特殊要求输入框（可选）
- [x] 前端：新生首次课模式切换
- [x] 后端：调用LLM生成学情反馈文档
- [x] 后端：调用LLM生成复习文档
- [x] 后端：调用LLM生成测试本
- [x] 后端：调用LLM生成课后信息提取
- [x] 后端：生成气泡图PNG
- [x] 后端：按新路径存储到Google Drive（Mac/Documents/XDF/学生档案/学生名/子文件夹/）
- [x] 测试：完整流程端到端测试

## 状态显示和结果反馈（V3）
- [x] 前端：实时进度条显示当前步骤
- [x] 前端：每步状态图标（成功✓/失败✗/进行中...）
- [x] 前端：失败时显示具体错误信息
- [x] 后端：返回分步执行状态
- [x] 后端：Google Drive文件验证（检查文件是否真的存在）
- [x] 前端：显示最终文件列表和Google Drive链接


## 格式规范修复（V4）
- [x] 将V9路书的学情反馈格式要求写入系统提示词
- [x] 将V9路书的复习文档格式要求写入系统提示词
- [x] 将V9路书的测试本格式要求写入系统提示词
- [x] 将V9路书的课后信息提取格式要求写入系统提示词
- [x] 将V9路书的气泡图格式要求写入系统提示词
- [x] 测试验证生成的文档格式是否符合路书规范

## Bug修复和API切换（V5）
- [x] 修复Word文档格式问题（使用docx库正确生成docx）
- [x] 修复气泡图生成问题（使用sharp库将SVG转换为PNG）
- [x] 切换到神马中转API（https://api.whatai.cc/v1）
- [x] 配置默认使用claude-opus-4-5-20251101-thinking模型
- [x] 测试验证所有修复

## Bug修复（V6）
- [x] 诊断并修复API fetch failed错误（添加超时设置和重试机制）

## 模型切换（V7）
- [x] 将默认模型从Opus切换到claude-sonnet-4-5-20250929

## 超时延长（V8）
- [x] 延长API请求超时时间（复杂任务10分钟，简单任务3分钟）

## Bug修复（V9）
- [~] 修复前端进度显示问题（跳过，后续优化）
- [x] 修复学情反馈格式（纯文本，无markdown标记）
- [x] 修复Word文档格式（正确分页符，无markdown/HTML标记）
- [x] 修复课上生词数量问题（强调15-25个硬性要求）

## 多轮API重构（V10）
- [x] 重构后端API：拆分为5个独立端点（学情反馈、复习文档、测试本、课后信息、气泡图）
- [x] 重构前端：实现自动多轮调用，每完成一个自动触发下一个
- [x] 添加实时进度显示：显示当前正在生成哪个文档

## V11 界面优化
- [x] 删除日期字段（本次课日期、下次课日期），AI自动从笔记提取
- [x] 添加高级设置区域（默认折叠）
- [x] 添加模型名称配置（可持久化）
- [x] 添加API密钥配置（可持久化）
- [x] 添加API地址配置（可持久化）
- [x] 修改AI提示词，自动从笔记中提取日期信息

## V12 单步重试功能
- [x] 在失败的步骤旁边添加“重试”按钮
- [x] 实现单步重试逻辑（只重新执行失败的那一步）
- [x] 重试成功后自动继续后续步骤

## V15 修复 fetch failed 错误
- [x] 将默认 API 切换到 DMXapi（已测试可用）
- [x] 更新默认 API 密钥和地址
- [x] 测试验证修复效果

## V16 重新实现回滚后丢失的功能
- [x] 年份输入字段（默认2026，可持久化）
- [x] 本次课日期输入字段（如"1月5日"，与年份组合）
- [x] 路书管理功能（高级设置中可粘贴更新的V9路书）
- [x] 上传重试机制（失败后自动重试3次）
- [x] 测试所有功能正常工作
- [x] 保存检查点

## V17 遗留功能实现
- [x] 停止按钮 - 允许用户中途取消生成
- [x] V9路书直接用于AI提示词 - 确保数据库中保存的路书内容被AI使用
- [x] 测试所有功能正常工作
- [x] 保存检查点

## V18 修复路书应用范围
- [x] 复习文档生成使用自定义V9路书
- [x] 测试本生成使用自定义V9路书
- [x] 课后信息提取使用自定义V9路书
- [x] 修改routers.ts传递roadmap参数
- [x] 测试并保存检查点

## V19 气泡图也使用自定义路书
- [x] 修改气泡图生成使用自定义V9路书
- [x] 修改routers.ts传递roadmap参数给气泡图
- [x] 测试并保存检查点

## V20 录音转文字分段压缩
- [x] 实现录音转文字分段压缩功能（超长录音分段处理，每段压缩后再合并）
- [x] 测试并保存检查点

## V22 流式输出防止超时
- [x] 在whatai.ts中实现流式API调用
- [x] 修改生成函数使用流式输出（学情反馈、复习文档、测试本、课后信息提取）
- [x] 测试并保存检查点

## V23 直接使用V9路书原文
- [x] 修改学情反馈生成，直接使用路书原文
- [x] 修改复习文档生成，直接使用路书原文
- [x] 修改测试本生成，直接使用路书原文
- [x] 修改课后信息提取，直接使用路书原文
- [x] 修改气泡图提取，直接使用路书原文
- [x] 测试并保存检查点

## V24 全部改为流式输出
- [x] 录音压缩改为流式输出
- [x] 气泡图提取改为流式输出
- [x] 测试并保存检查点

## V25 取消分段压缩
- [x] 取消录音分段压缩，改成一次性压缩
- [x] 测试并保存检查点

## V26 取消录音压缩
- [x] 取消录音压缩步骤，直接使用原文
- [x] 测试并保存检查点

## V27 让AI直接按V9路书生成气泡图
- [x] 修改气泡图生成逻辑，让AI直接按V9路书生成SVG
- [x] 测试并保存检查点

## V28 添加文档生成边界限制
- [x] 给学情反馈生成添加边界限制
- [x] 给复习文档生成添加边界限制
- [x] 给测试本生成添加边界限制
- [x] 给课后信息提取添加边界限制
- [x] 给气泡图生成添加边界限制
- [x] 测试并保存检查点


## V29 日志与调试系统增强

- [x] 任务二：中文错误提示系统
  - [x] 建立错误码映射表
  - [x] 服务端错误包装成结构化对象
  - [x] 前端显示中文错误提示
- [x] 任务三：日志记录与导出系统
  - [x] 创建logg er.ts模块
  - [x] 记录每次生成的完整日志
  - [x] 添加“导出日志”按钮
  - [x] 上传日志到Google Drive
- [x] 任务一：实时状态上屏显示
  - [x] 添加实时输出预览面板
  - [x] 流式内容推送到前端
  - [x] 显示每个步骤的状态


## V29 问题修复

- [ ] 问题1：实时数据没上屏 - 只显示"连接AI服务中"，没有显示AI返回的内容
- [x] 问题2：错误信息没显示 - 已添加错误详情显示区域
- [x] 问题3：日志文件没生成 - 已在所有步骤的catch块中添加endLogSession调用

## 日志导出优化

- [x] 修改服务端exportLog接口返回路径和链接
- [x] 修改前端显示导出结果（路径+可点击链接）


## 日志导出问题修复

- [x] 问题1：链接没显示 - 前端已正确显示路径和链接
- [x] 问题2：文件没真正上传 - 修复了上传状态检查逻辑，失败时正确返回错误


## Google Drive授权修复

- [ ] 重新授权Google Drive（token过期）- 需要用户在Manus设置中手动操作
- [ ] 验证授权成功
- [x] 修复文件上传的错误处理 - 已为5个步骤都添加了uploadResult.status检查


## V33 一键自检功能

- [x] 后端：新增systemCheck API端点
  - [x] 数据库连接检测
  - [x] API配置完整性检测
  - [x] API连通性检测
  - [x] API密钥有效性检测
  - [x] API余额检测
  - [x] Google Drive授权检测
  - [x] Google Drive写入权限检测
  - [x] V9路书配置检测
- [x] 前端：自检界面组件
  - [x] 添加“系统自检”按钮
  - [x] 逐项显示检测结果
  - [x] 显示总结和修复建议


## V34 Google Drive OAuth授权功能

- [x] 数据库：添加google_tokens表
- [x] 后端：创建googleAuth.ts OAuth模块
- [x] 后端：添加tRPC路由（getStatus/getAuthUrl/handleCallback/disconnect）
- [x] 后端：修改gdrive.ts支持OAuth上传
- [x] 前端：高级设置添加Google Drive连接状态区域
- [x] 系统自检：添加OAuth状态检查
- [x] 修复 redirect_uri 使用固定部署域名而非动态 VITE_APP_ID
- [x] 前端显示当前回调地址，方便用户复制添加到 Google Cloud Console
- [x] 注册 /api/google/callback Express 路由处理 Google OAuth 回调
- [x] 排查 Google Drive 写入权限失败问题 - 已修复，8/8 检测项全部通过
- [x] 使用 Google Drive REST API 替代 rclone，解决正式环境无 rclone 的问题

## V38: 自定义 Google Drive 存储路径
- [x] 数据库：在 system_config 表添加 driveBasePath 配置项
- [x] 后端：添加 config.getDriveBasePath 和 config.setDriveBasePath 接口
- [x] 后端：修改上传逻辑从数据库读取 driveBasePath
- [x] 前端：高级设置添加路径配置输入框和保存按钮
- [x] 验证：路径格式验证（不能为空、不能以/开头或结尾）

## V39: 修复并发生成问题
- [x] 分析当前代码结构，了解配置读取方式
- [x] 后端：修改 5 个生成函数接收完整 config 参数
- [x] 后端：修改上传逻辑使用传入的 driveBasePath
- [x] 前端：生成时创建配置快照并传递给每个步骤
- [x] 测试：多标签页并发生成验证 - 代码已完成，待用户实际测试

## V38 Bug 排查：学生名被污染
- [x] 检查后端是否有全局变量保存学生名 - 后端没问题
- [x] 检查 logger.ts 的日志会话管理是否有状态污染 - 有全局变量但不影响上传
- [x] 检查 feedbackGenerator.ts 中 studentName 的来源 - 没问题
- [x] 排查问题根源 - 前端 React 状态变量在步骤间被修改
- [x] 修复：将 studentName 也加入快照，所有步骤使用快照中的学生名

## V40 补充：完善并发修复
- [x] 修复 logger.ts 全局变量污染，改为每个请求独立的 log 对象
- [x] 完善日志记录，确保每个步骤都有开始和完成记录
- [x] 前端添加当前生成学生名提示
- [x] 前端生成过程中锁定输入框（已有 disabled={isGenerating}）


## V41: 修复 API 错误和日志污染
- [ ] P0: 排查后端 API 返回 HTML 而不是 JSON 的错误 - 可能是正式网站未发布最新代码
- [ ] P0: 修复 API 错误 - 待发布后验证
- [x] P1: 排查日志污染问题 - 原因：前端导出时没传学生名，后端返回最新日志
- [x] P1: 修复日志污染 - 添加 getLatestLogPathByStudent 函数，前端导出时传入学生名


## V42: 气泡图前端生成（修复中文乱码）

- [x] 后端：修改 generateBubbleChart 返回 SVG 字符串而非 PNG
- [x] 后端：新增 uploadBubbleChart 接口接收前端上传的 PNG base64
- [x] 前端：新增 svgToPngBase64 函数（Canvas 转换）
- [x] 前端：修改步骤5流程：后端生成SVG → 前端转PNG → 上传
- [ ] 测试：验证气泡图中文显示正常
- [ ] 保存检查点并发布


## V43a: 界面优化 + 小班课界面

### 界面优化（一对一和小班课通用）
- [x] 所有大文本框改为固定5行高度（120px），内容多了用滚动条
- [x] 日期输入后自动计算并显示星期（如：1月15日（周四））
- [x] 文本框顺序保持：上次反馈 → 本次课笔记 → 录音转文字 → 特殊要求

### 小班课界面
- [x] 添加课程类型切换按钮：一对一 / 小班课
- [x] 小班课界面：班号、课次、年份、日期（周X）、出勤学生数、出勤学生姓名列表
- [x] 小班课不需要“下次课日期”和“新生首次课”选项
- [x] 高级设置添加小班课路书（roadmapClass）
- [x] 后端小班课生成接口（已实现，待前端对接）

## V43b: 小班课生成流程

### 小班课生成流程
- [x] 后端：添加小班课路书配置项 roadmapClass
- [x] 后端：小班课生成接口（4+N个文件）
- [x] 前端：小班课生成流程（学情反馈→复习文档→测试本→课后信息→N个气泡图）
- [x] 前端：小班课进度显示（显示每个学生气泡图生成状态）

### 存储路径
- [x] 小班课文件存储到 {basePath}/小班课/{班号}/ 目录下
- [x] 气泡图按学生名命名：{学生名}{日期}气泡图.png

### 测试
- [ ] 测试文本框固定高度
- [ ] 测试日期自动显示星期
- [ ] 测试一对一功能正常
- [ ] 测试小班课切换和生成
- [ ] 保存检查点并发布


## 兼容性检查

### 发现并修复的问题
- [x] 导出日志：小班课模式下传班号而非学生名
- [x] 重置表单：小班课模式下重置小班课相关状态（classFeedbacks, bubbleChartProgress）

### 已检查无问题
- [x] 表单验证 isFormValid：已修复支持小班课
- [x] 文件存储路径显示：已支持小班课
- [x] 气泡图进度显示：已支持小班课
- [x] 课程类型切换按钮：正常


## 小班课问题修复

### 问题1：学情反馈格式（最高优先级）
- [x] 修改为生成1份完整学情反馈文件，不是每个学生单独一份
- [x] 路书透明转发给AI，不做任何转述
- [x] 结构：全班共用部分在前，学生单独部分在后

### 问题5：存储路径
- [x] 路径改为 {basePath}/{班号}班/，去掉“小班课”层级

### 问题2：气泡图
- [x] 修改气泡图SVG生成，传入完整学情反馈让AI提取生词
- [x] 前端Canvas转PNG逻辑保持不变
- [x] PNG上传到Google Drive逻辑保持不变

### 问题3：文件链接
- [x] 生成完成后显示文件存储路径（已有功能）

### 问题4：日志导出
- [x] 修复小班课日志文件名格式（用班号作为标识符）
- [x] 修复导出时的查找逻辑（支持班号查找）


## 气泡图格式修复（紧急）

- [x] 小班课气泡图使用路书透明转发，不要自己编格式
- [x] 生成“问题-方案”格式，不是“生词气泡图”
- [x] 问题和方案从学生的「随堂测试」「作业批改」「表现及建议」中提取
- [x] 和一对一气泡图调用方式保持一致（路书作为 system prompt）


## V43e: 小班课首次课功能

- [x] 前端：在小班课模式下添加“首次课”勾选框
- [x] 前端：勾选后用小班课首次课范例替换“上次反馈”内容
- [x] 后端：添加 classFirstLessonTemplate 配置项
- [x] 确保范例内容透明转发给AI（通过 lastFeedback 参数）
- [ ] 测试：小班课勾选首次课后，上次反馈自动填入范例
- [ ] 测试：一对一首次课功能正常


## 修复：小班课首次课范例配置

- [x] 在高级设置中添加“小班课首次课范例”文本框
- [x] 勾选首次课时从配置中读取范例内容填入上次反馈
- [ ] 测试配置保存和读取


## V43g：一对一首次课范例可配置化

- [x] 后端配置路由支持 firstLessonTemplate
- [x] 高级设置界面添加“一对一首次课范例”文本框
- [x] 勾选“新生首次课”时从配置读取范例（配置为空时不填充）
- [x] 测试一对一首次课和小班课首次课都正常工作


## V44：统一路书使用方式

- [x] 小班课学情反馈：路书作为 system prompt + 不要互动指令
- [x] 小班课复习文档：路书作为 system prompt + 不要互动指令
- [x] 小班课测试本：路书作为 system prompt + 不要互动指令
- [x] 小班课课后信息提取：路书作为 system prompt + 不要互动指令
- [x] 小班课气泡图：路书作为 system prompt + 不要互动指令
- [x] 一对一所有文档：添加不要互动指令
- [x] 测试验证


## V45：修复小班课三个问题

- [x] 问题1：文件链接缺失 - 保存上传返回值并传给 updateStep
- [x] 问题2：日期偏移一天 - 优先使用用户输入的 lessonDate
- [x] 问题3：年份错误 - 前端传年份 + 后端组合年份日期
- [ ] 验收：年份正确、日期正确、文件链接显示、一对一不受影响（待用户测试）


## V45b：小班课学情反馈改用SSE解决超时

- [x] 后端创建 SSE 端点 /api/class-feedback-stream
- [x] 前端改用 fetch + 流式读取替代 tRPC mutation
- [ ] 测试小班课生成不超时（待用户验证）
- [ ] 验证一对一功能不受影响（待用户验证）


## V46: SSE 模块化重构

- [x] 创建 server/core/sseHelper.ts 工具模块
- [x] 包含 setupSSEHeaders 函数
- [x] 包含 sendSSEEvent 函数
- [x] 包含 sendChunkedContent 函数
- [x] 响应头包含 X-Accel-Buffering: no
- [x] pnpm build 无报错

- [x] 创建 server/core/aiClient.ts 模块
- [x] 包含 invokeAIStream 函数
- [x] 包含 getAPIConfig 函数
- [x] pnpm build 无报错

- [x] 创建 server/core/concurrencyPool.ts 模块
- [x] 实现 ConcurrencyPool 类
- [x] 包含 addTasks 方法
- [x] 包含 execute 方法
- [x] 包含 stop 方法
- [x] pnpm build 无报错
- [x] 简单测试通过

- [x] 页面顶部添加两个 Tab
- [x] 点击「课堂反馈」显示原有内容
- [x] 点击「批量处理」显示占位文字
- [x] 刷新页面后默认在「课堂反馈」
- [x] 原有的一对一/小班课功能不受影响

- [x] 创建 BatchProcess.tsx 组件
- [x] 包含任务编号范围、并发数、存储路径设置
- [x] 包含路书输入区域
- [x] 包含开始按钮
- [x] 在 Home.tsx 中引入组件
- [x] UI布局合理，风格一致


## V46f: 批量处理 SSE 端点（单任务版本）

- [x] 创建 server/batch/batchRoutes.ts
- [x] 实现 POST /api/batch/generate-stream 端点
- [x] 使用 sseHelper.ts 设置响应头、发送事件
- [x] 使用 aiClient.ts 调用 AI
- [x] SSE 事件：task-start, task-progress, task-complete
- [x] 在 server/index.ts 注册路由
- [x] curl 测试端点正常工作
- [x] pnpm build 无报错


## V46g: 前端调用 SSE 端点，显示实时字符数

- [x] 添加状态：isGenerating, currentChars, result
- [x] 点击开始后调用 POST /api/batch/generate-stream
- [x] 用 fetch + ReadableStream 读取 SSE 事件
- [x] 收到 task-progress 时更新 currentChars
- [x] 收到 task-complete 时显示完成
- [x] 事件类型判断用 event: 行（V45b 教训）
- [x] currentEventType 在 while 外部声明（V45b 教训）
- [x] 生成失败时显示错误信息


## V46h: 批量任务 Word 文档生成

- [x] 创建 server/batch/batchWordGenerator.ts
- [x] 实现 generateBatchDocument(content, taskNumber, suggestedFilename?)
- [x] 返回 { buffer: Buffer, filename: string }
- [x] 文件名格式：任务01_xxx.docx（编号补零到2位）
- [x] 复用现有 docx 库和生成逻辑
- [x] 测试函数返回 Buffer
- [x] Buffer 写入文件后 Word 打开正常


## V46i: 批量任务 Google Drive 上传

- [x] 修改 server/batch/batchRoutes.ts
- [x] 在 task-complete 之前调用 batchWordGenerator 生成 Word 文档
- [x] 创建批次文件夹（格式：YYYYMMDD-HHmmss）
- [x] 上传到 {storagePath}/{batchId}/ 路径
- [x] task-complete 事件包含 filename, url
- [x] 复用 gdrive.ts 的上传逻辑
- [x] 测试文件出现在 Google Drive 指定路径


## V46j: 后端整合并发池，支持多任务

- [x] 修改 server/batch/batchRoutes.ts
- [x] 请求参数改为 startNumber, endNumber, concurrency, roadmap, storagePath
- [x] 使用 ConcurrencyPool 管理任务执行
- [x] 为每个任务发送独立的 SSE 事件（带 taskNumber）
- [x] 新增 batch-start 事件（totalTasks, concurrency）
- [x] 新增 batch-complete 事件（completed, failed）
- [x] 测试并发限制（同时只有 concurrency 个任务执行）


## V46k: 前端显示多任务进度

- [x] 修改 BatchProcess.tsx
- [x] 添加状态：tasks Map, completedTasks, waitingTasks
- [x] 根据 SSE 事件更新状态（task-start/progress/complete）
- [x] UI 分三个区域：并发池（执行中）、已完成、等待中
- [x] 每个执行中的任务显示实时字符数
- [x] 任务完成后自动移到已完成区域


## V46l: 错误处理和重试机制

- [x] 后端：单任务失败时发送 task-error 事件
- [x] 后端：自动重试1次（MAX_RETRIES = 1）
- [x] 后端：重试仍失败则标记失败，继续执行其他任务
- [x] 后端：batch-complete 包含 failed 数量
- [x] 后端：新增 task-retry 事件通知前端
- [x] 前端：收到 task-error 显示红色错误状态（已支持）
- [x] 前端：最终显示失败任务列表（已支持）
- [x] 测试：正常任务流程验证通过


## V46m: 实现停止功能

- [x] 后端：添加停止端点 POST /api/batch/stop
- [x] 后端：接收停止信号，调用 pool.stop()
- [x] 后端：等待当前执行中的任务完成
- [x] 后端：发送 batch-complete（包含实际完成数和 stopped 标记）
- [x] 前端：生成过程中显示「停止」按钮（红色）
- [x] 前端：点击后发送停止请求
- [x] 前端：按钮变为「正在停止...」
- [x] 前端：等待中的任务标记为「已取消」
- [x] 测试：点击停止后等待队列被清空，当前任务继续完成


## 文案更新：移除批量处理页面的「学情反馈」文字

- [x] 查找 BatchProcess.tsx 中所有「学情反馈」文字
- [x] 替换为通用描述：「批量生成文档，支持并发处理」
- [x] 验证 grep 返回空，编译通过


## 文件命名修复：改为「任务XX.docx」

- [x] 查找 server/batch/ 中「学情反馈」文字
- [x] 修改文件名格式为「任务XX.docx」
- [x] 修改文档标题为「任务 XX」
- [x] 验证 grep 返回空，编译通过
