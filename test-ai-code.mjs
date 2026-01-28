/**
 * 测试 ai_code 模式的脚本
 * 直接调用 buildCodePrompt 和 invokeAIStream 来查看 AI 返回的代码
 */

import { invokeAIStream, getAPIConfig } from './server/core/aiClient.js';

// 简单的路书内容
const roadmapContent = `你是一个诗人。请写一首关于春天的五言绝句。

输出要求：
- 标题：春日即景
- 包含4行诗句
- 每行5个字`;

// 构建代码提示词（与 batchRoutes.ts 中的 buildCodePrompt 一致）
const taskNumber = 1;
const taskNumStr = taskNumber.toString().padStart(2, '0');

const codePrompt = `你是一个专业的 Word 文档生成器。请直接输出 Node.js 代码，使用 docx 库生成 Word 文档。

【任务编号】${taskNumber}

【路书要求】
${roadmapContent}

【代码要求】
1. docx、fs、path 已作为全局变量注入，直接使用，不要使用 require()
2. 最后必须调用 Packer.toBuffer(doc) 并写入文件
3. 文件必须保存到 __outputDir 目录（变量已定义）
4. 文件名格式：任务${taskNumStr}_[你自定义的名称].docx
5. 只输出代码，不要输出任何解释或 Markdown 标记

【代码模板】
// docx、fs、path 已作为全局变量注入，无需 require
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, 
        WidthType, BorderStyle, AlignmentType, HeadingLevel } = docx;

const doc = new Document({
  sections: [{
    children: [
      // 你的文档内容
    ]
  }]
});

// 保存文件（必须）
Packer.toBuffer(doc).then(buffer => {
  const fileName = '任务${taskNumStr}_xxx.docx';
  fs.writeFileSync(path.join(__outputDir, fileName), buffer);
  console.log('文件已生成:', fileName);
});
`;

async function test() {
  console.log('========== 开始测试 ai_code 模式 ==========');
  console.log('提示词长度:', codePrompt.length);
  
  try {
    const config = getAPIConfig();
    console.log('API 配置:', { model: config.model, maxTokens: config.maxTokens });
    
    const result = await invokeAIStream(
      '', // 空的 system prompt
      codePrompt,
      (chars) => {
        process.stdout.write(`\r生成中... ${chars} 字符`);
      },
      { config, maxTokens: 16000 }
    );
    
    console.log('\n\n========== AI 返回的完整代码 ==========');
    console.log(result.content);
    console.log('========== 代码结束 ==========');
    console.log('\n代码长度:', result.content.length, '字符');
    console.log('是否截断:', result.truncated);
    console.log('停止原因:', result.stopReason);
    
    // 清理代码
    let cleanedCode = result.content.trim();
    cleanedCode = cleanedCode.replace(/^```(?:javascript|js)?\s*\n?/i, '');
    cleanedCode = cleanedCode.replace(/\n?```\s*$/i, '');
    cleanedCode = cleanedCode.trim();
    
    console.log('\n========== 清理后的代码 ==========');
    console.log(cleanedCode);
    console.log('========== 清理后代码结束 ==========');
    
  } catch (error) {
    console.error('测试失败:', error.message);
  }
}

test();
