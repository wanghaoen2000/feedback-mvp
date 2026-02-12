/**
 * 批量任务核心执行逻辑
 * 提供共享的消息构建和单任务执行函数
 * 被 batchRoutes.ts（SSE模式）和 batchTaskRunner.ts（后台模式）共同使用
 */
import { invokeAIStream, APIConfig, FileInfo } from "../core/aiClient";
import { generateBatchDocument } from "./batchWordGenerator";
import { generateWordListDocx, WordListData } from "../templates/wordCardTemplate";
import { generateWritingMaterialDocx, WritingMaterialData } from "./writingMaterialGenerator";
import { uploadBinaryToGoogleDrive } from "../gdrive";

/**
 * 模板类型对应的格式要求
 */
export const TEMPLATE_FORMAT_REQUIREMENTS: Record<string, string> = {
  word_card: `
【输出格式要求 - 词汇卡片】
⚠️ 你必须只输出纯 JSON，不要输出任何其他内容！
⚠️ 不要输出 \`\`\`json 代码块标记！
⚠️ 不要输出任何解释或说明文字！

JSON 结构如下：
{
  "listNumber": 数字,
  "sceneName": "场景名称",
  "wordCount": 单词数量,
  "words": [{
    "num": 序号,
    "word": "单词",
    "phonetic": "/音标/",
    "pos": "词性",
    "meaning": "中文释义",
    "example": "例句",
    "translation": "例句翻译"
  }]
}`,

  writing_material: `
【输出格式要求 - 写作素材】
⚠️ 你必须只输出纯 JSON，不要输出任何其他内容！
⚠️ 不要输出 \`\`\`json 代码块标记！
⚠️ 不要输出任何解释或说明文字！

JSON 结构如下：
{
  "partNum": 数字,
  "partTitle": "Part 标题",
  "listNum": 数字,
  "listTitle": "List 标题",
  "bookmarkId": "唯一书签ID",
  "categories": [{
    "categoryTitle": "分类标题",
    "sections": [{
      "sectionTitle": "小节标题",
      "items": [{
        "english": "English expression",
        "chinese": "中文释义"
      }]
    }]
  }]
}`,
};

/**
 * 构建带来源标签的消息内容
 */
export function buildBatchMessageContent(
  taskNumber: number,
  roadmapContent: string,
  sharedFileList: FileInfo[] | undefined,
  independentFile: FileInfo | undefined,
  templateType?: string
): { systemPrompt: string; userMessage: string } {
  const formatRequirement = templateType ? (TEMPLATE_FORMAT_REQUIREMENTS[templateType] || '') : '';

  const systemPrompt = `<路书提示词>
${roadmapContent}
</路书提示词>
${formatRequirement}
【重要】请直接输出结果，不要与用户互动，不要询问任何问题。`;

  let userMessage = `这是任务编号 ${taskNumber}，请按照路书要求生成内容。`;

  const sharedDocTexts: string[] = [];
  if (sharedFileList && sharedFileList.length > 0) {
    for (const file of sharedFileList) {
      if (file.type === 'document' && file.extractedText) {
        sharedDocTexts.push(file.extractedText);
      }
    }
  }

  if (sharedDocTexts.length > 0) {
    userMessage += `\n\n<共享文档>\n${sharedDocTexts.join('\n---\n')}\n</共享文档>`;
  }

  if (independentFile?.type === 'document' && independentFile.extractedText) {
    userMessage += `\n\n<单独文档>\n${independentFile.extractedText}\n</单独文档>`;
  }

  const allFiles = [...(sharedFileList || []), ...(independentFile ? [independentFile] : [])];
  const imageCount = allFiles.filter(f => f.type === 'image').length;
  const docCount = allFiles.filter(f => f.type === 'document').length;
  const textDocCount = allFiles.filter(f => f.type === 'document' && f.extractedText).length;
  const urlDocCount = docCount - textDocCount;

  const hints: string[] = [];
  if (imageCount > 0) hints.push(`${imageCount} 张图片`);
  if (textDocCount > 0) hints.push(`${textDocCount} 份文档（已提取文本，见上方标签）`);
  if (urlDocCount > 0) hints.push(`${urlDocCount} 份文档（以URL形式提供）`);

  if (hints.length > 0) {
    userMessage += `\n\n【附件】请分析以上 ${hints.join('、')}。`;
  }

  return { systemPrompt, userMessage };
}

/**
 * 单任务执行参数
 */
export interface BatchItemParams {
  taskNumber: number;
  roadmap: string;
  templateType: string;
  filePrefix: string;
  namingMethod: string;
  customFileNames?: Record<number, string>;
  files?: Record<number, FileInfo>;
  sharedFiles?: FileInfo[];
  batchFolderPath?: string;
  config: APIConfig;
}

/**
 * 单任务执行结果
 */
export interface BatchItemResult {
  content: string;
  filename: string;
  url?: string;
  path?: string;
  truncated?: boolean;
  chars: number;
}

/**
 * 执行单个批量任务（核心逻辑）
 * 被 SSE 路由和后台任务运行器共同使用
 */
