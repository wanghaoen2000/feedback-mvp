import { invokeWhatAI, invokeWhatAIStream, WhatAIMessage, MODELS, APIConfig } from "./whatai";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, PageBreak, AlignmentType } from "docx";
import { Resvg } from "@resvg/resvg-js";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";


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
 * 注意：保留下划线（___）用于填空题，不剥离 _text_ 和 __text__ 格式
 */
export function cleanMarkdownAndHtml(text: string): string {
  return text
    // 移除markdown标题
    .replace(/^#{1,6}\s+/gm, '')
    // 移除粗体/斜体（仅星号格式，保留下划线以免破坏填空题）
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    // 移除代码块标记（保留内容）
    .replace(/```\w*\n?/g, '')
    .replace(/`([^`]+)`/g, '$1')
    // 移除HTML标签
    .replace(/<[^>]+>/g, '')
    // 将纯空白行（只含空格/tab）变为真正的空行
    .replace(/^[ \t]+$/gm, '')
    // 移除多余空行（3+连续空行 → 2行）
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
    
    // 跳过纯装饰性分隔线（如 --- 或 ===）
    if (/^[-=]{3,}$/.test(trimmedLine)) {
      continue;
    }

    // 检测 ===== 测试部分 ===== 之类的段落标题（转为正式标题，不显示等号）
    if (trimmedLine.includes('=====') && !trimmedLine.includes('答案')) {
      const sectionName = trimmedLine.replace(/[=\s]/g, '');
      if (sectionName) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: sectionName, bold: true, size: 28 })],
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            spacing: { before: 200, after: 300 },
          })
        );
      }
      continue;
    }

    // 检测答案分隔符（AI 可能写成各种格式：===== 答案 =====、===== 答案部分 =====、答案部分 等）
    if (trimmedLine.includes('=====') && trimmedLine.includes('答案') ||
        /^[=\s]*答案[部分]*[=\s]*$/.test(trimmedLine) ||
        trimmedLine === '答案部分') {
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
    styles: {
      default: {
        document: {
          run: { font: { name: "微软雅黑", eastAsia: "微软雅黑" } },
        },
      },
    },
    sections: [{
      properties: {},
      children,
    }],
  });

  return await Packer.toBuffer(doc);
}

/** 替换 SVG 中所有字体声明为中文字体，确保服务器端 Cairo/Pango 渲染正确 */
export function injectChineseFontIntoSVG(svgString: string): string {
  // 优先使用 Noto Sans CJK SC（思源黑体），更美观专业；WenQuanYi 作为兜底
  const CJK_FONT_ATTR = 'Noto Sans CJK SC, WenQuanYi Zen Hei, sans-serif';
  const CJK_FONT_CSS = "'Noto Sans CJK SC', 'WenQuanYi Zen Hei', sans-serif";
  let result = svgString;
  // 0. 移除可能导致字体冲突的 @font-face 和 @import 规则（AI可能引用无法加载的web字体）
  result = result.replace(/@font-face\s*\{[^}]*\}/gi, '');
  result = result.replace(/@import\s+url\([^)]*\)[^;]*;?/gi, '');
  // 1. 替换 <style> 块中的 font-family（CSS中值以 ; 或 } 结尾，可以包含引号）
  result = result.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (_match, open, content, close) => {
    const fixed = content.replace(/font-family:\s*[^;}]+/g, `font-family: ${CJK_FONT_CSS}`);
    return open + fixed + close;
  });
  // 2. 替换所有内联 font-family 属性
  result = result.replace(/font-family="[^"]*"/g, `font-family="${CJK_FONT_ATTR}"`);
  result = result.replace(/font-family='[^']*'/g, `font-family='${CJK_FONT_ATTR}'`);
  // 3. 替换内联 style="..." 中的 font-family（属性值以 ; 或 " 结尾）
  result = result.replace(/style="([^"]*)"/g, (_match, styleContent) => {
    const fixed = styleContent.replace(/font-family:\s*[^;"]+/g, `font-family: ${CJK_FONT_CSS}`);
    return `style="${fixed}"`;
  });
  // 4. 注入全局 CSS 样式（最后注入，确保不会被上面的正则破坏）
  const fontStyle = `<style>text, tspan { font-family: ${CJK_FONT_CSS} !important; }</style>`;
  result = result.replace(/(<svg[^>]*>)/, `$1${fontStyle}`);
  return result;
}

