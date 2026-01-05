import { invokeWhatAI, MODELS } from "./whatai";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, PageBreak, AlignmentType } from "docx";
import sharp from "sharp";

export interface FeedbackInput {
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

export interface StepStatus {
  step: string;
  status: 'pending' | 'running' | 'success' | 'error';
  message?: string;
  error?: string;
}

export interface FeedbackResult {
  feedback: string;
  review: Buffer;
  test: Buffer;
  extraction: string;
  bubbleChart: Buffer;
  steps: StepStatus[];
}

// ========== V9路书完整提示词 ==========
const FEEDBACK_SYSTEM_PROMPT = `你是新东方托福阅读教师的反馈助手。请严格按照以下V9路书规范生成学情反馈。

【重要格式要求】
这份反馈是给家长看的，要能直接复制到微信群，所以：
1. 不要使用任何markdown标记（不要用#、**、*、\`\`\`等）
2. 不要用表格格式
3. 不要用自动编号（手打1. 2. 3.）
4. 不要用首行缩进
5. 可以用中括号【】来标记章节
6. 可以用空行分隔段落
7. 直接输出纯文本

【核心红线】
1. 本次课内容只能来自「本次课笔记」和「录音转文字」，绝对不要把上次反馈里的内容复制过来
2. 内容必须一一对应：反馈里有多少生词→复习文档讲解多少→测试本测多少

【学情反馈文档结构】

开头格式：
张三 阅读课反馈

上次课：2025-01-08
本次课：2025-01-15（间隔7天）
下次课：2025-01-22

【授课内容】（5-10条）
写本堂课做了什么，按「诊断→方法→训练→纠错→巩固」的顺序：
1. 诊断上次课词汇记忆情况，针对遗忘词汇进行二次强化

2. 讲解主谓一致核心原则，建立语法判断框架

3. 训练词汇填空题型，强化词形变换敏感度

【课堂笔记】
分类整理本次课的知识点：
- 题型方法（定位词、转折词、排除逻辑等）
- 段落逻辑（对比/转折/因果/总分等）
- 语法要点（后置定语、独立主格、并列等）
- 如果有特殊题型（如词汇填空），单独列出解题要点

【随堂测试】
用100分制，分项评估：
测试形式：课堂互动型评测

分项评估：
- 生词复习：85分（20个词记住17个）
- 长难句翻译：75分（结构拆分准确，个别词义有偏差）
- 主谓一致练习：60分（10题对6题，就近原则还不熟）

综合得分：73/100

诊断：生词记忆有进步，语法规则应用还需加强

多轮测试情况：如果生词经过多轮测试，写清楚"第一轮正确率X%，经过3轮后全部掌握"或"3轮后仍有X个词未掌握：xxx, xxx"

【作业批改】
给分口径（按顺序判断）：
1. 老师明确说了完成情况 → 按实际给分
2. 从录音能听出完成情况 → 按实际给分（不写"从录音听到"）
3. 都没有 → 根据课堂对旧知识的掌握情况评估
4. 明确说没做 → 0分，提醒按时完成
5. 首次课 → 写"首次课，无上次作业"

不用在反馈里解释给分口径，直接给分和评价就行。

【表现及建议】
按主题分段：分数稳定性、定位能力、推断边界、时间心态、语法障碍、复盘沉淀等。
每段用可执行的短句，写清楚"做什么+什么时候做+做到什么程度"。

注意：
- 改善方案要和后面的作业布置一致，不要开空头支票
- 不要重复前面随堂测试/作业批改里已经列过的生词长难句
- 如果课上聊到了单词背诵进度（背到哪个单元、APP完成百分比），要记录下来
- 根据生词掌握情况，给出具体的单词背诵建议

【生词】（必须15-25个，这是硬性要求！）
收录本次课讲解的生词，格式：1 pristine - 原始的；崭新的

重要：
- 必须达到15个以上！不足15个必须从课堂材料（笔记和录音转文字）中补齐
- 超过25个则精选最重要的25个
- 避免和上节课重复
- 优先收录动词、形容词，少收专业术语
- 如果课堂材料中生词不够15个，从录音转文字中提取老师讲解过的任何英文词汇

【长难句讲解】
每句包含：结构拆分 + 讲解要点 + 翻译
只用本次课讲解过的句子。

【作业布置】
按周一~周日的周期细分，不要只写总量：
【第一阶段】1月15日(周三)-1月19日(周日)：
- 完成主谓一致练习册第1组（30题）
- 复习课上笔记+生词+长难句+错题，完成《测试版》自测

【第二阶段】1月20日(周一)-1月22日(周三)：
- 完成主谓一致练习册第2组（30题）
- 生词二次自测

关于模考：
- 不一定是TPO，还有XPO、NPO，没明确就不要写TPO
- 2023年改革后阅读是2篇文章36分钟，不要再写3篇54分钟

间隔较长时：如果两次课隔得久，每周都要安排复习+自测

【错题合集】
收录所有课上讲过的错题，宁多勿漏。正确率很低的练习（如10题对2题）必须收录。

格式要求：
- 完整复制原文、题干、所有选项，不要缩写改写
- 插入题用【Y】标记插入点
- 句子简化题把目标句标注出来
- 全部错题列完后，统一给答案与解析

特殊题型处理：
- 小结题：删掉"An introductory sentence..."那个介绍句，只保留ABCDEF选项
- 句子简化题：如果只有一个长难句+选项，不要硬加无关段落

【答案与解析】
在错题合集之后，统一给出所有错题的答案和解析。

【敏感词替换】
- 「大波」→「较大的波动」
- 「被插」→「被插入句打断」
- 「口爆」→「人口爆发式增长」

最后以【OK】结尾表示反馈完成。`;

// ========== 复习文档提示词 ==========
const REVIEW_SYSTEM_PROMPT = `你是专业的托福阅读教师，请根据学情反馈生成详细的复习文档。

【重要格式要求】
这是Word文档内容，请使用纯文本格式：
1. 用"一、""二、""三、"等中文序号作为章节标题
2. 不要使用markdown标记（不要用#、**、*等）
3. 不要使用HTML代码
4. 可以用空行分隔段落

【复习文档结构】

一、课堂笔记
直接复制学情反馈中的【课堂笔记】部分，保持一致。

二、生词列表
从学情反馈的【生词】部分提取，每个词扩展为：

1. pristine /ˈprɪstiːn/
   词性：adj.
   词根词缀：prist-(最初的) + -ine(形容词后缀)
   英文释义：in its original condition; unspoiled
   中文释义：原始的；崭新的；纯净的
   例句：The pristine beaches of the island attract many tourists.
   例句翻译：这座岛屿原始的海滩吸引了许多游客。

重要：生词顺序、数量必须和反馈里的【生词】部分完全一致！

三、长难句讲解
直接复制学情反馈中的【长难句讲解】部分，保持一致。
每句包含：原句 + 结构拆分 + 讲解要点 + 翻译

四、错题汇总
从学情反馈的【错题合集】提取：
- 先列出所有题目（原文、题干、选项）
- 最后统一给答案和解析

末尾加一句：好好复习，早日出分！`;

// ========== 测试本提示词 ==========
const TEST_SYSTEM_PROMPT = `你是专业的托福阅读教师，请根据复习文档生成测试版本。

【重要格式要求】
这是Word文档内容，请使用纯文本格式：
1. 用"一、""二、""三、"等中文序号作为章节标题
2. 不要使用markdown标记（不要用#、**、*等）
3. 不要使用HTML代码（不要用<div>等标签）
4. 答案部分前面写"===== 答案部分 ====="作为分隔（系统会自动转换为分页符）
5. 可以用空行分隔段落

【测试本结构】

一、生词测试
只保留英文单词，去掉所有中文释义、词根词缀、例句：

1. pristine - 你的答案：______
2. elaborate - 你的答案：______
3. subsequent - 你的答案：______
...

二、长难句翻译
只保留英文原句，去掉结构拆分、讲解要点和翻译：

1. The rapid expansion of urban areas has led to significant changes in local ecosystems, affecting both flora and fauna in ways that scientists are only beginning to understand.

请翻译：______

2. ...

三、错题练习
只保留题目（原文、题干、选项），去掉所有答案和解析。

===== 答案部分 =====

一、生词答案
1. pristine - 原始的；崭新的
2. elaborate - 详细的；精心制作的
3. subsequent - 随后的
...

二、长难句翻译参考
1. 城市地区的快速扩张导致了当地生态系统的重大变化，以科学家们才刚刚开始理解的方式影响着动植物。
...

三、错题答案
第1题：C
解析：...
第2题：A
解析：...
...

重要：答案部分必须和题目部分分开，中间用"===== 答案部分 ====="分隔！`;

// ========== 课后信息提取提示词 ==========
const EXTRACTION_SYSTEM_PROMPT = `你是专业的托福阅读教师，请根据学情反馈生成课后信息提取文档（给助教用的作业管理档案）。

【重要说明】
这是给助教用的作业管理档案，不是课程摘要。
不要放生词、长难句、错题详情（已经在复习文档里了）。
使用纯文本格式，不要用markdown标记。

【格式模板】

=== 张三 作业管理档案 ===

【时间轴】
上次课：2025-01-08
下次课：2025-01-22
考试目标：2025年3月（如有）

【旧账核对】
上次作业完成度：80%
已完成：主谓一致练习册第1组
未完成：第2组只做了一半
遗留问题：就近原则还不熟

【新任务清单】
【第一阶段】1月15日-1月19日：
1. 完成主谓一致练习册第2组
2. 复习文档+测试版自测

【第二阶段】1月20日-1月22日：
1. 完成第3组
2. 二次自测

【每日固定任务】
- 每日背单词30-40分钟

【助教备注】
当前状态：语法基础在补
重点跟进：就近原则掌握情况`;

// ========== 气泡图提示词 ==========
const BUBBLE_CHART_SYSTEM_PROMPT = `你是专业的托福阅读教师，请从学情反馈中提取问题和解决方案，用于制作气泡图。

【提取规则】
1. 从反馈的「随堂测试」「作业批改」「表现及建议」中提取3-6个问题-方案对
2. 方案必须是反馈里写过的，不能自己编
3. 如果某个问题在反馈里没有对应方案，就不要放这个问题

【文字精简规则】
每个框里放两行字：主标题 + 副标题

示例：
原文：历史类文章生词障碍严重
主标题：历史类文章
副标题：生词障碍严重

原文：猜词练习针对历史/天文/艺术薄弱题材
主标题：猜词练习针对
副标题：历史/天文/艺术薄弱题材

【输出格式】
只输出JSON，不要其他内容：
[
  {"problem": ["主标题", "副标题"], "solution": ["主标题", "副标题"]},
  ...
]`;

/**
 * 生成学情反馈文档
 */
async function generateFeedbackContent(input: FeedbackInput): Promise<string> {
  const prompt = `## 学生信息
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

请严格按照V9路书规范生成完整的学情反馈文档。
特别注意：
1. 不要使用任何markdown标记，输出纯文本
2. 【生词】部分必须达到15-25个，不足15个必须从课堂材料中补齐！`;

  const response = await invokeWhatAI([
    { role: "system", content: FEEDBACK_SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ], { model: MODELS.DEFAULT, max_tokens: 8000 });

  return response.choices[0]?.message?.content || "";
}

/**
 * 从反馈中提取生词、长难句、错题，生成复习文档内容
 */
async function generateReviewContent(feedback: string, studentName: string): Promise<string> {
  const prompt = `学生姓名：${studentName}

学情反馈内容：
${feedback}

请严格按照复习文档格式规范生成复习文档。
特别注意：
1. 不要使用markdown标记，输出纯文本
2. 生词顺序、数量必须和反馈里的【生词】部分完全一致！`;

  const response = await invokeWhatAI([
    { role: "system", content: REVIEW_SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ], { model: MODELS.DEFAULT, max_tokens: 8000 });

  return response.choices[0]?.message?.content || "";
}

/**
 * 生成测试本内容（去掉答案）
 */
async function generateTestContent(reviewContent: string): Promise<string> {
  const prompt = `复习文档内容：
${reviewContent}

请严格按照测试本格式规范生成测试版本。
特别注意：
1. 不要使用markdown标记，输出纯文本
2. 不要使用HTML代码
3. 答案部分前面用"===== 答案部分 ====="分隔`;

  const response = await invokeWhatAI([
    { role: "system", content: TEST_SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ], { model: MODELS.DEFAULT, max_tokens: 6000 });

  return response.choices[0]?.message?.content || "";
}

/**
 * 生成课后信息提取
 */
async function generateExtractionContent(input: FeedbackInput, feedback: string): Promise<string> {
  const prompt = `学生姓名：${input.studentName}
下次课日期：${input.nextLessonDate || "待定"}

学情反馈内容：
${feedback}

请严格按照课后信息提取格式规范生成作业管理档案。不要使用markdown标记。`;

  const response = await invokeWhatAI([
    { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ], { model: MODELS.DEFAULT, max_tokens: 2000 });

  return response.choices[0]?.message?.content || "";
}

/**
 * 从反馈中提取问题和方案，用于气泡图
 */
async function extractProblemsAndSolutions(feedback: string): Promise<Array<{problem: string[], solution: string[]}>> {
  const prompt = `学情反馈内容：
${feedback}

请提取3-6个问题-方案对，只输出JSON格式。`;

  const response = await invokeWhatAI([
    { role: "system", content: BUBBLE_CHART_SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ], { model: MODELS.DEFAULT, max_tokens: 1000 });

  try {
    const content = response.choices[0]?.message?.content || "[]";
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
 * 将SVG转换为PNG（使用sharp）
 */
async function svgToPng(svgContent: string): Promise<Buffer> {
  try {
    const pngBuffer = await sharp(Buffer.from(svgContent))
      .png()
      .toBuffer();
    return pngBuffer;
  } catch (error) {
    console.error("[气泡图] SVG转PNG失败:", error);
    throw error;
  }
}

/**
 * 清理文本中的markdown和HTML标记
 */
function cleanMarkdownAndHtml(content: string): string {
  let cleaned = content;
  
  // 移除HTML标签
  cleaned = cleaned.replace(/<[^>]+>/g, '');
  
  // 移除markdown粗体标记 **text** 或 __text__
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
  cleaned = cleaned.replace(/__([^_]+)__/g, '$1');
  
  // 移除markdown斜体标记 *text* 或 _text_
  cleaned = cleaned.replace(/\*([^*]+)\*/g, '$1');
  cleaned = cleaned.replace(/_([^_]+)_/g, '$1');
  
  // 移除markdown标题标记
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');
  
  // 移除代码块标记
  cleaned = cleaned.replace(/```[\s\S]*?```/g, (match) => {
    return match.replace(/```\w*\n?/g, '').replace(/```/g, '');
  });
  
  // 移除行内代码标记
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');
  
  return cleaned;
}

/**
 * 将纯文本内容转换为DOCX格式（使用docx库）
 */
async function textToDocx(content: string, title: string): Promise<Buffer> {
  // 先清理markdown和HTML标记
  const cleanedContent = cleanMarkdownAndHtml(content);
  
  const lines = cleanedContent.split('\n');
  const children: Paragraph[] = [];
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // 检测分页符标记
    if (trimmedLine.includes('===== 答案') || trimmedLine.includes('=====答案') || 
        trimmedLine === '---' || trimmedLine.startsWith('=====')) {
      // 添加分页符
      children.push(new Paragraph({
        children: [new PageBreak()],
      }));
      // 如果有文字内容，也添加
      if (trimmedLine.includes('答案')) {
        children.push(new Paragraph({
          text: trimmedLine.replace(/=/g, '').trim(),
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          spacing: { before: 400, after: 200 },
        }));
      }
    } else if (trimmedLine.startsWith('一、') || trimmedLine.startsWith('二、') || 
               trimmedLine.startsWith('三、') || trimmedLine.startsWith('四、') ||
               trimmedLine.startsWith('五、') || trimmedLine.startsWith('六、')) {
      // 中文序号标题
      children.push(new Paragraph({
        text: trimmedLine,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 },
      }));
    } else if (trimmedLine.startsWith('【') && trimmedLine.endsWith('】')) {
      // 中括号标题
      children.push(new Paragraph({
        text: trimmedLine,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 150 },
      }));
    } else if (trimmedLine.startsWith('【')) {
      // 以中括号开头的标题
      children.push(new Paragraph({
        text: trimmedLine,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 150 },
      }));
    } else if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('• ')) {
      // 无序列表
      children.push(new Paragraph({
        text: '• ' + trimmedLine.substring(2),
        spacing: { before: 50, after: 50 },
        indent: { left: 720 },
      }));
    } else if (/^\d+[\.\、]\s*/.test(trimmedLine)) {
      // 有序列表（支持 1. 或 1、 格式）
      children.push(new Paragraph({
        text: trimmedLine,
        spacing: { before: 50, after: 50 },
        indent: { left: 360 },
      }));
    } else if (trimmedLine === '') {
      // 空行
      children.push(new Paragraph({
        text: '',
        spacing: { before: 100, after: 100 },
      }));
    } else {
      // 普通段落
      children.push(new Paragraph({
        text: trimmedLine,
        spacing: { before: 100, after: 100 },
      }));
    }
  }
  
  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          text: title,
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
        }),
        ...children,
      ],
    }],
  });
  
  return await Packer.toBuffer(doc);
}

