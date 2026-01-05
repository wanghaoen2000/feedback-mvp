import { invokeWhatAI, invokeWhatAIStream, MODELS, APIConfig } from "./whatai";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, PageBreak, AlignmentType } from "docx";
import sharp from "sharp";

// 录音转文字压缩配置
const TRANSCRIPT_COMPRESS_CONFIG = {
  maxLength: 4000,        // 超过此长度就需要压缩
  chunkSize: 3000,        // 每段的最大长度
  targetRatio: 0.5,       // 压缩目标比例（50%）
};

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

【日期提取】
请从课堂笔记中自动识别以下日期信息：
- 上次课日期
- 本次课日期
- 下次课日期
如果笔记中有明确的日期信息，请使用笔记中的日期。

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

每段3-5句，先描述表现，再给具体建议。
不要空泛地说"继续努力"，要给出具体的行动建议。

【生词】（15-25个，硬性要求！）
这是最重要的部分！必须达到15-25个生词！

格式：
1. 单词 /音标/ 词性. 中文释义

示例：
1. contemplate /ˈkɒntəmpleɪt/ v. 沉思；考虑
2. unprecedented /ʌnˈpresɪdentɪd/ adj. 前所未有的

来源优先级：
1. 课堂笔记中明确标注的生词
2. 录音中老师讲解的生词
3. 课堂材料中学生不认识的词

如果课堂笔记中的生词不足15个，必须从课堂材料（阅读文章、练习题等）中补充！

【长难句】（2-5句）
格式：
1. 原句
结构分析：[主干] + [修饰成分]
翻译：中文翻译

【错题】
格式：
1. 题目描述
错误选项：X
正确答案：Y
错因分析：具体分析为什么选错
改进建议：具体的解题策略`;

const REVIEW_SYSTEM_PROMPT = `你是一个复习文档生成助手。根据学情反馈生成复习文档。

【重要格式要求】
1. 不要使用任何markdown标记
2. 不要使用HTML代码
3. 输出纯文本格式
4. 生词顺序和数量必须与学情反馈中的【生词】部分完全一致！

【复习文档结构】

第一部分：生词复习
（按照学情反馈中【生词】的顺序，逐个展开）

1. 单词 /音标/ 词性. 中文释义
词根词缀：xxx（如有）
例句：xxx
同义词：xxx
反义词：xxx

第二部分：长难句复习
（按照学情反馈中【长难句】的内容）

1. 原句
结构分析：xxx
翻译：xxx
语法要点：xxx

第三部分：错题复习
（按照学情反馈中【错题】的内容）

1. 题目
错误选项及原因：xxx
正确答案及解析：xxx
同类题型注意点：xxx`;

const TEST_SYSTEM_PROMPT = `你是一个测试本生成助手。根据学情反馈生成测试本。

【重要格式要求】
1. 不要使用任何markdown标记
2. 不要使用HTML代码
3. 输出纯文本格式
4. 测试内容必须与学情反馈中的生词、长难句、错题一一对应！

【测试本结构】

===== 测试部分 =====

一、生词测试
（根据学情反馈中的【生词】出题，顺序可以打乱）

A. 英译中（10题）
1. contemplate
2. unprecedented
...

B. 中译英（10题）
1. 沉思；考虑
2. 前所未有的
...

二、长难句翻译
（根据学情反馈中的【长难句】出题）

请翻译以下句子：
1. [原句]
2. [原句]

三、错题重做
（根据学情反馈中的【错题】出题）

1. [题目描述]
A. xxx
B. xxx
C. xxx
D. xxx

===== 答案部分 =====

一、生词测试答案
A. 英译中
1. contemplate - 沉思；考虑
...

B. 中译英
1. 沉思；考虑 - contemplate
...

二、长难句翻译答案
1. [翻译]
...

三、错题答案
1. 正确答案：X
解析：xxx`;

const EXTRACTION_SYSTEM_PROMPT = `你是一个课后信息提取助手。从学情反馈中提取关键信息，生成助教用的作业管理档案。

【重要格式要求】
1. 不要使用任何markdown标记
2. 输出纯文本格式

【课后信息提取结构】

学生姓名：xxx
本次课日期：xxx
下次课日期：xxx

【作业布置】
1. 生词复习：复习本次课xxx个生词，下次课测试
2. 长难句练习：翻译xxx个长难句
3. 错题重做：重做本次课xxx道错题
4. 其他作业：xxx（如有）

【重点关注】
- 薄弱点：xxx
- 需要强化：xxx
- 家长沟通要点：xxx