/**
 * SVG转PNG（注入中文字体确保服务器端渲染不乱码）
 */
// ========== 字体发现与 SVG→PNG 渲染 ==========
// 服务器的 Node 进程可能在沙箱中，看不到 /usr/share/fonts。
// 用多种策略找字体，并提供详细诊断信息。

// 获取当前文件所在目录（ESM）
let __bundleDir = process.cwd();
try { __bundleDir = dirname(fileURLToPath(import.meta.url)); } catch {}

// 所有可能的字体文件位置
function getAllFontCandidates(): string[] {
  const cwd = process.cwd();
  const paths = [
    // 项目根目录 fonts/（优先：Noto Sans CJK 更美观）
    resolve(cwd, 'fonts', 'NotoSansCJK-Regular.ttc'),
    resolve(cwd, 'fonts', 'NotoSansCJK-Medium.ttc'),
    resolve(cwd, 'fonts', 'wqy-zenhei.ttc'),
    resolve(cwd, 'fonts', 'wqy-microhei.ttc'),
    // dist 同级 fonts/（esbuild 输出在 dist/index.js）
    resolve(__bundleDir, '..', 'fonts', 'NotoSansCJK-Regular.ttc'),
    resolve(__bundleDir, '..', 'fonts', 'wqy-zenhei.ttc'),
    resolve(__bundleDir, 'fonts', 'wqy-zenhei.ttc'),
    // 系统路径
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Medium.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
  ];
  // 去重
  return [...new Set(paths)];
}

function getAllFontDirs(): string[] {
  const cwd = process.cwd();
  const dirs = [
    resolve(cwd, 'fonts'),
    resolve(__bundleDir, '..', 'fonts'),
    resolve(__bundleDir, 'fonts'),
    '/usr/share/fonts',
    '/usr/share/fonts/opentype/noto',  // Noto CJK 在 opentype 目录
    '/usr/local/share/fonts',
  ];
  return [...new Set(dirs)];
}

// 全面诊断：收集环境信息（首次调用时运行）
export function diagnoseFontEnvironment(): string[] {
  const lines: string[] = [];
  lines.push(`--- 字体环境诊断 ---`);
  lines.push(`process.cwd(): ${process.cwd()}`);
  lines.push(`__bundleDir: ${__bundleDir}`);

  // 列出项目根目录内容
  const cwd = process.cwd();
  try {
    const entries = readdirSync(cwd);
    lines.push(`项目根目录文件(${entries.length}个): ${entries.slice(0, 30).join(', ')}${entries.length > 30 ? '...' : ''}`);
  } catch (e: any) { lines.push(`项目根目录读取失败: ${e?.message}`); }

  // 检查 fonts/ 目录
  const fontsDir = resolve(cwd, 'fonts');
  lines.push(`fonts/目录 ${fontsDir}: ${existsSync(fontsDir) ? '存在' : '不存在'}`);
  if (existsSync(fontsDir)) {
    try {
      const fontFiles = readdirSync(fontsDir);
      lines.push(`fonts/目录内容: ${fontFiles.join(', ') || '(空)'}`);
      // 检查每个文件大小
      for (const f of fontFiles) {
        try {
          const st = statSync(resolve(fontsDir, f));
          lines.push(`  ${f}: ${st.size} bytes, 可读: 是`);
        } catch (e: any) { lines.push(`  ${f}: 状态读取失败 ${e?.message}`); }
      }
    } catch (e: any) { lines.push(`fonts/目录内容读取失败: ${e?.message}`); }
  }

  // 逐一检查字体文件候选路径
  const candidates = getAllFontCandidates();
  lines.push(`\n字体文件候选路径(${candidates.length}个):`);
  for (const p of candidates) {
    const exists = existsSync(p);
    let detail = exists ? '存在' : '不存在';
    if (exists) {
      try {
        const st = statSync(p);
        detail += `, ${st.size} bytes`;
      } catch {}
    }
    lines.push(`  ${p}: ${detail}`);
  }

  // 检查字体目录
  const dirs = getAllFontDirs();
  lines.push(`\n字体扫描目录(${dirs.length}个):`);
  for (const d of dirs) {
    const exists = existsSync(d);
    let detail = exists ? '存在' : '不存在';
    if (exists) {
      try {
        const entries = readdirSync(d);
        detail += `, ${entries.length}个文件/子目录`;
      } catch {}
    }
    lines.push(`  ${d}: ${detail}`);
  }

  // 检查几个关键系统路径
  lines.push(`\n系统路径可访问性:`);
  for (const p of ['/usr', '/usr/share', '/usr/share/fonts', '/usr/share/fonts/truetype']) {
    lines.push(`  ${p}: ${existsSync(p) ? '可访问' : '不可访问'}`);
  }

  lines.push(`--- 诊断结束 ---`);
  return lines;
}

