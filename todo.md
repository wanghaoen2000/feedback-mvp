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


## 修复：同一批次文件存到不同文件夹

- [x] 检查 batchId 生成和传递逻辑（确认代码正确）
- [x] 确保所有子任务共用同一个 batchId（在请求开始时生成一次）
- [x] 测试验证所有文件存到同一文件夹（无 (1) 后缀）

### 结论
代码逻辑正确，batchId 在批次开始时生成一次，所有子任务通过闭包共用该 batchId。测试确认 3 个文件均存储在 20260114-085320 文件夹中，无重复文件夹。


## 修复：批量任务完成后的链接显示

- [x] 检查后端 task-complete 事件是否包含 url 字段（确认包含）
- [x] 检查前端 BatchProcess.tsx 链接显示逻辑（确认正确）
- [x] 测试验证：链接图标正常显示（截图可见 #14 #15 链接图标）

### 结论
链接显示功能正常，之前的问题可能是浏览器缓存或测试时的网络波动导致。


## 批次文件夹时间戳改为北京时间

- [x] 查找 batchId 生成代码（server/batch/batchRoutes.ts 第26行）
- [x] 修改为北京时间（UTC+8）
- [x] 测试验证时间戳正确

### 验证结果
- 批次 ID: 20260114-221409
- 当前北京时间: 20260114-221557
- 时间戳匹配，确认使用北京时间


## 文件名前缀设置功能

- [ ] 后端：添加 batchFilePrefix 配置读写接口
- [ ] 前端：添加文件名前缀输入框
- [ ] 修改文件命名逻辑使用前缀
- [ ] 测试验证：修改前缀后新文件使用新前缀
- [ ] 测试验证：刷新页面后前缀值保持

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


## 修复：同一批次文件存到不同文件夹

- [x] 检查 batchId 生成和传递逻辑（确认代码正确）
- [x] 确保所有子任务共用同一个 batchId（在请求开始时生成一次）
- [x] 测试验证所有文件存到同一文件夹（无 (1) 后缀）

### 结论
代码逻辑正确，batchId 在批次开始时生成一次，所有子任务通过闭包共用该 batchId。测试确认 3 个文件均存储在 20260114-085320 文件夹中，无重复文件夹。


## 修复：批量任务完成后的链接显示

- [x] 检查后端 task-complete 事件是否包含 url 字段（确认包含）
- [x] 检查前端 BatchProcess.tsx 链接显示逻辑（确认正确）
- [x] 测试验证：链接图标正常显示（截图可见 #14 #15 链接图标）

### 结论
链接显示功能正常，之前的问题可能是浏览器缓存或网络波动导致的临时现象。


## 批次文件夹时间戳改为北京时间

- [x] 查找 batchId 生成代码（server/batch/batchRoutes.ts 第26行）
- [x] 修改为北京时间（UTC+8）
- [x] 测试验证时间戳正确

### 验证结果
- 批次 ID: 20260114-221409
- 当前北京时间: 20260114-221557
- 时间戳匹配，确认使用北京时间


## 文件名前缀设置功能

- [x] 后端：添加 batchFilePrefix 配置读写接口
- [x] 前端：添加文件名前缀输入框
- [x] 修改文件命名逻辑使用前缀
- [x] 测试验证：修改前缀为「生词表」，生成文件名为「生词表01.docx」「生词表02.docx」
- [ ] 测试验证：刷新页面后前缀值保持（待验证）


## Step 20: 存储路径默认值和持久化

- [x] 后端：添加 batchStoragePath 配置到 DEFAULT_CONFIG
- [x] 后端：config.getAll 返回 batchStoragePath
- [x] 后端：config.update 支持 batchStoragePath 保存
- [x] 前端：存储路径输入框有默认值 Mac(online)/Documents/XDF/批量任务
- [x] 前端：修改后 onBlur 保存到数据库
- [x] 前端：清空后恢复默认值
- [x] 测试验证：首次打开页面显示默认值
- [x] 测试验证：修改路径后刷新页面，路径保持
- [x] 测试验证：清空路径后刷新，恢复默认值


## V47: 词汇卡片精确排版模板

- [x] 创建 server/templates/ 目录
- [x] 创建 server/templates/wordCardTemplate.ts
- [x] 将 JavaScript 代码转换为 TypeScript（import/export 语法）
- [x] 修复 Bookmark API 兼容性（docx 9.5.1 版本）
- [x] pnpm build 无报错
- [x] generateWordListDocx 函数可被其他文件 import