【下次课计划】
- 复习内容：xxx
- 新授内容：xxx
- 测试安排：xxx`;

// ========== 辅助函数 ==========

/**
 * 录音转文字分段压缩
 * 如果录音转文字超过阈值，分段压缩后再合并
 */
async function compressTranscript(transcript: string, config?: APIConfig): Promise<string> {
  // 如果长度未超过阈值，直接返回
  if (transcript.length <= TRANSCRIPT_COMPRESS_CONFIG.maxLength) {
    console.log(`[录音压缩] 长度${transcript.length}字符，未超过阈值${TRANSCRIPT_COMPRESS_CONFIG.maxLength}，无需压缩`);
    return transcript;
  }

  console.log(`[录音压缩] 长度${transcript.length}字符，超过阈值，开始分段压缩...`);

  // 分段
  const chunks: string[] = [];
  const chunkSize = TRANSCRIPT_COMPRESS_CONFIG.chunkSize;
  
  for (let i = 0; i < transcript.length; i += chunkSize) {
    // 尽量在句子结束处分割
    let endIndex = Math.min(i + chunkSize, transcript.length);
    if (endIndex < transcript.length) {
      // 向后找句号、问号、叹号或换行符
      const searchEnd = Math.min(endIndex + 500, transcript.length);
      const searchText = transcript.slice(endIndex, searchEnd);
      const breakMatch = searchText.match(/[。？！。\n]/);
      if (breakMatch && breakMatch.index !== undefined) {
        endIndex = endIndex + breakMatch.index + 1;
      }
    }
    chunks.push(transcript.slice(i, endIndex));
    i = endIndex - chunkSize; // 调整下一段的起始位置
  }

  // 重新分段，确保没有重叠
  const finalChunks: string[] = [];
  let currentPos = 0;
  for (let i = 0; i < transcript.length; ) {
    let endIndex = Math.min(i + chunkSize, transcript.length);
    if (endIndex < transcript.length) {
      const searchEnd = Math.min(endIndex + 500, transcript.length);
      const searchText = transcript.slice(endIndex, searchEnd);
      const breakMatch = searchText.match(/[。？！\n]/);
      if (breakMatch && breakMatch.index !== undefined) {
        endIndex = endIndex + breakMatch.index + 1;
      }
    }
    finalChunks.push(transcript.slice(i, endIndex));
    i = endIndex;
  }

  console.log(`[录音压缩] 分为${finalChunks.length}段进行压缩`);

  // 压缩每段
  const compressedChunks: string[] = [];
  for (let i = 0; i < finalChunks.length; i++) {
    const chunk = finalChunks[i];
    console.log(`[录音压缩] 压缩第${i + 1}/${finalChunks.length}段 (原长${chunk.length}字符)...`);
    
    try {
      // 使用流式输出防止超时
      const compressed = await invokeWhatAIStream([
        { role: "system", content: `你是一个课堂录音压缩助手。请压缩以下课堂录音转文字内容，保留核心教学内容。

【压缩规则】
1. 保留所有生词讲解、词根词缀分析
2. 保留所有题目讲解、错题分析
3. 保留所有长难句分析
4. 保留学生表现评价和建议
5. 删除重复的导读词、口头禅、无关闲聊
6. 删除"嗯""啊""那个"等语气词
7. 压缩后长度应为原文的50%左右