// 启动时查找一次，缓存结果
let _cachedFontFiles: string[] | null = null;
let _cachedFontDirs: string[] | null = null;
let _diagLines: string[] | null = null;
export function getResvgFontConfig() {
  if (_cachedFontFiles === null) {
    _diagLines = diagnoseFontEnvironment();
    _diagLines.forEach(l => console.log(`[字体] ${l}`));
    _cachedFontFiles = getAllFontCandidates().filter(f => existsSync(f));
    _cachedFontDirs = getAllFontDirs().filter(d => existsSync(d));
    console.log(`[字体] 最终: ${_cachedFontFiles.length}个字体文件, ${_cachedFontDirs.length}个扫描目录`);
  }
  return {
    fontFiles: _cachedFontFiles,
    fontDirs: _cachedFontDirs!,
    diagLines: _diagLines || [],
  };
}

export async function svgToPng(svgString: string): Promise<Buffer> {
  const injected = injectChineseFontIntoSVG(svgString);
  const { fontFiles, fontDirs } = getResvgFontConfig();
  const resvg = new Resvg(injected, {
    font: {
      loadSystemFonts: true,
      fontFiles,
      fontDirs,
      defaultFontFamily: 'Noto Sans CJK SC',
    },
  });
  const pngData = resvg.render();
  return Buffer.from(pngData.asPng());
}

// ========== 截断自动续写 ==========

const TRUNCATION_MARKER = '【⚠️ 内容截断警告】';
const MAX_CONTINUATIONS = 3; // 最多续写3次（共4轮），约可产出 24000+ 字符

/** 生成元信息，用于前端展示诊断数据 */
export interface GenerationMeta {
  mode: 'non-stream' | 'stream';       // 调用模式
  rounds: number;                       // 总轮次
  totalPromptTokens: number;            // 输入token总数
  totalCompletionTokens: number;        // 输出token总数
  finishReason: string;                 // 最终finish_reason
  roundDetails: Array<{ chars: number; promptTokens: number; completionTokens: number; finishReason: string }>;
}

/**
 * 非流式带自动续写的AI调用（用于后台任务）
 *
 * 关键区别：不带 stream:true 参数。
 * 某些API代理（如DMXapi）对流式输出有独立的token上限（约8192），
 * 但非流式可能允许更大的输出。后台任务不需要实时流式进度，
 * 所以优先用非流式，配合续写做兜底。
 *
 * 返回 { content, meta } — meta 包含 token 用量、轮次等诊断信息
 */
async function invokeNonStreamWithContinuation(
  systemPrompt: string,
  userPrompt: string,
  config?: APIConfig,
  label: string = '反馈'
): Promise<{ content: string; meta: GenerationMeta }> {
  let fullContent = '';
  let messages: WhatAIMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const meta: GenerationMeta = {
    mode: 'non-stream',
    rounds: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    finishReason: '',
    roundDetails: [],
  };

  for (let round = 0; round <= MAX_CONTINUATIONS; round++) {
    console.log(`[${label}] ${round === 0 ? '开始非流式生成...' : `第${round}次续写（已累计${fullContent.length}字符）...`}`);

    const response = await invokeWhatAI(
      messages,
      { max_tokens: 64000, timeout: 600000, retries: 1 },
      config,
    );

    const content = response.choices?.[0]?.message?.content || '';
    const finishReason = response.choices?.[0]?.finish_reason || 'unknown';
    const usage = response.usage;
    const pt = usage?.prompt_tokens || 0;
    const ct = usage?.completion_tokens || 0;

    console.log(`[${label}] 第${round + 1}轮完成，本轮${content.length}字符, finish_reason: ${finishReason}`);
    if (usage) {
      console.log(`[${label}] Token用量: 输入=${pt}, 输出=${ct}, 总计=${usage.total_tokens}`);
    }

    meta.rounds = round + 1;
    meta.totalPromptTokens += pt;
    meta.totalCompletionTokens += ct;
    meta.finishReason = finishReason;
    meta.roundDetails.push({ chars: content.length, promptTokens: pt, completionTokens: ct, finishReason });

    if (finishReason === 'length' || finishReason === 'max_tokens') {
      // 被截断，累积内容并续写
      fullContent += content;
      if (round < MAX_CONTINUATIONS) {
        console.log(`[${label}] 截断检测到，已累计${fullContent.length}字符，自动续写...`);
        messages = [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
          { role: "assistant", content: fullContent },
          { role: "user", content: "你的回答被截断了，请从截断处继续输出。直接继续输出剩余内容，不要重复已有内容，不要添加过渡语句。" },
        ];
      } else {
        console.error(`[${label}] 已达到最大续写次数(${MAX_CONTINUATIONS})，当前${fullContent.length}字符`);
      }
    } else {
      // 正常完成（finish_reason === 'stop' 等）
      fullContent += content;
      if (round > 0) {
        console.log(`[${label}] 续写完成，共${round + 1}轮，总长度: ${fullContent.length}字符`);
      }
      break;
    }
  }

  return { content: fullContent, meta };
}