export async function executeBatchItem(
  params: BatchItemParams,
  onProgress: (chars: number, message?: string) => void
): Promise<BatchItemResult> {
  const {
    taskNumber, roadmap, templateType, filePrefix, namingMethod,
    customFileNames, files, sharedFiles, batchFolderPath, config,
  } = params;

  // 获取文件
  const taskFileInfos: FileInfo[] = [];
  const sharedFileList = sharedFiles as FileInfo[] | undefined;
  if (sharedFileList && sharedFileList.length > 0) {
    taskFileInfos.push(...sharedFileList);
  }
  const independentFile = files?.[taskNumber];
  if (independentFile) {
    taskFileInfos.push(independentFile);
  }

  // 构建消息
  const { systemPrompt, userMessage } = buildBatchMessageContent(
    taskNumber, roadmap, sharedFileList, independentFile, templateType
  );

  let lastReportedChars = 0;

  // 调用 AI
  const aiResult = await invokeAIStream(
    systemPrompt,
    userMessage,
    (chars) => {
      if (chars - lastReportedChars >= 100 || lastReportedChars === 0) {
        onProgress(chars);
        lastReportedChars = chars;
      }
    },
    { config, fileInfos: taskFileInfos.length > 0 ? taskFileInfos : undefined }
  );

  const content = aiResult.content;
  const isTruncated = aiResult.truncated;

  if (!content || content.length === 0) {
    throw new Error("AI 返回内容为空");
  }

  if (isTruncated) {
    console.log(`[BatchExecutor] ⚠️ 任务 ${taskNumber} 内容因token上限被截断`);
  }

  // 最终进度
  if (content.length !== lastReportedChars) {
    onProgress(content.length);
  }

  console.log(`[BatchExecutor] 任务 ${taskNumber} AI 生成完成，内容长度: ${content.length} 字符`);
  onProgress(content.length, "正在生成文档...");

  // 生成文档
  let buffer: Buffer;
  let filename: string;
  const customName = customFileNames?.[taskNumber] as string | undefined;

  if (templateType === 'word_card') {
    let cleanContent = content.trim();
    if (cleanContent.startsWith('```json')) cleanContent = cleanContent.slice(7);
    else if (cleanContent.startsWith('```')) cleanContent = cleanContent.slice(3);
    if (cleanContent.endsWith('```')) cleanContent = cleanContent.slice(0, -3);
    cleanContent = cleanContent.trim();

    const jsonData = JSON.parse(cleanContent) as WordListData;
    buffer = await generateWordListDocx(jsonData);
    if (customName) {
      filename = `${customName}.docx`;
    } else {
      filename = `${(filePrefix.trim() || '任务')}${taskNumber.toString().padStart(2, '0')}.docx`;
    }
  } else if (templateType === 'writing_material') {
    let cleanContent = content.trim();
    if (cleanContent.startsWith('```json')) cleanContent = cleanContent.slice(7);
    else if (cleanContent.startsWith('```')) cleanContent = cleanContent.slice(3);
    if (cleanContent.endsWith('```')) cleanContent = cleanContent.slice(0, -3);
    cleanContent = cleanContent.trim();

    if (!cleanContent.startsWith('{')) {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) cleanContent = jsonMatch[1].trim();
      else {
        const braceMatch = content.match(/\{[\s\S]*\}/);
        if (braceMatch) cleanContent = braceMatch[0];
      }
    }

    const jsonData = JSON.parse(cleanContent) as WritingMaterialData;
    buffer = await generateWritingMaterialDocx(jsonData);
    if (customName) {
      filename = `${customName}.docx`;
    } else {
      filename = `${(filePrefix.trim() || '任务')}${taskNumber.toString().padStart(2, '0')}.docx`;
    }
  } else if (templateType === 'markdown_file') {
    if (customName) {
      filename = `${customName}.md`;
    } else {
      filename = `${(filePrefix.trim() || '任务')}${taskNumber.toString().padStart(2, '0')}.md`;
    }
    buffer = Buffer.from(content, 'utf-8');
  } else if (templateType === 'markdown_plain') {
    const result = await generateBatchDocument(content, taskNumber, filePrefix, false, customName);
    buffer = result.buffer;
    filename = result.filename;
  } else {
    // 默认 markdown_styled
    const result = await generateBatchDocument(content, taskNumber, filePrefix, true, customName);
    buffer = result.buffer;
    filename = result.filename;
  }

  // 上传到 Google Drive
  let uploadUrl: string | undefined;
  let uploadPath: string | undefined;

  if (batchFolderPath) {
    onProgress(content.length, "正在上传到 Google Drive...");
    console.log(`[BatchExecutor] 任务 ${taskNumber} 上传到: ${batchFolderPath}/${filename}`);
    const uploadResult = await uploadBinaryToGoogleDrive(buffer, filename, batchFolderPath);
    if (uploadResult.status === 'success') {
      uploadUrl = uploadResult.url;
      uploadPath = uploadResult.path;
      console.log(`[BatchExecutor] 任务 ${taskNumber} 上传成功`);
    } else {
      throw new Error(`上传失败: ${uploadResult.error}`);
    }
  }

  return {
    content,
    filename,
    url: uploadUrl,
    path: uploadPath,
    truncated: isTruncated,
    chars: content.length,
  };
}
