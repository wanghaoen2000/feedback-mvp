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

// 小班课输入接口
export interface ClassFeedbackInput {
  classNumber: string;         // 班号
  lessonNumber: string;        // 课次
  lessonDate: string;          // 本次课日期
  nextLessonDate: string;      // 下次课日期
  attendanceStudents: string[]; // 出勤学生名单
  lastFeedback: string;        // 上次反馈
  currentNotes: string;        // 本次课笔记
  transcript: string;          // 录音转文字
  specialRequirements: string; // 特殊要求
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
 * 录音转文字压缩（一次性压缩，不分段）
 * 如果录音转文字超过阈值，使用流式输出一次性压缩
 */
async function compressTranscript(transcript: string, config?: APIConfig): Promise<string> {
  // 如果长度未超过阈值，直接返回
  if (transcript.length <= TRANSCRIPT_COMPRESS_CONFIG.maxLength) {
    console.log(`[录音压缩] 长度${transcript.length}字符，未超过阈值${TRANSCRIPT_COMPRESS_CONFIG.maxLength}，无需压缩`);
    return transcript;
  }

  console.log(`[录音压缩] 长度${transcript.length}字符，超过阈值，开始一次性压缩...`);

  try {
    // 使用流式输出一次性压缩整个录音
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

【重要】不要与用户互动，不要等待确认，不要询问任何问题。
不要输出任何前言、寒暄、自我描述或元评论（如"我将为您压缩..."、"好的，以下是..."等）。
不要在末尾添加总结、确认、说明或emoji标记。
直接输出压缩后的内容，第一行就是压缩内容本身，最后一行就是压缩内容的结尾。` },
      { role: "user", content: transcript },
    ], { max_tokens: 32000 }, config, (c) => process.stdout.write('.'));
    
    console.log(`\n[录音压缩] 压缩完成: ${transcript.length} -> ${compressed.length}字符 (压缩率${Math.round(compressed.length / transcript.length * 100)}%)`);
    return compressed;
  } catch (error) {
    console.error(`[录音压缩] 压缩失败，使用原文:`, error);
    return transcript;
  }
}

// 不要互动指令（程序强制约束，一对一+小班课共用）
const NO_INTERACTION_INSTRUCTION = `

【重要】不要与用户互动，不要等待确认，不要询问任何问题。
不要输出任何前言、寒暄、自我描述或元评论（如"我将为您生成..."、"好的，以下是..."、"我将直接为您生成..."等）。
不要在文档末尾添加总结、确认、说明或emoji标记（如"✅ 生成完成！"、"生成的文件：..."等）。
直接输出文档正文内容，第一行就是文档内容本身，最后一行就是文档内容的结尾。`;

/**
 * 清理markdown和HTML标记
 */
export function cleanMarkdownAndHtml(text: string): string {
  return text
    // 移除markdown标题
    .replace(/^#{1,6}\s+/gm, '')
    // 移除粗体/斜体
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // 移除代码块标记（保留内容）
    .replace(/```\w*\n?/g, '')
    .replace(/`([^`]+)`/g, '$1')
    // 移除HTML标签
    .replace(/<[^>]+>/g, '')
    // 移除多余空行
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 剔除 AI 常见的元评论：开头前言和结尾废话
 * 比如"我将直接为您生成..."、"✅ 生成完成！"、"生成的文件：..."等
 */
export function stripAIMetaCommentary(text: string): string {
  const lines = text.split('\n');

  // 从头部剔除 AI 前言（空行 + 常见开头模式）
  const preamblePatterns = [
    /^(好的|当然|没问题|可以|明白|收到|了解)[，。！,!.\s]/,
    /^我(将|来|会|现在|这就|马上)(直接|为您|帮您|给您|立即)/,
    /^(以下是|以下为|下面是|这是)(您的|为您|你的)?/,
    /^(根据您|按照您|基于您)/,
    /^(让我|请看|请查看)/,
  ];
  while (lines.length > 0) {
    const trimmed = lines[0].trim();
    if (trimmed === '') { lines.shift(); continue; }
    if (preamblePatterns.some(p => p.test(trimmed))) { lines.shift(); continue; }
    break;
  }

  // 从尾部剔除 AI 结语（空行 + 常见结尾模式）
  // 注意：【⚠️ 内容截断警告】是系统添加的截断标记，绝不能删除
  const epiloguePatterns = [
    /^[✅✓☑️📝📄🎉🎊]\s/,
    /^(生成完成|测试本生成完成|复习文档生成完成|课后信息提取完成)/,
    /^(生成的文件|已生成的文件|输出文件)[：:]/,
    /^[-•]\s+.+\.(docx|md|txt|pdf)/,
    /^(如果您|如果有|希望这|请查看|请检查|需要修改|如需)/,
    /^(以上是|以上就是|以上为)/,
    /^---+$/,
  ];
  while (lines.length > 0) {
    const trimmed = lines[lines.length - 1].trim();
    if (trimmed === '') { lines.pop(); continue; }
    if (trimmed.startsWith('【⚠️')) break; // 保留系统截断警告
    if (epiloguePatterns.some(p => p.test(trimmed))) { lines.pop(); continue; }
    break;
  }

  return lines.join('\n').trim();
}

/**
 * 文本转Word文档
 */
export async function textToDocx(text: string, title: string): Promise<Buffer> {
  const cleanedText = stripAIMetaCommentary(cleanMarkdownAndHtml(text));
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
 * 让AI直接按V9路书生成气泡图SVG代码
 */
async function generateBubbleChartSVGByAI(
  feedback: string,
  studentName: string,
  dateStr: string,
  lessonNumber: string,
  config?: APIConfig
): Promise<string> {
  // 如果有自定义路书，直接使用路书原文；否则使用默认提示词
  const systemPrompt = config?.roadmap && config.roadmap.trim()
    ? config.roadmap
    : `你是一个气泡图生成助手。请根据学情反馈生成气泡图SVG代码。`;

  const userPrompt = `请根据以下学情反馈生成气泡图SVG代码。

学生信息：
- 姓名：${studentName}
- 日期：${dateStr}
- 课次：${lessonNumber || '未指定'}

学情反馈内容：
${feedback}

请直接输出SVG代码，不要包含任何解释或markdown标记。SVG代码以<svg开头，以</svg>结尾。

【重要边界限制】
本次只需要生成气泡图SVG代码，不要生成学情反馈、复习文档、测试本或其他任何内容。
输出</svg>后立即停止，不要继续输出任何内容。${NO_INTERACTION_INSTRUCTION}`;

  try {
    console.log(`[气泡图] 开始流式生成SVG...`);
    const content = await invokeWhatAIStream([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ], { max_tokens: 8000 }, config, (c) => process.stdout.write('.'));
    console.log(`\n[气泡图] SVG生成完成`);
    
    // 提取SVG代码
    const svgMatch = content.match(/<svg[\s\S]*?<\/svg>/);
    if (svgMatch) {
      return svgMatch[0];
    }
    
    // 如果没有找到SVG标签，尝试返回整个内容（可能已经是纯SVG）
    if (content.trim().startsWith('<svg')) {
      return content.trim();
    }
    
    throw new Error('未找到有效的SVG代码');
  } catch (error) {
    console.error('[气泡图] AI生成失败，使用备用方案:', error);
    // 备用方案：生成一个简单的占位图
    return `<svg viewBox="0 0 900 700" xmlns="http://www.w3.org/2000/svg">
      <rect width="900" height="700" fill="#F8F9FA"/>
      <text x="450" y="350" text-anchor="middle" font-size="24" fill="#666">气泡图生成失败，请重试</text>
    </svg>`;
  }
}

/** 替换 SVG 中所有字体声明为中文字体，确保服务器端 Cairo/Pango 渲染正确 */
export function injectChineseFontIntoSVG(svgString: string): string {
  const CJK_FONT = '"WenQuanYi Zen Hei", "Noto Sans CJK SC", sans-serif';
  let result = svgString;
  // 1. 注入全局 CSS 样式（覆盖继承的字体）
  const fontStyle = `<style>text, tspan { font-family: ${CJK_FONT} !important; }</style>`;
  result = result.replace(/(<svg[^>]*>)/, `$1${fontStyle}`);
  // 2. 替换所有内联 font-family 属性（CSS !important 无法覆盖 SVG 属性）
  result = result.replace(/font-family="[^"]*"/g, `font-family=${CJK_FONT}`);
  result = result.replace(/font-family='[^']*'/g, `font-family=${CJK_FONT}`);
  // 3. 替换内联 style 中的 font-family
  result = result.replace(/font-family:\s*[^;"']+/g, `font-family: ${CJK_FONT}`);
  return result;
}

/**
 * SVG转PNG（注入中文字体确保服务器端渲染不乱码）
 */
async function svgToPng(svgString: string): Promise<Buffer> {
  const injected = injectChineseFontIntoSVG(svgString);
  return await sharp(Buffer.from(injected))
    .png()
    .toBuffer();
}

// ========== 导出的生成函数 ==========

/**
 * 步骤1: 生成学情反馈文档
 */
export async function generateFeedbackContent(input: FeedbackInput, config?: APIConfig): Promise<string> {
  // 直接使用录音原文，不再压缩
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
${input.transcript}

请严格按照V9路书规范生成完整的学情反馈文档。
特别注意：
1. 不要使用任何markdown标记，输出纯文本
2. 【生词】部分必须达到15-25个，不足15个必须从课堂材料中补齐！
3. 请从课堂笔记中自动识别日期信息

【重要边界限制】
本次只需要生成学情反馈文档，不要生成复习文档、测试本、课后信息提取或其他任何内容。
学情反馈文档以【OK】结束，输出【OK】后立即停止，不要继续输出任何内容。${NO_INTERACTION_INSTRUCTION}`;