/**
 * 带自动续写的流式AI调用
 * 当API输出被截断时（DMXapi可能限制单次输出token数），
 * 自动将已有内容作为assistant消息发回，请求AI继续输出，
 * 循环拼接直到完整或达到最大续写次数。
 * @param signal 外部取消信号（SSE客户端断连时中止）
 */
export async function invokeWithContinuation(
  systemPrompt: string,
  userPrompt: string,
  config?: APIConfig,
  onChunk?: (chunk: string) => void,
  label: string = '反馈',
  signal?: AbortSignal
): Promise<string> {
  let fullContent = '';
  let messages: WhatAIMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  for (let round = 0; round <= MAX_CONTINUATIONS; round++) {
    // 检查外部取消
    if (signal?.aborted) {
      throw new Error('生成已取消（客户端断开）');
    }

    console.log(`[${label}] ${round === 0 ? '开始流式生成...' : `第${round}次续写（已累计${fullContent.length}字符）...`}`);

    const chunk = await invokeWhatAIStream(
      messages,
      { max_tokens: 64000, signal },
      config,
      onChunk
    );

    // 检查是否包含截断标记
    const markerIdx = chunk.indexOf(TRUNCATION_MARKER);
    if (markerIdx >= 0) {
      // 去掉截断标记，保留有效内容
      const cleanChunk = chunk.substring(0, markerIdx).trimEnd();
      fullContent += cleanChunk;

      if (round < MAX_CONTINUATIONS) {
        console.log(`[${label}] 第${round + 1}次截断检测到，已累计${fullContent.length}字符，自动续写...`);
        // 将完整已生成内容作为assistant回复，追加续写指令
        messages = [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
          { role: "assistant", content: fullContent },
          { role: "user", content: "你的回答被截断了，请从截断处继续输出。直接继续输出剩余内容，不要重复已有内容，不要添加过渡语句。" },
        ];
      } else {
        console.error(`[${label}] 已达到最大续写次数(${MAX_CONTINUATIONS})，内容可能不完整，当前${fullContent.length}字符`);
      }
    } else {
      // 无截断，正常完成
      fullContent += chunk;
      if (round > 0) {
        console.log(`[${label}] 续写完成，共${round + 1}轮，总长度: ${fullContent.length}字符`);
      }
      break;
    }
  }

  return fullContent;
}

// ========== 统一生成函数（一对一 + 小班课共用） ==========

export type CourseType = 'oneToOne' | 'class';

/** 根据步骤和课程类型选择默认系统提示词 */
function getDefaultPrompt(step: 'feedback' | 'review' | 'test' | 'extraction', courseType: CourseType): string {
  const map = {
    feedback: { oneToOne: FEEDBACK_SYSTEM_PROMPT, class: CLASS_FEEDBACK_SYSTEM_PROMPT },
    review:   { oneToOne: REVIEW_SYSTEM_PROMPT,   class: CLASS_REVIEW_SYSTEM_PROMPT },
    test:     { oneToOne: TEST_SYSTEM_PROMPT,      class: CLASS_TEST_SYSTEM_PROMPT },
    extraction: { oneToOne: EXTRACTION_SYSTEM_PROMPT, class: CLASS_EXTRACTION_SYSTEM_PROMPT },
  };
  return map[step][courseType];
}