直接输出压缩后的内容，不要添加任何解释。` },
        { role: "user", content: chunk },
      ], { max_tokens: 4000 }, config, (c) => process.stdout.write('.'));
      compressedChunks.push(compressed);
      console.log(`[录音压缩] 第${i + 1}段压缩完成: ${chunk.length} -> ${compressed.length}字符`);
    } catch (error) {
      console.error(`[录音压缩] 第${i + 1}段压缩失败，使用原文:`, error);
      compressedChunks.push(chunk);
    }
  }

  // 合并压缩后的段落
  const result = compressedChunks.join('\n\n');
  console.log(`[录音压缩] 全部压缩完成: ${transcript.length} -> ${result.length}字符 (压缩率${Math.round(result.length / transcript.length * 100)}%)`);
  
  return result;
}

/**
 * 清理markdown和HTML标记
 */
function cleanMarkdownAndHtml(text: string): string {
  return text
    // 移除markdown标题
    .replace(/^#{1,6}\s+/gm, '')
    // 移除粗体/斜体
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // 移除代码块
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    // 移除HTML标签
    .replace(/<[^>]+>/g, '')
    // 移除多余空行
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 文本转Word文档
 */
async function textToDocx(text: string, title: string): Promise<Buffer> {
  const cleanedText = cleanMarkdownAndHtml(text);
  const lines = cleanedText.split('\n');
  
  const children: Paragraph[] = [];
  
  // 添加标题
  children.push(
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, size: 32 })],
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    })
  );
  
  let inAnswerSection = false;
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // 检测答案分隔符
    if (trimmedLine.includes('===== 答案部分 =====') || trimmedLine.includes('答案部分')) {
      // 添加分页符
      children.push(
        new Paragraph({
          children: [new PageBreak()],
        })
      );
      children.push(
        new Paragraph({
          children: [new TextRun({ text: '答案部分', bold: true, size: 28 })],
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          spacing: { before: 200, after: 400 },
        })
      );
      inAnswerSection = true;
      continue;
    }
    
    // 检测章节标题（【xxx】格式）
    if (trimmedLine.match(/^【.+】$/)) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: trimmedLine, bold: true, size: 26 })],
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 300, after: 200 },
        })
      );
      continue;
    }
    
    // 检测小节标题（一、二、三等）
    if (trimmedLine.match(/^[一二三四五六七八九十]+、/)) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: trimmedLine, bold: true, size: 24 })],
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 150 },
        })
      );
      continue;
    }
    
    // 普通段落
    if (trimmedLine) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: trimmedLine, size: 22 })],
          spacing: { after: 100 },
        })
      );
    } else {
      // 空行
      children.push(
        new Paragraph({
          children: [new TextRun({ text: '' })],
          spacing: { after: 50 },
        })
      );
    }
  }
  
  const doc = new Document({
    sections: [{
      properties: {},
      children,
    }],
  });
  
  return await Packer.toBuffer(doc);
}

/**
 * 从反馈中提取问题和解决方案（使用AI和自定义路书）
 */
async function extractProblemsAndSolutions(feedback: string, config?: APIConfig): Promise<Array<{problem: [string, string], solution: [string, string]}>> {
  // 使用AI提取问题和方案
  const defaultPrompt = `你是一个气泡图内容提取助手。从学情反馈中提取问题和解决方案。

【提取规则】
1. 从「随堂测试」「作业批改」「表现及建议」中提取问题和方案
2. 提取3-6个问题，太多会罗列不下
3. 方案必须是反馈里写过的，不能自己编
4. 每个框里放两行字：主标题 + 副标题

【输出格式】
请输出严格的JSON数组，每个元素包含：
- problem: ["主标题", "副标题"]
- solution: ["主标题", "副标题"]

示例：
[
  {"problem": ["历史类文章", "生词障碍严重"], "solution": ["猜词练习针对", "历史/天文/艺术薄弱题材"]},
  {"problem": ["选非题", "未看全句子"], "solution": ["读到快记不住", "就去核对选项看全句子含义"]}
]