  // 如果配置中有自定义路书，直接使用路书原文；否则使用默认的 FEEDBACK_SYSTEM_PROMPT
  const systemPrompt = config?.roadmap && config.roadmap.trim() 
    ? config.roadmap
    : FEEDBACK_SYSTEM_PROMPT;

  // 使用流式输出防止超时
  // 一对一反馈也使用较大的 max_tokens，防止长录音/复杂路书导致截断
  console.log(`[学情反馈] 开始流式生成...`);
  const content = await invokeWhatAIStream(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    { max_tokens: 64000 },
    config,
    (chunk) => {
      // 每收到一块内容就打印进度（防止超时）
      process.stdout.write('.');
    }
  );
  console.log(`\n[学情反馈] 流式生成完成，内容长度: ${content.length}字符`);

  if (content.includes('【⚠️ 内容截断警告】')) {
    console.error(`[学情反馈] ⚠️ 内容被截断！原始长度: ${content.length} 字符`);
  }

  return stripAIMetaCommentary(cleanMarkdownAndHtml(content));
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
2. 生词顺序、数量必须和反馈里的【生词】部分完全一致！

【重要边界限制】
本次只需要生成复习文档，不要生成学情反馈、测试本、课后信息提取或其他任何内容。
复习文档完成后立即停止，不要继续输出任何内容。${NO_INTERACTION_INSTRUCTION}`;

  // 如果配置中有自定义路书，直接使用路书原文；否则使用默认的 REVIEW_SYSTEM_PROMPT
  const systemPrompt = config?.roadmap && config.roadmap.trim() 
    ? config.roadmap
    : REVIEW_SYSTEM_PROMPT;

  // 使用流式输出防止超时
  // 复习文档也可能很长，使用与学情反馈相同的 max_tokens
  console.log(`[复习文档] 开始流式生成...`);
  const reviewContent = await invokeWhatAIStream(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    { max_tokens: 64000 },
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
export async function generateTestContent(
  feedback: string,
  studentName: string,
  dateStr: string,
  config?: APIConfig,
  onProgress?: (chars: number) => void
): Promise<Buffer> {
  const prompt = `学情反馈内容：
${feedback}

请严格按照测试本格式规范生成测试版本。
特别注意：
1. 不要使用markdown标记，输出纯文本
2. 不要使用HTML代码
3. 答案部分前面用"===== 答案部分 ====="分隔

【重要边界限制】
本次只需要生成测试本，不要生成学情反馈、复习文档、课后信息提取或其他任何内容。
测试本完成后立即停止，不要继续输出任何内容。${NO_INTERACTION_INSTRUCTION}`;

  // 如果配置中有自定义路书，直接使用路书原文；否则使用默认的 TEST_SYSTEM_PROMPT
  const systemPrompt = config?.roadmap && config.roadmap.trim()
    ? config.roadmap
    : TEST_SYSTEM_PROMPT;

  // 使用流式输出防止超时
  console.log(`[测试本] 开始流式生成...`);
  let charCount = 0;
  let lastProgressTime = Date.now();
  const testContent = await invokeWhatAIStream(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    { max_tokens: 32000 },
    config,
    (chunk: string) => {
      process.stdout.write('.');
      charCount += chunk.length;
      const now = Date.now();
      if (onProgress && now - lastProgressTime >= 1000) {
        onProgress(charCount);
        lastProgressTime = now;
      }
    }
  );
  console.log(`\n[测试本] 流式生成完成，内容长度: ${testContent.length}字符`);

  return await textToDocx(testContent, `${studentName}${dateStr}测试本`);
}

/**
 * 步骤4: 生成课后信息提取
 */
export async function generateExtractionContent(
  studentName: string,
  nextLessonDate: string,
  feedback: string,
  config?: APIConfig,
  onProgress?: (chars: number) => void
): Promise<string> {
  const prompt = `学生姓名：${studentName}
下次课日期：${nextLessonDate || "请从学情反馈中提取，如无则写待定"}

学情反馈内容：
${feedback}

请严格按照课后信息提取格式规范生成作业管理档案。不要使用markdown标记。

【重要边界限制】
本次只需要生成课后信息提取，不要生成学情反馈、复习文档、测试本或其他任何内容。
课后信息提取完成后立即停止，不要继续输出任何内容。${NO_INTERACTION_INSTRUCTION}`;

  // 如果配置中有自定义路书，直接使用路书原文；否则使用默认的 EXTRACTION_SYSTEM_PROMPT
  const systemPrompt = config?.roadmap && config.roadmap.trim()
    ? config.roadmap
    : EXTRACTION_SYSTEM_PROMPT;

  // 使用流式输出防止超时
  console.log(`[课后信息提取] 开始流式生成...`);
  let charCount = 0;
  let lastProgressTime = Date.now();
  const content = await invokeWhatAIStream(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    { max_tokens: 32000 },
    config,
    (chunk: string) => {
      process.stdout.write('.');
      charCount += chunk.length;
      const now = Date.now();
      if (onProgress && now - lastProgressTime >= 1000) {
        onProgress(charCount);
        lastProgressTime = now;
      }
    }
  );
  console.log(`\n[课后信息提取] 流式生成完成，内容长度: ${content.length}字符`);

  return stripAIMetaCommentary(cleanMarkdownAndHtml(content));
}

/**
 * 步骤5: 生成气泡图（返回PNG Buffer）- 已废弃，改用 generateBubbleChartSVG
 * @deprecated 使用 generateBubbleChartSVG 代替，前端生成PNG解决中文乱码问题
 */
export async function generateBubbleChart(
  feedback: string,
  studentName: string,
  dateStr: string,
  lessonNumber: string,
  config?: APIConfig
): Promise<Buffer> {
  // 让AI直接按V9路书生成SVG
  const bubbleChartSVG = await generateBubbleChartSVGByAI(
    feedback,
    studentName,
    dateStr,
    lessonNumber,
    config
  );
  return await svgToPng(bubbleChartSVG);
}

/**
 * 步骤5: 生成气泡图SVG（返回SVG字符串，前端转换为PNG）
 * 解决服务器缺少中文字体导致乱码的问题
 */
export async function generateBubbleChartSVG(
  feedback: string,
  studentName: string,
  dateStr: string,
  lessonNumber: string,
  config?: APIConfig
): Promise<string> {
  return await generateBubbleChartSVGByAI(
    feedback,
    studentName,
    dateStr,
    lessonNumber,
    config
  );
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


// ========== 小班课提示词 ==========
// 注意：小班课学情反馈不使用固定的 system prompt，而是透明转发用户配置的路书
const CLASS_FEEDBACK_SYSTEM_PROMPT = `你是一个学情反馈生成助手。请根据用户提供的路书和课堂信息生成学情反馈。

【重要格式要求】
这份反馈是给家长看的，要能直接复制到微信群，所以：
1. 不要使用任何markdown标记（不要用#、**、*、\`\`\`等）
2. 不要用表格格式
3. 不要用自动编号（手打1. 2. 3.）
4. 不要用首行缩进
5. 可以用中括号【】来标记章节
6. 可以用空行分隔段落
7. 直接输出纯文本
8. 最后以【OK】结尾`;

const CLASS_REVIEW_SYSTEM_PROMPT = `你是一个复习文档生成助手。为小班课生成复习文档。

【重要格式要求】
1. 不要使用任何markdown标记
2. 不要使用HTML代码
3. 输出纯文本格式

【复习文档结构】
班级：xxx班
日期：xxx
出勤学生：xxx

【本次课内容回顾】
1. 文章/题目：xxx
2. 核心知识点：xxx

【生词讲解】
（按照学情反馈中的生词逐一讲解）

【长难句分析】
（按照学情反馈中的长难句逐一分析）

【错题解析】
（按照学情反馈中的错题逐一解析）`;

const CLASS_TEST_SYSTEM_PROMPT = `你是一个测试本生成助手。为小班课生成测试本。

【重要格式要求】
1. 不要使用任何markdown标记
2. 不要使用HTML代码
3. 输出纯文本格式

【测试本结构】
班级：xxx班
日期：xxx

===== 测试部分 =====

一、生词测试
A. 英译中（10题）
B. 中译英（10题）

二、长难句翻译

三、错题重做

===== 答案部分 =====`;

const CLASS_EXTRACTION_SYSTEM_PROMPT = `你是一个课后信息提取助手。为小班课提取课后信息。

【重要格式要求】
1. 不要使用任何markdown标记
2. 输出纯文本格式

【课后信息提取结构】
班级：xxx班
本次课日期：xxx
下次课日期：xxx
出勤学生：xxx

【作业布置】
1. 生词复习：复习本次课xxx个生词
2. 长难句练习：翻译xxx个长难句
3. 错题重做：重做本次课xxx道错题

【各学生情况】
（简要记录每个学生的课堂表现和需要关注的点）`;

// ========== 小班课生成函数 ==========

/**
 * 生成小班课学情反馈（生成1份完整文件，包含全班共用部分+每个学生的单独部分）
 * 路书作为 system prompt，透明转发给AI
 */
export async function generateClassFeedbackContent(
  input: ClassFeedbackInput,
  roadmap: string,
  apiConfig: { apiModel: string; apiKey: string; apiUrl: string }
): Promise<string> {
  // 构建 user prompt，包含所有学生名单和课堂信息
  const studentList = input.attendanceStudents.filter(s => s.trim()).join('、');
  
  const userPrompt = `请为以下小班课生成完整的学情反馈：

班号：${input.classNumber}
课次：${input.lessonNumber || '未指定'}
本次课日期：${input.lessonDate || '未指定'}
出勤学生：${studentList}

${input.lastFeedback ? `【上次课反馈】\n${input.lastFeedback}\n` : ''}
【本次课笔记】
${input.currentNotes}

【录音转文字】
${input.transcript}

${input.specialRequirements ? `【特殊要求】\n${input.specialRequirements}\n` : ''}

【重要边界限制】
本次只需要生成学情反馈文档，不要生成复习文档、测试本、课后信息提取或其他任何内容。
学情反馈文档以【OK】结束，输出【OK】后立即停止，不要继续输出任何内容。${NO_INTERACTION_INSTRUCTION}`;

  console.log(`[小班课反馈] 开始为 ${input.classNumber} 班生成完整学情反馈...`);
  console.log(`[小班课反馈] 出勤学生: ${studentList}`);
  console.log(`[小班课反馈] 路书长度: ${roadmap?.length || 0} 字符`);
  
  // 路书作为 system prompt（和一对一一致）
  const systemPrompt = roadmap && roadmap.trim() ? roadmap : CLASS_FEEDBACK_SYSTEM_PROMPT;
  
  const config: APIConfig = {
    apiModel: apiConfig.apiModel,
    apiKey: apiConfig.apiKey,
    apiUrl: apiConfig.apiUrl,
  };
  
  // 小班课反馈内容较长（6人以上可能超过15000字），使用更大的 max_tokens
  const content = await invokeWhatAIStream(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    { max_tokens: 64000 },  // 小班课需要更大的输出限制
    config,
    () => process.stdout.write('.')
  );

  console.log(`\n[小班课反馈] 学情反馈生成完成，长度: ${content.length} 字符`);

  if (content.includes('【⚠️ 内容截断警告】')) {
    console.error(`[小班课反馈] ⚠️ 内容被截断！原始长度: ${content.length} 字符`);
  }

  return stripAIMetaCommentary(cleanMarkdownAndHtml(content));
}

/**
 * 生成小班课复习文档（全班共用一份）
 * 路书作为 system prompt，透明转发给AI
 */
export async function generateClassReviewContent(
  input: ClassFeedbackInput,
  combinedFeedback: string,
  roadmap: string,
  apiConfig: { apiModel: string; apiKey: string; apiUrl: string }
): Promise<Buffer> {
  const userPrompt = `请根据以下小班课信息生成复习文档：

班号：${input.classNumber}
课次：${input.lessonNumber || '未指定'}
本次课日期：${input.lessonDate || '未指定'}
出勤学生：${input.attendanceStudents.filter(s => s.trim()).join('、')}

【学情反馈汇总】
${combinedFeedback}

【本次课笔记】
${input.currentNotes}

【重要边界限制】
本次只需要生成复习文档，不要生成学情反馈、测试本、课后信息提取或其他任何内容。
复习文档完成后立即停止，不要继续输出任何内容。${NO_INTERACTION_INSTRUCTION}`;

  console.log(`[小班课复习文档] 开始生成...`);
  
  // 路书作为 system prompt（和一对一一致）
  const systemPrompt = roadmap && roadmap.trim() ? roadmap : CLASS_REVIEW_SYSTEM_PROMPT;
  
  const config: APIConfig = {
    apiModel: apiConfig.apiModel,
    apiKey: apiConfig.apiKey,
    apiUrl: apiConfig.apiUrl,
  };
  const reviewContent = await invokeWhatAIStream(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    { max_tokens: 8000 },
    config,
    () => process.stdout.write('.')
  );
  console.log(`\n[小班课复习文档] 生成完成`);

  // 清理 AI 元评论和 markdown 标记
  const cleanedReviewContent = stripAIMetaCommentary(cleanMarkdownAndHtml(reviewContent));

  // 转换为 docx
  const doc = new Document({
    sections: [{
      properties: {},
      children: cleanedReviewContent.split('\n').map((line: string) => {
        if (line.startsWith('【') && line.endsWith('】')) {
          return new Paragraph({
            children: [new TextRun({ text: line, bold: true, size: 28 })],
            spacing: { before: 400, after: 200 },
          });
        }
        return new Paragraph({
          children: [new TextRun({ text: line, size: 24 })],
          spacing: { after: 100 },
        });
      }),
    }],
  });
  
  return await Packer.toBuffer(doc);
}

/**
 * 生成小班课测试本（全班共用一份）
 * 路书作为 system prompt，透明转发给AI
 */
export async function generateClassTestContent(
  input: ClassFeedbackInput,
  combinedFeedback: string,
  roadmap: string,
  apiConfig: { apiModel: string; apiKey: string; apiUrl: string },
  onProgress?: (chars: number) => void
): Promise<Buffer> {
  const userPrompt = `请根据以下小班课信息生成测试本：

班号：${input.classNumber}
课次：${input.lessonNumber || '未指定'}
本次课日期：${input.lessonDate || '未指定'}

【学情反馈汇总】
${combinedFeedback}

【本次课笔记】
${input.currentNotes}

【重要边界限制】
本次只需要生成测试本，不要生成学情反馈、复习文档、课后信息提取或其他任何内容。
测试本完成后立即停止，不要继续输出任何内容。${NO_INTERACTION_INSTRUCTION}`;

  console.log(`[小班课测试本] 开始生成...`);
  
  // 路书作为 system prompt（和一对一一致）
  const systemPrompt = roadmap && roadmap.trim() ? roadmap : CLASS_TEST_SYSTEM_PROMPT;
  
  const config: APIConfig = {
    apiModel: apiConfig.apiModel,
    apiKey: apiConfig.apiKey,
    apiUrl: apiConfig.apiUrl,
  };

  let charCount = 0;
  let lastProgressTime = Date.now();
  const testContent = await invokeWhatAIStream(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    { max_tokens: 8000 },
    config,
    (chunk: string) => {
      process.stdout.write('.');
      charCount += chunk.length;
      // 每秒最多上报一次进度
      const now = Date.now();
      if (onProgress && now - lastProgressTime >= 1000) {
        onProgress(charCount);
        lastProgressTime = now;
      }
    }
  );
  console.log(`\n[小班课测试本] 生成完成`);

  // 清理 AI 元评论和 markdown 标记
  const cleanedTestContent = stripAIMetaCommentary(cleanMarkdownAndHtml(testContent));

  // 转换为 docx
  const doc = new Document({
    sections: [{
      properties: {},
      children: cleanedTestContent.split('\n').map((line: string) => {
        if (line.includes('=====')) {
          return new Paragraph({
            children: [new TextRun({ text: line, bold: true, size: 28 })],
            spacing: { before: 400, after: 200 },
            alignment: AlignmentType.CENTER,
          });
        }
        if (line.match(/^[一二三四五六七八九十]、/)) {
          return new Paragraph({
            children: [new TextRun({ text: line, bold: true, size: 26 })],
            spacing: { before: 300, after: 150 },
          });
        }
        return new Paragraph({
          children: [new TextRun({ text: line, size: 24 })],
          spacing: { after: 100 },
        });
      }),
    }],
  });
  
  return await Packer.toBuffer(doc);
}

/**
 * 生成小班课课后信息提取（全班共用一份）
 * 路书作为 system prompt，透明转发给AI
 */
export async function generateClassExtractionContent(
  input: ClassFeedbackInput,
  combinedFeedback: string,
  roadmap: string,
  apiConfig: { apiModel: string; apiKey: string; apiUrl: string },
  onProgress?: (chars: number) => void
): Promise<string> {
  const userPrompt = `请根据以下小班课信息提取课后信息：

班号：${input.classNumber}
课次：${input.lessonNumber || '未指定'}
本次课日期：${input.lessonDate || '未指定'}
下次课日期：${input.nextLessonDate || '未指定'}
出勤学生：${input.attendanceStudents.filter(s => s.trim()).join('、')}

【学情反馈汇总】
${combinedFeedback}

【重要边界限制】
本次只需要生成课后信息提取，不要生成学情反馈、复习文档、测试本或其他任何内容。
课后信息提取完成后立即停止，不要继续输出任何内容。${NO_INTERACTION_INSTRUCTION}`;

  console.log(`[小班课课后信息] 开始生成...`);
  
  // 路书作为 system prompt（和一对一一致）
  const systemPrompt = roadmap && roadmap.trim() ? roadmap : CLASS_EXTRACTION_SYSTEM_PROMPT;
  
  const config: APIConfig = {
    apiModel: apiConfig.apiModel,
    apiKey: apiConfig.apiKey,
    apiUrl: apiConfig.apiUrl,
  };

  let charCount = 0;
  let lastProgressTime = Date.now();
  const extractionContent = await invokeWhatAIStream(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    { max_tokens: 4000 },
    config,
    (chunk: string) => {
      process.stdout.write('.');
      charCount += chunk.length;
      // 每秒最多上报一次进度
      const now = Date.now();
      if (onProgress && now - lastProgressTime >= 1000) {
        onProgress(charCount);
        lastProgressTime = now;
      }
    }
  );
  console.log(`\n[小班课课后信息] 生成完成`);

  return stripAIMetaCommentary(cleanMarkdownAndHtml(extractionContent));
}

/**
 * 为小班课学生生成气泡图SVG
 * 使用路书透明转发，和一对一保持一致
 */
export async function generateClassBubbleChartSVG(
  combinedFeedback: string,
  studentName: string,
  classNumber: string,
  dateStr: string,
  lessonNumber: string,
  apiConfig: { apiModel: string; apiKey: string; apiUrl: string; roadmapClass?: string }
): Promise<string> {
  const config: APIConfig = {
    apiModel: apiConfig.apiModel,
    apiKey: apiConfig.apiKey,
    apiUrl: apiConfig.apiUrl,
    roadmap: apiConfig.roadmapClass, // 使用小班课路书
  };
  
  // 和一对一一样，直接调用 generateBubbleChartSVGByAI
  // 路书透明转发给AI，让AI按路书要求生成“问题-方案”格式的气泡图
  const userPrompt = `请为小班课学生生成气泡图SVG代码。

学生信息：
- 姓名：${studentName}
- 班号：${classNumber}
- 日期：${dateStr}
- 课次：${lessonNumber || '未指定'}

学情反馈内容（请从中提取该学生的【随堂测试】【作业批改】【表现及建议】部分）：
${combinedFeedback}

请直接输出SVG代码，不要包含任何解释或markdown标记。SVG代码以<svg开头，以</svg>结尾。

【重要边界限制】
本次只需要生成气泡图SVG代码，不要生成学情反馈、复习文档、测试本或其他任何内容。
输出</svg>后立即停止，不要继续输出任何内容。${NO_INTERACTION_INSTRUCTION}`;

  // 如果有自定义路书，直接使用路书原文；否则使用默认提示词
  const systemPrompt = config.roadmap && config.roadmap.trim()
    ? config.roadmap
    : `你是一个气泡图生成助手。请根据学情反馈生成气泡图SVG代码。`;

  try {
    console.log(`[小班课气泡图] 开始为 ${studentName} 生成SVG...`);
    const content = await invokeWhatAIStream([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ], { max_tokens: 8000 }, config, (c) => process.stdout.write('.'));
    console.log(`\n[小班课气泡图] ${studentName} SVG生成完成`);
    
    // 提取SVG代码
    const svgMatch = content.match(/<svg[\s\S]*?<\/svg>/);
    if (svgMatch) {
      return svgMatch[0];
    }
    
    if (content.trim().startsWith('<svg')) {
      return content.trim();
    }
    
    throw new Error('未找到有效的SVG代码');
  } catch (error) {
    console.error(`[小班课气泡图] ${studentName} 生成失败:`, error);
    return `<svg viewBox="0 0 900 700" xmlns="http://www.w3.org/2000/svg">
      <rect width="900" height="700" fill="#F8F9FA"/>
      <text x="450" y="350" text-anchor="middle" font-size="24" fill="#666">${studentName} 气泡图生成失败，请重试</text>
    </svg>`;
  }
}