/** 优先用自定义路书，否则用默认提示词 */
function selectSystemPrompt(step: 'feedback' | 'review' | 'test' | 'extraction', courseType: CourseType, roadmap?: string): string {
  return roadmap?.trim() ? roadmap : getDefaultPrompt(step, courseType);
}

// ========== 导出的生成函数（一对一 + 小班课统一） ==========

/**
 * 步骤1: 生成学情反馈（一对一 + 小班课统一）
 * 
 * 两种模式都使用非流式+自动续写，避免流式输出被 API 代理截断。
 * 提示词按 courseType 分支构建，AI 调用和后处理完全共享。
 */
export async function generateFeedbackContent(
  courseType: CourseType,
  input: FeedbackInput | ClassFeedbackInput,
  config?: APIConfig
): Promise<{ content: string; rawContent?: string; meta: GenerationMeta }> {
  let prompt: string;
  let label: string;

  if (courseType === 'oneToOne') {
    const d = input as FeedbackInput;
    label = '学情反馈';
    prompt = `## 学生信息
- 学生姓名：${d.studentName}
- 课次：${d.lessonNumber || "未指定"}
${d.lessonDate ? `- 本次课日期：${d.lessonDate}` : "- 本次课日期：请从课堂笔记中提取"}
${d.nextLessonDate ? `- 下次课日期：${d.nextLessonDate}` : "- 下次课日期：请从课堂笔记中提取，如无则写待定"}
${d.isFirstLesson ? "- 这是新生首次课" : ""}
${d.specialRequirements ? `- 特殊要求：${d.specialRequirements}` : ""}

## 上次反馈
${d.isFirstLesson ? "（新生首次课，无上次反馈）" : (d.lastFeedback || "（未提供）")}

## 本次课笔记
${d.currentNotes}

## 录音转文字
${d.transcript}

请严格按照V9路书规范生成完整的学情反馈文档。
特别注意：
1. 不要使用任何markdown标记，输出纯文本
2. 【生词】部分必须达到15-25个，不足15个必须从课堂材料中补齐！
3. 请从课堂笔记中自动识别日期信息

【重要边界限制】
本次只需要生成学情反馈文档，不要生成复习文档、测试本、课后信息提取或其他任何内容。
学情反馈文档以【OK】结束，输出【OK】后立即停止，不要继续输出任何内容。${NO_INTERACTION_INSTRUCTION}`;
  } else {
    const d = input as ClassFeedbackInput;
    const studentList = d.attendanceStudents.filter(s => s.trim()).join('、');
    label = '小班课反馈';
    console.log(`[${label}] 出勤学生: ${studentList}`);
    prompt = `请为以下小班课生成完整的学情反馈：

班号：${d.classNumber}
课次：${d.lessonNumber || '未指定'}
本次课日期：${d.lessonDate || '未指定'}
出勤学生：${studentList}

${d.lastFeedback ? `【上次课反馈】\n${d.lastFeedback}\n` : ''}
【本次课笔记】
${d.currentNotes}

【录音转文字】
${d.transcript}

${d.specialRequirements ? `【特殊要求】\n${d.specialRequirements}\n` : ''}

【重要边界限制】
本次只需要生成学情反馈文档，不要生成复习文档、测试本、课后信息提取或其他任何内容。
学情反馈文档以【OK】结束，输出【OK】后立即停止，不要继续输出任何内容。${NO_INTERACTION_INSTRUCTION}`;
  }

  const systemPrompt = selectSystemPrompt('feedback', courseType, config?.roadmap);
  if (courseType === 'class') {
    console.log(`[${label}] 路书长度: ${config?.roadmap?.length || 0} 字符`);
  }

  const result = await invokeNonStreamWithContinuation(systemPrompt, prompt, config, label);
  console.log(`[${label}] 生成完成，内容长度: ${result.content.length}字符`);

  const rawContent = result.content;
  const cleaned = stripAIMetaCommentary(cleanMarkdownAndHtml(rawContent));
  return { content: cleaned, rawContent, meta: result.meta };
}

/**
 * 步骤2: 生成复习文档（一对一 + 小班课统一，返回 docx Buffer）
 * 
 * 改进：小班课现在也使用共享的 textToDocx()，获得页眉分页、装饰标记处理等能力。
 * 1对1从流式改为非流式+自动续写，避免 API 代理截断。
 */