/**
 * 主函数：生成所有5个文档，带状态回调
 */
export async function generateFeedbackDocuments(
  input: FeedbackInput,
  onProgress?: (step: StepStatus) => void
): Promise<FeedbackResult> {
  const steps: StepStatus[] = [
    { step: '学情反馈', status: 'pending' },
    { step: '复习文档', status: 'pending' },
    { step: '测试本', status: 'pending' },
    { step: '课后信息提取', status: 'pending' },
    { step: '气泡图', status: 'pending' },
  ];

  const updateStep = (index: number, status: StepStatus['status'], message?: string, error?: string) => {
    steps[index] = { ...steps[index], status, message, error };
    if (onProgress) {
      onProgress(steps[index]);
    }
  };

  let feedback = '';
  let reviewContent = '';
  let testContent = '';
  let extraction = '';
  let reviewDocx = Buffer.from('');
  let testDocx = Buffer.from('');
  let bubbleChartPng = Buffer.from('');

  // 1. 生成学情反馈
  try {
    updateStep(0, 'running', '正在调用Claude生成学情反馈...');
    feedback = await generateFeedbackContent(input);
    // 清理markdown标记
    feedback = cleanMarkdownAndHtml(feedback);
    updateStep(0, 'success', `生成完成，共${feedback.length}字`);
  } catch (err) {
    updateStep(0, 'error', undefined, err instanceof Error ? err.message : '生成失败');
    throw err;
  }

  // 2. 生成复习文档
  try {
    updateStep(1, 'running', '正在生成复习文档...');
    reviewContent = await generateReviewContent(feedback, input.studentName);
    reviewDocx = await textToDocx(reviewContent, `${input.studentName}${input.lessonDate}复习文档`);
    updateStep(1, 'success', `生成完成，共${reviewContent.length}字`);
  } catch (err) {
    updateStep(1, 'error', undefined, err instanceof Error ? err.message : '生成失败');
    throw err;
  }

  // 3. 生成测试本
  try {
    updateStep(2, 'running', '正在生成测试本...');
    testContent = await generateTestContent(reviewContent);
    testDocx = await textToDocx(testContent, `${input.studentName}${input.lessonDate}测试本`);
    updateStep(2, 'success', `生成完成，共${testContent.length}字`);
  } catch (err) {
    updateStep(2, 'error', undefined, err instanceof Error ? err.message : '生成失败');
    throw err;
  }

  // 4. 生成课后信息提取
  try {
    updateStep(3, 'running', '正在生成课后信息提取...');
    extraction = await generateExtractionContent(input, feedback);
    // 清理markdown标记
    extraction = cleanMarkdownAndHtml(extraction);
    updateStep(3, 'success', `生成完成，共${extraction.length}字`);
  } catch (err) {
    updateStep(3, 'error', undefined, err instanceof Error ? err.message : '生成失败');
    throw err;
  }

  // 5. 生成气泡图
  try {
    updateStep(4, 'running', '正在生成气泡图...');
    const problemsAndSolutions = await extractProblemsAndSolutions(feedback);
    const bubbleChartSVG = generateBubbleChartSVG(
      input.studentName,
      input.lessonDate,
      input.lessonNumber,
      problemsAndSolutions.length > 0 ? problemsAndSolutions : [
        { problem: ["暂无问题", ""], solution: ["继续保持", ""] }
      ]
    );
    bubbleChartPng = await svgToPng(bubbleChartSVG);
    updateStep(4, 'success', `生成完成，提取${problemsAndSolutions.length}个问题-方案对`);
  } catch (err) {
    updateStep(4, 'error', undefined, err instanceof Error ? err.message : '生成失败');
    throw err;
  }

  return {
    feedback,
    review: reviewDocx,
    test: testDocx,
    extraction,
    bubbleChart: bubbleChartPng,
    steps,
  };
}