注意：主标题最多10个字，副标题最多15个字。只输出JSON，不要其他内容。`;

  // 如果有自定义路书，直接使用路书原文；否则使用默认提示词
  const systemPrompt = config?.roadmap && config.roadmap.trim()
    ? config.roadmap
    : defaultPrompt;

  try {
    // 使用流式输出防止超时
    console.log(`[气泡图] 开始流式提取问题和方案...`);
    const content = await invokeWhatAIStream([
      { role: "system", content: systemPrompt },
      { role: "user", content: `请从以下学情反馈中提取问题和解决方案：\n\n${feedback}` },
    ], { max_tokens: 2000 }, config, (c) => process.stdout.write('.'));
    console.log(`\n[气泡图] 提取完成`);
    // 提取JSON数组
    const jsonMatch = content.match(/\[([\s\S]*?)\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(`[${jsonMatch[1]}]`);
      return parsed.map((item: any) => ({
        problem: [item.problem?.[0] || "", item.problem?.[1] || ""],
        solution: [item.solution?.[0] || "", item.solution?.[1] || ""],
      }));
    }
  } catch (error) {
    console.error("提取问题和方案失败，使用备用方案:", error);
  }

  // 备用方案：简单的文本提取
  const suggestionsMatch = feedback.match(/【表现及建议】([\s\S]*?)(?=【|$)/);
  if (!suggestionsMatch) {
    return [];
  }
  
  const suggestions = suggestionsMatch[1];
  const results: Array<{problem: [string, string], solution: [string, string]}> = [];
  
  const paragraphs = suggestions.split(/\n\n+/).filter(p => p.trim());
  
  for (const para of paragraphs.slice(0, 4)) {
    const lines = para.trim().split('\n').filter(l => l.trim());
    if (lines.length >= 2) {
      const problemText = lines[0].replace(/^[\d.、]+/, '').trim();
      const solutionText = lines.slice(1).join(' ').replace(/^[\d.、]+/, '').trim();
      
      if (problemText && solutionText) {
        results.push({
          problem: [problemText.slice(0, 10), problemText.slice(10, 25) || ''],
          solution: [solutionText.slice(0, 10), solutionText.slice(10, 25) || ''],
        });
      }
    }
  }
  
  return results;
}

/**
 * 生成气泡图SVG
 */
function generateBubbleChartSVG(
  studentName: string,
  dateStr: string,
  lessonNumber: string,
  problemsAndSolutions: Array<{problem: [string, string], solution: [string, string]}>
): string {
  const width = 1200;
  const height = 800;
  const centerX = width / 2;
  const centerY = height / 2;
  
  // 颜色方案
  const colors = {
    problem: ['#FF6B6B', '#FF8E8E', '#FFB4B4', '#FFD4D4'],
    solution: ['#4ECDC4', '#6ED9D1', '#8EE5DE', '#AEF1EB'],
    center: '#FFE66D',
    text: '#2C3E50',
    line: '#95A5A6',
  };
  
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
    <defs>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="2" dy="2" stdDeviation="3" flood-opacity="0.3"/>
      </filter>
    </defs>
    <rect width="${width}" height="${height}" fill="#F8F9FA"/>
    
    <!-- 标题 -->
    <text x="${centerX}" y="50" text-anchor="middle" font-size="28" font-weight="bold" fill="${colors.text}">
      ${studentName} ${lessonNumber ? lessonNumber + ' ' : ''}${dateStr} 问题-方案对应图
    </text>
    
    <!-- 中心圆 -->
    <circle cx="${centerX}" cy="${centerY}" r="80" fill="${colors.center}" filter="url(#shadow)"/>
    <text x="${centerX}" y="${centerY - 10}" text-anchor="middle" font-size="20" font-weight="bold" fill="${colors.text}">本次课</text>
    <text x="${centerX}" y="${centerY + 15}" text-anchor="middle" font-size="16" fill="${colors.text}">核心问题</text>
  `;
  
  // 计算问题和解决方案的位置
  const problemCount = problemsAndSolutions.length;
  const angleStep = (2 * Math.PI) / problemCount;
  const problemRadius = 200;
  const solutionRadius = 350;
  
  problemsAndSolutions.forEach((item, index) => {
    const angle = -Math.PI / 2 + index * angleStep; // 从顶部开始
    
    // 问题气泡位置
    const px = centerX + problemRadius * Math.cos(angle);
    const py = centerY + problemRadius * Math.sin(angle);
    
    // 解决方案气泡位置
    const sx = centerX + solutionRadius * Math.cos(angle);
    const sy = centerY + solutionRadius * Math.sin(angle);
    
    // 连接线
    svg += `
      <line x1="${centerX}" y1="${centerY}" x2="${px}" y2="${py}" stroke="${colors.line}" stroke-width="2" stroke-dasharray="5,5"/>
      <line x1="${px}" y1="${py}" x2="${sx}" y2="${sy}" stroke="${colors.line}" stroke-width="2"/>
    `;
    
    // 问题气泡
    svg += `
      <ellipse cx="${px}" cy="${py}" rx="90" ry="50" fill="${colors.problem[index % 4]}" filter="url(#shadow)"/>
      <text x="${px}" y="${py - 8}" text-anchor="middle" font-size="14" fill="${colors.text}">${item.problem[0]}</text>
      <text x="${px}" y="${py + 12}" text-anchor="middle" font-size="12" fill="${colors.text}">${item.problem[1]}</text>
    `;
    
    // 解决方案气泡
    svg += `
      <ellipse cx="${sx}" cy="${sy}" rx="100" ry="55" fill="${colors.solution[index % 4]}" filter="url(#shadow)"/>
      <text x="${sx}" y="${sy - 8}" text-anchor="middle" font-size="14" fill="${colors.text}">${item.solution[0]}</text>
      <text x="${sx}" y="${sy + 12}" text-anchor="middle" font-size="12" fill="${colors.text}">${item.solution[1]}</text>
    `;
  });
  
  // 图例
  svg += `
    <rect x="50" y="${height - 80}" width="20" height="20" fill="${colors.problem[0]}" rx="5"/>
    <text x="80" y="${height - 65}" font-size="14" fill="${colors.text}">问题</text>
    
    <rect x="150" y="${height - 80}" width="20" height="20" fill="${colors.solution[0]}" rx="5"/>
    <text x="180" y="${height - 65}" font-size="14" fill="${colors.text}">解决方案</text>
  `;
  
  svg += '</svg>';
  return svg;
}