export async function generateReviewContent(
  courseType: CourseType,
  input: FeedbackInput | ClassFeedbackInput,
  feedback: string,
  dateStr: string,
  config?: APIConfig
): Promise<Buffer> {
  let prompt: string;
  let label: string;
  let docxTitle: string;

  if (courseType === 'oneToOne') {
    const d = input as FeedbackInput;
    label = '复习文档';
    docxTitle = `${d.studentName}${dateStr}复习文档`;
    prompt = `学生姓名：${d.studentName}

学情反馈内容：
${feedback}

请严格按照复习文档格式规范生成复习文档。
特别注意：
1. 不要使用markdown标记，输出纯文本
2. 生词顺序、数量必须和反馈里的【生词】部分完全一致！

【重要边界限制】
本次只需要生成复习文档，不要生成学情反馈、测试本、课后信息提取或其他任何内容。
复习文档完成后立即停止，不要继续输出任何内容。${NO_INTERACTION_INSTRUCTION}`;
  } else {
    const d = input as ClassFeedbackInput;
    label = '小班课复习文档';
    docxTitle = `${d.classNumber}班${dateStr}复习文档`;
    prompt = `请根据以下小班课信息生成复习文档：

班号：${d.classNumber}
课次：${d.lessonNumber || '未指定'}
本次课日期：${d.lessonDate || '未指定'}
出勤学生：${d.attendanceStudents.filter(s => s.trim()).join('、')}

【学情反馈汇总】
${feedback}

【本次课笔记】
${d.currentNotes}

【重要边界限制】
本次只需要生成复习文档，不要生成学情反馈、测试本、课后信息提取或其他任何内容。
复习文档完成后立即停止，不要继续输出任何内容。${NO_INTERACTION_INSTRUCTION}`;
  }

  const systemPrompt = selectSystemPrompt('review', courseType, config?.roadmap);

  console.log(`[${label}] 开始非流式生成...`);
  const result = await invokeNonStreamWithContinuation(systemPrompt, prompt, config, label);
  console.log(`[${label}] 生成完成，内容长度: ${result.content.length}字符`);

  return await textToDocx(result.content, docxTitle);
}

/**
 * 步骤3: 生成测试本（一对一 + 小班课统一，返回 docx Buffer）
 * 
 * 改进：小班课现在也使用共享的 textToDocx()，获得分页符、装饰标记处理等能力。
 */
export async function generateTestContent(
  courseType: CourseType,
  input: FeedbackInput | ClassFeedbackInput,
  feedback: string,
  dateStr: string,
  config?: APIConfig
): Promise<Buffer> {
  let prompt: string;
  let label: string;
  let docxTitle: string;

  if (courseType === 'oneToOne') {
    const d = input as FeedbackInput;
    label = '测试本';
    docxTitle = `${d.studentName}${dateStr}测试本`;
    prompt = `学情反馈内容：
${feedback}

请严格按照测试本格式规范生成测试版本。
特别注意：
1. 不要使用markdown标记，输出纯文本
2. 不要使用HTML代码
3. 答案部分前面用"===== 答案部分 ====="分隔

【重要边界限制】
本次只需要生成测试本，不要生成学情反馈、复习文档、课后信息提取或其他任何内容。
测试本完成后立即停止，不要继续输出任何内容。${NO_INTERACTION_INSTRUCTION}`;
  } else {
    const d = input as ClassFeedbackInput;
    label = '小班课测试本';
    docxTitle = `${d.classNumber}班${dateStr}测试本`;
    prompt = `请根据以下小班课信息生成测试本：

班号：${d.classNumber}
课次：${d.lessonNumber || '未指定'}
本次课日期：${d.lessonDate || '未指定'}

【学情反馈汇总】
${feedback}

【本次课笔记】
${d.currentNotes}

【重要边界限制】
本次只需要生成测试本，不要生成学情反馈、复习文档、课后信息提取或其他任何内容。
测试本完成后立即停止，不要继续输出任何内容。${NO_INTERACTION_INSTRUCTION}`;
  }

  const systemPrompt = selectSystemPrompt('test', courseType, config?.roadmap);

  console.log(`[${label}] 开始非流式生成...`);
  const result = await invokeNonStreamWithContinuation(systemPrompt, prompt, config, label);
  console.log(`[${label}] 生成完成，内容长度: ${result.content.length}字符`);

  return await textToDocx(result.content, docxTitle);
}

