import { invokeLLM, TextContent, ImageContent, FileContent } from "./_core/llm";

// 辅助函数：从LLM响应中提取文本内容
function extractTextContent(content: string | Array<TextContent | ImageContent | FileContent>): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((item): item is TextContent => item.type === 'text')
      .map(item => item.text)
      .join('');
  }
  return '';
}

interface FeedbackInput {
  studentName: string;
  lessonNumber: string;
  lessonDate: string;
  nextLessonDate: string;
  lastFeedback: string;
  currentNotes: string;
  transcript: string;
  isFirstLesson: boolean;
  specialRequirements: string;
}

interface FeedbackDocuments {
  feedback: string;      // 学情反馈 .md
  review: Buffer;        // 复习文档 .docx
  test: Buffer;          // 测试本 .docx
  extraction: string;    // 课后信息提取 .md
  bubbleChart: Buffer;   // 气泡图 .png
}

// 路书提示词（核心指令）
const ROADMAP_PROMPT = `你是新东方托福阅读教师的反馈助手。请严格按照以下规范生成学情反馈。

## 核心红线（必须遵守）
1. 本次课内容只能来自「本次课笔记」和「录音转文字」，不要复制上次反馈的内容
2. 反馈是给家长看的，要能直接复制到微信群：不用表格、不用自动编号、不用首行缩进
3. 内容必须一一对应：反馈里的生词数量 = 复习文档里的 = 测试本里的

## 学情反馈结构
按以下顺序输出，每个板块用【】标记：

【授课内容】5-10条，按「诊断→方法→训练→纠错→巩固」顺序
【课堂笔记】分类整理知识点
【随堂测试】100分制分项评估
【作业批改】根据完成情况给分
【表现及建议】按主题分段，写清楚"做什么+什么时候做+做到什么程度"
【生词】15-25个，格式：1 pristine - 原始的；崭新的
【长难句讲解】结构拆分 + 讲解要点 + 翻译
【作业布置】按周细分
【错题合集】完整复制原文、题干、选项
【答案与解析】

## 敏感词替换
- 「大波」→「较大的波动」
- 「被插」→「被插入句打断」
- 「口爆」→「人口爆发式增长」`;

/**
 * 生成学情反馈文档
 */
async function generateFeedbackContent(input: FeedbackInput): Promise<string> {
  const prompt = `${ROADMAP_PROMPT}

## 学生信息
- 学生姓名：${input.studentName}
- 课次：${input.lessonNumber || "未指定"}
- 本次课日期：${input.lessonDate}
- 下次课日期：${input.nextLessonDate || "待定"}
${input.isFirstLesson ? "- 这是新生首次课" : ""}
${input.specialRequirements ? `- 特殊要求：${input.specialRequirements}` : ""}

## 上次反馈
${input.isFirstLesson ? "（新生首次课，无上次反馈）" : (input.lastFeedback || "（未提供）")}

## 本次课笔记
${input.currentNotes}

## 录音转文字
${input.transcript}

请生成完整的学情反馈文档，开头格式为：
${input.studentName} 阅读课反馈

上次课：（从上次反馈提取或写"首次课"）
本次课：${input.lessonDate}
下次课：${input.nextLessonDate || "待定"}`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: "你是专业的托福阅读教师反馈助手，请严格按照路书规范生成学情反馈。" },
      { role: "user", content: prompt },
    ],
    max_tokens: 8000,
  });

  return extractTextContent(response.choices[0]?.message?.content || "");
}

/**
 * 从反馈中提取生词、长难句、错题，生成复习文档内容
 */
async function generateReviewContent(feedback: string, studentName: string): Promise<string> {
  const prompt = `根据以下学情反馈，提取并整理成复习文档。

复习文档包含4部分：
1. 课堂笔记（和反馈一致）
2. 生词列表（每个词加上：词性、词根词缀、英文释义、例句+翻译）
3. 长难句讲解（和反馈一致）
4. 错题汇总（先列题目，最后统一给答案解析）

生词顺序、数量必须和反馈里的一致。
末尾加一句：好好复习，早日出分！

学情反馈内容：
${feedback}`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: "你是专业的托福阅读教师，请根据学情反馈生成详细的复习文档。" },
      { role: "user", content: prompt },
    ],
    max_tokens: 8000,
  });

  return extractTextContent(response.choices[0]?.message?.content || "");
}