/**
 * SVG转PNG
 */
async function svgToPng(svgString: string): Promise<Buffer> {
  return await sharp(Buffer.from(svgString))
    .png()
    .toBuffer();
}

// ========== 导出的生成函数 ==========

/**
 * 步骤1: 生成学情反馈文档
 */
export async function generateFeedbackContent(input: FeedbackInput, config?: APIConfig): Promise<string> {
  // 先压缩录音转文字（如果超过阈值）
  const compressedTranscript = await compressTranscript(input.transcript, config);
  
  const prompt = `## 学生信息
- 学生姓名：${input.studentName}
- 课次：${input.lessonNumber || "未指定"}
${input.lessonDate ? `- 本次课日期：${input.lessonDate}` : "- 本次课日期：请从课堂笔记中提取"}
${input.nextLessonDate ? `- 下次课日期：${input.nextLessonDate}` : "- 下次课日期：请从课堂笔记中提取，如无则写待定"}
${input.isFirstLesson ? "- 这是新生首次课" : ""}
${input.specialRequirements ? `- 特殊要求：${input.specialRequirements}` : ""}

## 上次反馈
${input.isFirstLesson ? "（新生首次课，无上次反馈）" : (input.lastFeedback || "（未提供）")}

## 本次课笔记
${input.currentNotes}

## 录音转文字
${compressedTranscript}

请严格按照V9路书规范生成完整的学情反馈文档。
特别注意：
1. 不要使用任何markdown标记，输出纯文本
2. 【生词】部分必须达到15-25个，不足15个必须从课堂材料中补齐！
3. 请从课堂笔记中自动识别日期信息`;

  // 如果配置中有自定义路书，直接使用路书原文；否则使用默认的 FEEDBACK_SYSTEM_PROMPT
  const systemPrompt = config?.roadmap && config.roadmap.trim() 
    ? config.roadmap
    : FEEDBACK_SYSTEM_PROMPT;

  // 使用流式输出防止超时
  console.log(`[学情反馈] 开始流式生成...`);
  const content = await invokeWhatAIStream(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    { max_tokens: 16000 },
    config,
    (chunk) => {
      // 每收到一块内容就打印进度（防止超时）
      process.stdout.write('.');
    }
  );
  console.log(`\n[学情反馈] 流式生成完成，内容长度: ${content.length}字符`);
  
  return cleanMarkdownAndHtml(content);
}

/**
 * 步骤2: 生成复习文档（返回Buffer）
 */
export async function generateReviewContent(feedback: string, studentName: string, dateStr: string, config?: APIConfig): Promise<Buffer> {
  const prompt = `学生姓名：${studentName}

学情反馈内容：
${feedback}

请严格按照复习文档格式规范生成复习文档。
特别注意：
1. 不要使用markdown标记，输出纯文本
2. 生词顺序、数量必须和反馈里的【生词】部分完全一致！`;

  // 如果配置中有自定义路书，直接使用路书原文；否则使用默认的 REVIEW_SYSTEM_PROMPT
  const systemPrompt = config?.roadmap && config.roadmap.trim() 
    ? config.roadmap
    : REVIEW_SYSTEM_PROMPT;

  // 使用流式输出防止超时
  console.log(`[复习文档] 开始流式生成...`);
  const reviewContent = await invokeWhatAIStream(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    { max_tokens: 16000 },
    config,
    (chunk) => {
      process.stdout.write('.');
    }
  );
  console.log(`\n[复习文档] 流式生成完成，内容长度: ${reviewContent.length}字符`);
  
  return await textToDocx(reviewContent, `${studentName}${dateStr}复习文档`);
}

/**
 * 步骤3: 生成测试本（返回Buffer）
 */