/**
 * 步骤4: 课后信息提取（一对一 + 小班课统一，返回 markdown string）
 */
export async function generateExtractionContent(
  courseType: CourseType,
  input: FeedbackInput | ClassFeedbackInput,
  feedback: string,
  config?: APIConfig
): Promise<string> {
  let prompt: string;
  let label: string;

  if (courseType === 'oneToOne') {
    const d = input as FeedbackInput;
    label = '课后信息提取';
    prompt = `学生姓名：${d.studentName}
下次课日期：${d.nextLessonDate || "请从学情反馈中提取，如无则写待定"}

学情反馈内容：
${feedback}

请严格按照课后信息提取格式规范生成作业管理档案。不要使用markdown标记。

【重要边界限制】
本次只需要生成课后信息提取，不要生成学情反馈、复习文档、测试本或其他任何内容。
课后信息提取完成后立即停止，不要继续输出任何内容。${NO_INTERACTION_INSTRUCTION}`;
  } else {
    const d = input as ClassFeedbackInput;
    label = '小班课课后信息';
    prompt = `请根据以下小班课信息提取课后信息：

班号：${d.classNumber}
课次：${d.lessonNumber || '未指定'}
本次课日期：${d.lessonDate || '未指定'}
下次课日期：${d.nextLessonDate || '未指定'}
出勤学生：${d.attendanceStudents.filter(s => s.trim()).join('、')}

【学情反馈汇总】
${feedback}

【重要边界限制】
本次只需要生成课后信息提取，不要生成学情反馈、复习文档、测试本或其他任何内容。
课后信息提取完成后立即停止，不要继续输出任何内容。${NO_INTERACTION_INSTRUCTION}`;
  }

  const systemPrompt = selectSystemPrompt('extraction', courseType, config?.roadmap);

  console.log(`[${label}] 开始非流式生成...`);
  const result = await invokeNonStreamWithContinuation(systemPrompt, prompt, config, label);
  console.log(`[${label}] 生成完成，内容长度: ${result.content.length}字符`);

  return stripAIMetaCommentary(cleanMarkdownAndHtml(result.content));
}

/**
 * 步骤5: 生成气泡图 SVG（一对一 + 小班课统一）
 * 
 * 小班课模式需要额外传 classNumber。
 * 两种模式都用非流式调用，8k token 限制。
 */