/**
 * 生成测试本内容（去掉答案）
 */
async function generateTestContent(reviewContent: string): Promise<string> {
  const prompt = `根据以下复习文档，生成测试版本：
- 生词：只留英文，去掉中文释义
- 长难句：只留句子，去掉讲解和翻译
- 错题：只留题目，去掉答案

答案要另起一页（用 ===== 答案 ===== 分隔），格式：
【生词答案】
1. pristine - 原始的
...

【长难句翻译】
1. xxxxx
...

【错题答案】
第1题：C
...

复习文档内容：
${reviewContent}`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: "你是专业的托福阅读教师，请根据复习文档生成测试版本。" },
      { role: "user", content: prompt },
    ],
    max_tokens: 6000,
  });

  return extractTextContent(response.choices[0]?.message?.content || "");
}

/**
 * 生成课后信息提取
 */
async function generateExtractionContent(input: FeedbackInput, feedback: string): Promise<string> {
  const prompt = `根据以下学情反馈，生成课后信息提取文档（给助教用的作业管理档案）。

不要放生词、长难句、错题详情（已经在复习文档里了）。

格式：
=== ${input.studentName} 作业管理档案 ===

【时间轴】
上次课：（日期）
下次课：${input.nextLessonDate || "待定"}
考试目标：（如有）

【旧账核对】
上次作业完成度：X%
✅ 已完成：xxx
❌ 未完成：xxx
⚠ 遗留问题：xxx

【新任务清单】
【第一阶段】日期-日期：
1. xxx
2. xxx

【第二阶段】日期-日期：
1. xxx
2. xxx

【每日固定任务】
- 每日背单词30-40分钟

【助教备注】
当前状态：xxx
重点跟进：xxx

学情反馈内容：
${feedback}`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: "你是专业的托福阅读教师，请根据学情反馈生成课后信息提取文档。" },
      { role: "user", content: prompt },
    ],
    max_tokens: 2000,
  });

  return extractTextContent(response.choices[0]?.message?.content || "");
}

/**
 * 从反馈中提取问题和方案，用于气泡图
 */