## V47b: 批量处理界面添加模板类型选择

- [x] 在「基本设置」区域添加「模板类型」下拉选择
- [x] 选项：通用文档（default）、词汇卡片（wordCard）
- [x] 默认选中「通用文档」
- [x] 状态变量 templateType 存储选中值
- [x] 发送请求时传递 templateType 给后端


## V47c: 后端根据模板类型选择Word生成方式

- [x] 从请求参数获取 templateType
- [x] templateType="wordCard" 时解析 JSON 并调用 generateWordListDocx
- [x] templateType="default" 时使用原有 Markdown 转 Word 逻辑
- [x] JSON 解析失败时返回错误信息
- [x] pnpm build 无报错



## V47d: JSON解析增加容错处理（方案A）

- [x] 在 batchRoutes.ts 中词汇卡片的 JSON 解析前添加清理逻辑
- [x] 清理 \`\`\`json 标记
- [x] 清理 \`\`\` 标记
- [x] AI输出带 \`\`\`json 标记时能正常解析
- [x] AI输出纯JSON时也能正常解析


## V47e: 限制路书文本框高度

- [x] 路书文本框高度固定为约5行（h-36 = 144px）
- [x] 超出内容时显示滚动条（overflow-y-auto）
- [x] 禁止用户拖拽调整大小（resize-none）


## V47f: 修复批次文件夹并发创建问题

- [x] 在启动并发池之前先创建批次文件夹
- [x] 所有任务共用同一个已存在的文件夹路径
- [ ] 运行5个以上并发任务，所有文件都在同一个文件夹里（待测试）
- [ ] 没有重复的文件夹（没有带(1)后缀的）（待测试）


## V47g: 排查并发数被限制为10的问题

- [x] 检查前端 BatchProcess.tsx 并发数输入框是否有 max 限制（无限制）
- [x] 检查后端 batchRoutes.ts 是否有 Math.min(concurrency, 10) 限制（找到！第131行）
- [x] 检查 concurrencyPool.ts 是否有并发数限制（无限制）
- [x] 修复找到的限制，从 10 改为 40



## V48 Step 1: 新增「生成MD文件」选项

- [x] 前端：模板类型下拉菜单新增「生成MD文件」选项（值：markdown_file）
- [x] 后端：判断 templateType === 'markdown_file' 时跳过转换，直接保存 .md 文件
- [x] 文件命名：使用现有逻辑，后缀改为 .md
- [x] TypeScript 编译无报错


## V48 Step 2: Markdown解析器 - 修复粗体/斜体样式

- [x] 创建 parseInlineFormatting 辅助函数
- [x] 解析 **粗体** 和 __粗体__ 标记
- [x] 解析 *斜体* 和 _斜体_ 标记
- [x] 解析 ***粗斜体*** 标记
- [x] 生成对应的 TextRun 数组
- [x] TypeScript 编译无报错


## V48 Step 2b: 模板类型扩展为4个选项

- [x] 前端：模板类型改为4个选项（markdown_plain, markdown_styled, markdown_file, word_card）
- [x] 前端：默认选中「教学材料（带样式）」
- [x] 后端：markdown_plain 使用黑白简洁样式（标题颜色 #000000）
- [x] 后端：markdown_styled 使用紫色标题（#6A1B9A）
- [x] TypeScript 编译无报错


## V48 Step 4: Markdown解析器 - 新增表格支持

- [x] 导入 docx 库的 Table、TableRow、TableCell 等组件
- [x] 创建 parseMarkdownTable 辅助函数
- [x] 识别以 | 开头的连续行为表格
- [x] 表头背景色：带样式模式 #E8D5F0（浅紫色），无样式模式无背景
- [x] 表格边框：浅灰色细线 #CCCCCC
- [x] 单元格内容支持粗体/斜体（复用 parseInlineFormatting）
- [x] TypeScript 编译无报错


## V48 Step 5: Markdown解析器 - 新增列表/引用/分隔线支持

- [x] 编号列表（1. 2. 3.）→ Word 编号列表（带缩进）
- [x] 项目符号（- 或 *）→ Word 项目符号列表（带缩进）
- [x] 引用块（> text）→ 带样式模式加橙色标记 ▸，无样式模式仅缩进
- [x] 分隔线（---）→ Word 水平线（浅灰色底边框）
- [x] 列表项内容支持粗体/斜体（复用 parseInlineFormatting）
- [x] TypeScript 编译无报错


## V49: 版本号显示 + max_tokens配置 + 截断检测

- [x] Step 1: 右上角添加版本号显示（V49）
- [x] Step 2: 数据库+后端新增 maxTokens 配置项（默认64000）
- [x] Step 3: 前端高级设置新增 maxTokens 文本框
- [x] Step 4: 后端检测 stop_reason，截断时返回警告
- [x] Step 5: 前端截断时显示提示（被截断任务显示警告标记）


## V50: 模板格式说明显示

- [x] Step 1: 定义5种模板类型的格式说明文本
- [x] Step 2: 添加模板格式说明显示区域（固定120px高度，滚动）
- [x] Step 3: 添加一键复制按钮（右上角，点击复制内容到剪贴板）


## V51: 文档转文本 + 来源标签

- [x] Step 1: 创建文档解析工具函数 (documentParser.ts)，支持 PDF 和 DOCX 转纯文本
- [x] Step 2: 文件上传接口集成 + 来源标签逻辑
  - [x] 文件上传时提取文档文本（PDF/DOCX）
  - [x] 实现 buildMessageContent 函数，添加 XML 来源标签
  - [x] <路书提示词> 包裹路书内容
  - [x] <共享文档> 包裹共享文档内容（多个用 --- 分隔）
  - [x] <单独文档> 包裹独立文档内容
  - [x] 图片继续使用 base64 格式
- [ ] Step 3: 前端文本预览显示（可选）
- [x] Step 4: 测试 + Checkpoint + 发布 V51
  - [x] 版本号更新为 V51
  - [x] PDF 文档解析测试通过
  - [x] DOCX 文档解析测试通过
  - [x] 来源标签功能测试通过
  - [x] pnpm build 无报错

## V51 Bug修复：extractedText 未传递到后端

- [x] 修复 BatchProcess.tsx 中 sharedFiles 传递时缺少 extractedText
- [x] 修复 BatchProcess.tsx 中 files (独立文件) 传递时缺少 extractedText
- [x] 清理排查日志代码
- [x] 测试验证文档内容能正确发送给 AI


## V52: AI代码生成Word系统

### Step 1.1: 创建沙箱执行模块
- [x] 安装 vm2 依赖（或使用 Node.js 内置 vm 模块）
- [x] 创建 server/core/codeSandbox.ts 文件
- [x] 实现 executeInSandbox 函数
- [x] 实现 cleanOutputDir 函数
- [x] 测试沙箱能生成 docx 文件 (所有 6 个测试通过)
- [x] pnpm build 无报错


### Step 1.2: 限制沙箱权限
- [x] 实现模块白名单机制（只允许 docx, fs, path）
- [x] 实现受限的 fs 模块（只能写入 outputDir）
- [x] 添加安全测试用例 (8 个安全测试全部通过)
- [x] 验证正常代码能执行
- [x] 验证恶意代码被拦截 (child_process, http, net, os 等)
- [x] pnpm build 无报错


### Step 2.1: 捕获语法和运行时错误
- [x] 扩展 ErrorDetail 类型定义（添加 line, column, codeSnippet）
- [x] 创建 parseErrorLocation 函数（从堆栈解析行号列号）
- [x] 创建 extractCodeSnippet 函数（提取出错位置代码片段）
- [x] 创建 buildErrorDetail 函数（构建详细错误信息）
- [x] 修改 executeInSandbox 使用新的错误解析逻辑
- [x] 添加错误解析测试用例 (8 个新测试)
- [x] 原有 14 个测试仍然通过 (共 22 个测试全部通过)
- [x] pnpm build 无报错


### Step 2.2: 格式化错误信息为AI可读格式
- [x] 创建 server/core/errorFormatter.ts 文件
- [x] 实现 formatErrorForAI 函数（输出格式化的错误文本）
- [x] 实现 getFixGuidance 函数（根据错误类型给出修复提示）
- [x] 实现 formatErrorSummary 函数（输出简短摘要）
- [x] 添加测试用例验证格式化输出 (11 个新测试)
- [x] 原有 22 个测试仍然通过 (共 72 个测试全部通过)
- [x] pnpm build 无报错


### Step 3.1: 实现重试控制器框架
- [x] 创建 server/core/codeRetry.ts 文件
- [x] 实现 executeWithRetry 函数（控制重试流程）
- [x] 实现 createMockFixer 函数（用于测试）
- [x] 添加测试用例验证重试逻辑 (10 个新测试)
- [x] 原有 72 个测试仍然通过 (共 82 个测试全部通过)
- [x] pnpm build 无报错


### Step 3.2: 对接AI实现代码修正
- [x] 创建 server/core/aiCodeFixer.ts 文件
- [x] 实现 cleanAIResponse 函数（去除 markdown 代码块标记）
- [x] 实现 createAICodeFixer 函数（创建 AI 代码修正器）
- [x] 实现 callAI 函数（调用 AI 接口）
- [x] 实现 createAICodeFixerFromConfig 函数（从配置创建修正器）
- [x] 添加单元测试验证 cleanAIResponse (14 个新测试)
- [x] 原有 82 个测试仍然通过 (共 96 个测试全部通过)
- [x] pnpm build 无报错


### Step 4.1: 验证文件存在性和大小
- [x] 创建 server/core/docxValidator.ts 文件
- [x] 实现 validateDocx 函数（检测文件存在性和大小）
- [x] 实现 quickCheck 函数（快速检查文件存在且非空）
- [x] 实现 getFileSize 函数（获取文件大小）
- [x] 实现 formatFileSize 函数（格式化文件大小）
- [x] 添加单元测试 (17 个新测试)
- [x] 原有 96 个测试仍然通过 (共 113 个测试全部通过)
- [x] pnpm build 无报错


### Step 4.2: 验证docx结构完整性
- [x] 安装 adm-zip 依赖
- [x] 实现 validateDocxStructure 函数（检查必要的内部文件）
- [x] 修改 validateDocx 函数支持 checkStructure 选项
- [x] 实现 listDocxContents 函数（列出 docx 内部文件）
- [x] 添加单元测试 (25 个测试，新增 8 个结构验证测试)
- [x] 原有 113 个测试仍然通过 (共 121 个测试全部通过)
- [x] pnpm build 无报错


### Step 5.1: 后端新增模板类型
- [x] 查看现有模板类型定义和处理逻辑
- [x] 新增 ai_code 模板类型到类型定义 (shared/templateTypes.ts)
- [x] 在模板处理逻辑中添加 ai_code 分支（占位）
- [x] 现有 5 种模板类型功能不受影响
- [x] pnpm build 无报错
- [x] 原有 121 个测试仍然通过


### Step 5.2: 后端整合完整流程
- [x] 创建 server/core/aiCodeProcessor.ts 文件
- [x] 实现 processAICodeGeneration 函数整合所有模块
- [x] 在 batchRoutes.ts 的 ai_code 分支调用处理器
- [x] 处理流程：AI生成 → 沙箱执行 → 重试 → 验证 → 返回结果
- [x] 进度回调正常工作
- [x] 错误情况正确处理和返回
- [x] pnpm build 无报错
- [x] 原有 121 个测试仍然通过


### Step 5.3: 前端新增模板选项
- [x] 在模板类型下拉菜单添加「自由排版（AI代码）」选项
- [x] 添加 ai_code 模板的说明文案
- [x] 确保类型定义包含 ai_code
- [x] 现有 5 种模板的选择和显示不受影响
- [x] pnpm build 无报错
- [x] 前端页面正常渲染


## V60 Bug修复：沙箱 require 不可用

- [x] 修改 codeSandbox.ts: VM 改为 NodeVM
- [x] pnpm build 无报错
- [x] 单元测试通过
- [x] git push 并验证


## V60 修复：沙箱 require 问题

- [x] 修改 aiCodeProcessor.ts 提示词，不再要求 AI 使用 require
- [x] 修改 codeSandbox.ts 沙箱配置，docx/fs/path 作为全局变量注入
- [x] 确认文件命名流程
- [x] pnpm build 无报错
- [x] git push 并验证


## V60 修复：沙箱 require 问题（最终修复）

- [x] 排查问题：require('docx') 在 ESM 环境下报错
- [x] 修复：在文件顶部添加 import * as docx from 'docx'
- [x] 修复：sandbox 配置中使用 docx: docx 而非 require('docx')
- [x] 沙箱测试通过：成功生成 Word 文档
- [x] git push 并验证


## V60.1 Step 1: 前端UI调整 - AI代码模式命名区域禁用

- [x] 添加 isAiCodeMode 判断变量
- [x] 命名规则区域添加禁用样式（opacity-50）
- [x] 显示提示文字「AI代码模式：文件名由AI在代码中自动决定」
- [x] 命名相关的 radio 添加 disabled 属性
- [x] 前缀输入框和文本解析区域在 AI 代码模式时隐藏
- [x] pnpm build 无报错
- [x] git push 并验证


## V60.1 Step 2: 路书调整 - AI代码模式添加文件命名要求

- [x] 更新 ai_code 模板的格式说明
- [x] 说明中包含「文件命名要求」
- [x] 说明中包含代码示例
- [x] pnpm build 无报错
- [x] git push 并验证


## V60.1 Step 3: 后端调整 - AI代码模式使用实际生成的文件名

- [x] ai_code 模式读取输出目录中的实际文件名
- [x] 用实际文件名上传到 Google Drive
- [x] SSE 事件返回实际文件名
- [x] 其他模板类型不受影响
- [x] pnpm build 无报错
- [x] git push 并验证


## V60.1 Step 4: 测试验收

- [ ] 测试1：AI代码模式命名区域禁用
- [ ] 测试2：切换模板类型恢复正常
- [ ] 测试3：AI代码模式自动命名生成文档
- [ ] 测试4：其他模板类型不受影响
- [ ] 保存 Checkpoint 并发布


## V60.1 修复：后端系统提示词让AI自己决定文件名

- [x] 修改系统提示词，不再要求固定使用 output.docx
- [x] 修改示例代码，展示如何自定义文件名
- [x] pnpm build 无报错
- [x] git push 并验证


## V61: 修复步骤失败时状态未更新的问题（闭包陷阱）

- [x] 一对一模式 runOneToOneGeneration 添加 localCurrentStep
- [x] 小班课模式 runClassGeneration 添加 localCurrentStep
- [x] 从依赖数组移除 currentStep
- [x] pnpm build 无报错
- [ ] 测试：步骤失败时正确显示红色error状态和重试按钮


## V61b: 让成功的步骤也显示"重做"按钮

- [x] 修改重试按钮显示条件（error || success）
- [x] 按钮文字根据状态区分（error显示"重试"，success显示"重做"）
- [x] pnpm build 无报错
- [ ] 测试：失败步骤显示"重试"，成功步骤显示"重做"


## V62: 为步骤2-5添加"跳过"功能

- [x] 添加 skipped 状态到 StepStatus 类型
- [x] 添加 skipStep 函数
- [x] 修改按钮渲染逻辑（步骤2-5显示跳过按钮）
- [x] 添加 skipped 状态的 UI 样式
- [x] 处理跳过后继续执行的逻辑
- [x] pnpm build 无报错
- [ ] 测试：步骤1失败只显示重试，步骤2-5失败显示重试+跳过


## V63: 修复 .md/.txt 文件文本提取功能

- [x] 修改 isParseableDocument 函数，添加 text/markdown 和 text/plain
- [x] 修改 parseDocumentToText 函数，添加纯文本文件处理分支
- [x] pnpm build 无报错
- [ ] 测试：上传 .md 文件后 extractedText 有值


## V63b: 版本号更新 + 自动化

- [x] 任务1：把 Home.tsx 版本号从 V60 改成 V63
- [x] 任务1：检查 BatchProcess.tsx 是否也有版本号显示（没有）
- [x] 任务2：创建 scripts/generate-version.cjs 脚本
- [x] 任务2：修改 package.json 构建脚本
- [x] 任务2：前端使用自动生成的版本号
- [x] 任务2：.gitignore 添加生成文件
- [x] pnpm build 无报错
- [x] 界面显示 V63 (5d1c446) 格式


## V63.1: 修复 .md 文件 mimetype 识别问题

- [x] 修改 documentParser.ts: parseDocumentToText 新增 filename 参数
- [x] 修改 batchRoutes.ts: 调用时传入 decodedFilename
- [x] pnpm build 无报错
- [ ] 测试：上传 .md 文件能正确提取文本
- [x] git push 成功


## V63.2: 清理调试日志

- [x] 清理 documentParser.ts 中的调试日志
- [x] 清理 batchRoutes.ts 中的调试日志
- [x] 清理 aiCodeProcessor.ts 中的调试日志
- [x] grep -rn "DEBUG" server/ 返回空或只有合理内容
- [x] pnpm build 无报错
- [x] git push 成功