export async function generateBubbleChartSVG(
  courseType: CourseType,
  feedback: string,
  studentName: string,
  dateStr: string,
  lessonNumber: string,
  config?: APIConfig,
  classNumber?: string
): Promise<string> {
  let userPrompt: string;
  let label: string;

  if (courseType === 'oneToOne') {
    label = '气泡图';
    userPrompt = `请根据以下学情反馈生成气泡图SVG代码。

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
  } else {
    label = `小班课气泡图-${studentName}`;
    userPrompt = `请为小班课学生生成气泡图SVG代码。

学生信息：
- 姓名：${studentName}
- 班号：${classNumber}
- 日期：${dateStr}
- 课次：${lessonNumber || '未指定'}

学情反馈内容（请从中提取该学生的【随堂测试】【作业批改】【表现及建议】部分）：
${feedback}

请直接输出SVG代码，不要包含任何解释或markdown标记。SVG代码以<svg开头，以</svg>结尾。

【重要边界限制】
本次只需要生成气泡图SVG代码，不要生成学情反馈、复习文档、测试本或其他任何内容。
输出</svg>后立即停止，不要继续输出任何内容。${NO_INTERACTION_INSTRUCTION}`;
  }

  const systemPrompt = config?.roadmap?.trim()
    ? config.roadmap
    : `你是一个气泡图生成助手。请根据学情反馈生成气泡图SVG代码。`;

  try {
    console.log(`[${label}] 开始非流式生成SVG...`);
    const response = await invokeWhatAI([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ], { max_tokens: 8000, timeout: 300000, retries: 1 }, config);
    const content = response.choices?.[0]?.message?.content || '';
    console.log(`[${label}] SVG生成完成，长度: ${content.length}字符`);

    const svgMatch = content.match(/<svg[\s\S]*?<\/svg>/);
    if (svgMatch) return svgMatch[0];
    if (content.trim().startsWith('<svg')) return content.trim();
    throw new Error('未找到有效的SVG代码');
  } catch (error) {
    console.error(`[${label}] 生成失败:`, error);
    return `<svg viewBox="0 0 900 700" xmlns="http://www.w3.org/2000/svg">
      <rect width="900" height="700" fill="#F8F9FA"/>
      <text x="450" y="350" text-anchor="middle" font-size="24" fill="#666">${studentName} 气泡图生成失败，请重试</text>
    </svg>`;
  }
}

/**
 * 步骤5 (deprecated): 生成气泡图 PNG Buffer
 * @deprecated 使用 generateBubbleChartSVG 代替
 */
export async function generateBubbleChart(
  feedback: string,
  studentName: string,
  dateStr: string,
  lessonNumber: string,
  config?: APIConfig
): Promise<Buffer> {
  const svg = await generateBubbleChartSVG('oneToOne', feedback, studentName, dateStr, lessonNumber, config);
  return await svgToPng(svg);
}

// ========== 向后兼容包装器（旧接口 → 统一函数） ==========
// 这些包装器保持旧的函数签名不变，内部委托给统一函数。
// 已有的调用方可以逐步迁移到新接口，迁移完成后可删除。

/** @deprecated 使用 generateFeedbackContent('class', ...) */
export async function generateClassFeedbackContent(
  input: ClassFeedbackInput,
  roadmap: string,
  apiConfig: { apiModel: string; apiKey: string; apiUrl: string }
): Promise<{ content: string; rawContent?: string; meta: GenerationMeta }> {
  return generateFeedbackContent('class', input, { ...apiConfig, roadmap });
}

/** @deprecated 使用 generateReviewContent('class', ...) */
export async function generateClassReviewContent(
  input: ClassFeedbackInput,
  combinedFeedback: string,
  roadmap: string,
  apiConfig: { apiModel: string; apiKey: string; apiUrl: string }
): Promise<Buffer> {
  const dateStr = input.lessonDate || '';
  return generateReviewContent('class', input, combinedFeedback, dateStr, { ...apiConfig, roadmap });
}

/** @deprecated 使用 generateTestContent('class', ...) */
export async function generateClassTestContent(
  input: ClassFeedbackInput,
  combinedFeedback: string,
  roadmap: string,
  apiConfig: { apiModel: string; apiKey: string; apiUrl: string }
): Promise<Buffer> {
  const dateStr = input.lessonDate || '';
  return generateTestContent('class', input, combinedFeedback, dateStr, { ...apiConfig, roadmap });
}

/** @deprecated 使用 generateExtractionContent('class', ...) */
export async function generateClassExtractionContent(
  input: ClassFeedbackInput,
  combinedFeedback: string,
  roadmap: string,
  apiConfig: { apiModel: string; apiKey: string; apiUrl: string }
): Promise<string> {
  return generateExtractionContent('class', input, combinedFeedback, { ...apiConfig, roadmap });
}

/** @deprecated 使用 generateBubbleChartSVG('class', ...) */
export async function generateClassBubbleChartSVG(
  combinedFeedback: string,
  studentName: string,
  classNumber: string,
  dateStr: string,
  lessonNumber: string,
  apiConfig: { apiModel: string; apiKey: string; apiUrl: string; roadmapClass?: string }
): Promise<string> {
  return generateBubbleChartSVG('class', combinedFeedback, studentName, dateStr, lessonNumber,
    { ...apiConfig, roadmap: apiConfig.roadmapClass }, classNumber);
}

// ========== 旧版主函数（保留兼容性） ==========

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
    updateStep(0, 'running', '正在生成学情反馈...');
    const feedbackResult = await generateFeedbackContent('oneToOne', input);
    feedback = feedbackResult.content;
    updateStep(0, 'success', '学情反馈生成完成');

    const dateStr = input.lessonDate || new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }).replace('/', '月') + '日';

    updateStep(1, 'running', '正在生成复习文档...');
    review = await generateReviewContent('oneToOne', input, feedback, dateStr);
    updateStep(1, 'success', '复习文档生成完成');

    updateStep(2, 'running', '正在生成测试本...');
    test = await generateTestContent('oneToOne', input, feedback, dateStr);
    updateStep(2, 'success', '测试本生成完成');

    updateStep(3, 'running', '正在生成课后信息提取...');
    extraction = await generateExtractionContent('oneToOne', input, feedback);
    updateStep(3, 'success', '课后信息提取生成完成');

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