async function extractProblemsAndSolutions(feedback: string): Promise<Array<{problem: string[], solution: string[]}>> {
  const prompt = `从以下学情反馈中提取3-6个"问题-方案"对，用于制作气泡图。

每个问题和方案都要精简成两行文字：主标题 + 副标题

输出JSON格式：
[
  {"problem": ["主标题", "副标题"], "solution": ["主标题", "副标题"]},
  ...
]

学情反馈内容：
${feedback}

只输出JSON，不要其他内容。`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: "你是专业的托福阅读教师，请从学情反馈中提取问题和解决方案。只输出JSON格式。" },
      { role: "user", content: prompt },
    ],
    max_tokens: 1000,
  });

  try {
    const content = extractTextContent(response.choices[0]?.message?.content || "[]");
    // 尝试提取JSON
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * 生成气泡图SVG
 */
function generateBubbleChartSVG(
  studentName: string,
  lessonDate: string,
  lessonNumber: string,
  items: Array<{problem: string[], solution: string[]}>
): string {
  const colors = ['#FFE4E1', '#E8F5E9', '#E3F2FD', '#F3E5F5', '#FFF9C4', '#FFE0B2'];
  const boxWidth = 200, boxHeight = 90, gap = 20;
  const leftX = 80, rightX = 520;
  const startY = 120;
  const height = Math.max(700, startY + items.length * (boxHeight + gap) + 80);

  const itemsSVG = items.map((item, i) => {
    const y = startY + i * (boxHeight + gap);
    const color = colors[i % colors.length];
    return `
    <g>
      <!-- 问题框 -->
      <rect x="${leftX}" y="${y}" width="${boxWidth}" height="${boxHeight}" rx="12" fill="white" stroke="#4ECDC4" stroke-width="3"/>
      <text x="${leftX + boxWidth/2}" y="${y + 35}" text-anchor="middle" font-size="18" font-weight="bold" fill="#333">${item.problem[0] || ''}</text>
      <text x="${leftX + boxWidth/2}" y="${y + 58}" text-anchor="middle" font-size="16" fill="#333">${item.problem[1] || ''}</text>
      
      <!-- 箭头 -->
      <line x1="${leftX + boxWidth + 10}" y1="${y + boxHeight/2}" x2="${rightX - 10}" y2="${y + boxHeight/2}" stroke="#AAA" stroke-width="2" marker-end="url(#arrow)"/>
      
      <!-- 方案框 -->
      <rect x="${rightX}" y="${y}" width="${boxWidth}" height="${boxHeight}" rx="12" fill="${color}" stroke="none"/>
      <text x="${rightX + boxWidth/2}" y="${y + 35}" text-anchor="middle" font-size="18" font-weight="bold" fill="#333">${item.solution[0] || ''}</text>
      <text x="${rightX + boxWidth/2}" y="${y + 58}" text-anchor="middle" font-size="16" fill="#333">${item.solution[1] || ''}</text>
    </g>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 900 ${height}" xmlns="http://www.w3.org/2000/svg">
  <style>text { font-family: "Noto Sans CJK SC", "WenQuanYi Micro Hei", "Microsoft YaHei", sans-serif; }</style>
  
  <!-- 背景 -->
  <rect width="900" height="${height}" fill="white"/>
  
  <!-- 标题 -->
  <text x="450" y="45" text-anchor="middle" font-size="28" font-weight="bold" fill="#333">
    ${studentName}${lessonDate}阅读课｜问题-方案气泡图
  </text>
  
  <!-- 列标题 -->
  <text x="${leftX + boxWidth/2}" y="85" text-anchor="middle" font-size="20" font-weight="bold" fill="#E74C3C">问题</text>
  <text x="${rightX + boxWidth/2}" y="85" text-anchor="middle" font-size="20" font-weight="bold" fill="#27AE60">解决方案</text>
  
  ${itemsSVG}
  
  <!-- 箭头定义 -->
  <defs>
    <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
      <path d="M0,0 L0,6 L9,3 z" fill="#AAA"/>
    </marker>
  </defs>
  
  <!-- 底部日期 -->
  <text x="450" y="${height - 20}" text-anchor="middle" font-size="14" fill="#666">
    2025年${lessonDate} ${lessonNumber || ''}
  </text>
</svg>`;
}

/**
 * 将SVG转换为PNG（使用简单的方法）
 */
async function svgToPng(svgContent: string): Promise<Buffer> {
  // 由于环境限制，这里返回SVG内容作为Buffer
  // 实际部署时可以使用sharp或puppeteer进行转换
  return Buffer.from(svgContent, 'utf-8');
}

/**
 * 将Markdown转换为简单的DOCX格式
 * 注意：这是一个简化版本，实际可能需要更复杂的处理
 */
function markdownToDocxBuffer(content: string): Buffer {
  // 简化处理：返回纯文本内容作为Buffer
  // 实际部署时应使用docx库生成真正的Word文档
  return Buffer.from(content, 'utf-8');
}

/**
 * 主函数：生成所有5个文档
 */
export async function generateFeedbackDocuments(input: FeedbackInput): Promise<FeedbackDocuments> {
  // 1. 生成学情反馈
  console.log("正在生成学情反馈...");
  const feedback = await generateFeedbackContent(input);
  
  // 2. 生成复习文档
  console.log("正在生成复习文档...");
  const reviewContent = await generateReviewContent(feedback, input.studentName);
  
  // 3. 生成测试本
  console.log("正在生成测试本...");
  const testContent = await generateTestContent(reviewContent);
  
  // 4. 生成课后信息提取
  console.log("正在生成课后信息提取...");
  const extraction = await generateExtractionContent(input, feedback);
  
  // 5. 生成气泡图
  console.log("正在生成气泡图...");
  const problemsAndSolutions = await extractProblemsAndSolutions(feedback);
  const bubbleChartSVG = generateBubbleChartSVG(
    input.studentName,
    input.lessonDate,
    input.lessonNumber,
    problemsAndSolutions.length > 0 ? problemsAndSolutions : [
      { problem: ["暂无问题", ""], solution: ["继续保持", ""] }
    ]
  );
  const bubbleChartPng = await svgToPng(bubbleChartSVG);
  
  return {
    feedback,
    review: markdownToDocxBuffer(reviewContent),
    test: markdownToDocxBuffer(testContent),
    extraction,
    bubbleChart: bubbleChartPng,
  };
}