export async function generateTestContent(feedback: string, studentName: string, dateStr: string, config?: APIConfig): Promise<Buffer> {
  const prompt = `学情反馈内容：
${feedback}

请严格按照测试本格式规范生成测试版本。
特别注意：
1. 不要使用markdown标记，输出纯文本
2. 不要使用HTML代码
3. 答案部分前面用"===== 答案部分 ====="分隔`;

  // 如果配置中有自定义路书，直接使用路书原文；否则使用默认的 TEST_SYSTEM_PROMPT
  const systemPrompt = config?.roadmap && config.roadmap.trim() 
    ? config.roadmap
    : TEST_SYSTEM_PROMPT;

  // 使用流式输出防止超时
  console.log(`[测试本] 开始流式生成...`);
  const testContent = await invokeWhatAIStream(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    { max_tokens: 16000 },
    config,
    (chunk) => {
      process.stdout.write('.');
    }
  );
  console.log(`\n[测试本] 流式生成完成，内容长度: ${testContent.length}字符`);
  
  return await textToDocx(testContent, `${studentName}${dateStr}测试本`);
}

/**
 * 步骤4: 生成课后信息提取
 */
export async function generateExtractionContent(studentName: string, nextLessonDate: string, feedback: string, config?: APIConfig): Promise<string> {
  const prompt = `学生姓名：${studentName}
下次课日期：${nextLessonDate || "请从学情反馈中提取，如无则写待定"}

学情反馈内容：
${feedback}

请严格按照课后信息提取格式规范生成作业管理档案。不要使用markdown标记。`;

  // 如果配置中有自定义路书，直接使用路书原文；否则使用默认的 EXTRACTION_SYSTEM_PROMPT
  const systemPrompt = config?.roadmap && config.roadmap.trim() 
    ? config.roadmap
    : EXTRACTION_SYSTEM_PROMPT;

  // 使用流式输出防止超时
  console.log(`[课后信息提取] 开始流式生成...`);
  const content = await invokeWhatAIStream(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    { max_tokens: 16000 },
    config,
    (chunk) => {
      process.stdout.write('.');
    }
  );
  console.log(`\n[课后信息提取] 流式生成完成，内容长度: ${content.length}字符`);
  
  return cleanMarkdownAndHtml(content);
}

/**
 * 步骤5: 生成气泡图（返回PNG Buffer）
 */
export async function generateBubbleChart(
  feedback: string,
  studentName: string,
  dateStr: string,
  lessonNumber: string,
  config?: APIConfig
): Promise<Buffer> {
  // 传递config给extractProblemsAndSolutions，以便使用自定义路书
  const problemsAndSolutions = await extractProblemsAndSolutions(feedback, config);
  const bubbleChartSVG = generateBubbleChartSVG(
    studentName,
    dateStr,
    lessonNumber,
    problemsAndSolutions.length > 0 ? problemsAndSolutions : [
      { problem: ["暂无问题", ""], solution: ["继续保持", ""] }
    ]
  );
  return await svgToPng(bubbleChartSVG);
}

/**
 * 旧版主函数（保留兼容性）：生成所有5个文档，带状态回调
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
  let review: Buffer = Buffer.from('');
  let test: Buffer = Buffer.from('');
  let extraction = '';
  let bubbleChart: Buffer = Buffer.from('');

  try {
    // 步骤1: 生成学情反馈
    updateStep(0, 'running', '正在生成学情反馈...');
    feedback = await generateFeedbackContent(input);
    updateStep(0, 'success', '学情反馈生成完成');

    // 步骤2: 生成复习文档
    updateStep(1, 'running', '正在生成复习文档...');
    const dateStr = input.lessonDate || new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }).replace('/', '月') + '日';
    review = await generateReviewContent(feedback, input.studentName, dateStr);
    updateStep(1, 'success', '复习文档生成完成');

    // 步骤3: 生成测试本
    updateStep(2, 'running', '正在生成测试本...');
    test = await generateTestContent(feedback, input.studentName, dateStr);
    updateStep(2, 'success', '测试本生成完成');

    // 步骤4: 生成课后信息提取
    updateStep(3, 'running', '正在生成课后信息提取...');
    extraction = await generateExtractionContent(input.studentName, input.nextLessonDate, feedback);
    updateStep(3, 'success', '课后信息提取生成完成');

    // 步骤5: 生成气泡图
    updateStep(4, 'running', '正在生成气泡图...');
    bubbleChart = await generateBubbleChart(feedback, input.studentName, dateStr, input.lessonNumber);
    updateStep(4, 'success', '气泡图生成完成');

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    const failedIndex = steps.findIndex(s => s.status === 'running');
    if (failedIndex >= 0) {
      updateStep(failedIndex, 'error', undefined, errorMessage);
    }
    throw error;
  }

  return {
    feedback,
    review,
    test,
    extraction,
    bubbleChart,
    steps,
  };
}
