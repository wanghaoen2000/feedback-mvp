/**
 * 批量处理模板类型定义
 * 定义所有支持的模板类型常量和类型
 */

/**
 * 模板类型常量
 */
export const TEMPLATE_TYPES = {
  /** 教学材料（带样式）- 默认模板 */
  MARKDOWN_STYLED: 'markdown_styled',
  /** 通用文档（无样式）- 黑白简洁 */
  MARKDOWN_PLAIN: 'markdown_plain',
  /** 生成 MD 文件 - 直接保存 Markdown */
  MARKDOWN_FILE: 'markdown_file',
  /** 词汇卡片 - 精确排版模板 */
  WORD_CARD: 'word_card',
  /** 写作素材 - 写作素材模板 */
  WRITING_MATERIAL: 'writing_material',
  /** 自由排版（AI代码）- AI 生成 docx-js 代码，沙箱执行生成 Word */
  AI_CODE: 'ai_code',
} as const;

/**
 * 模板类型联合类型
 */
export type TemplateType = typeof TEMPLATE_TYPES[keyof typeof TEMPLATE_TYPES];

/**
 * 模板类型显示名称映射
 */
export const TEMPLATE_TYPE_LABELS: Record<TemplateType, string> = {
  [TEMPLATE_TYPES.MARKDOWN_STYLED]: '教学材料（带样式）',
  [TEMPLATE_TYPES.MARKDOWN_PLAIN]: '通用文档（无样式）',
  [TEMPLATE_TYPES.MARKDOWN_FILE]: '生成MD文件',
  [TEMPLATE_TYPES.WORD_CARD]: '词汇卡片',
  [TEMPLATE_TYPES.WRITING_MATERIAL]: '写作素材',
  [TEMPLATE_TYPES.AI_CODE]: '自由排版（AI代码）',
};

/**
 * 模板类型描述映射
 */
export const TEMPLATE_TYPE_DESCRIPTIONS: Record<TemplateType, string> = {
  [TEMPLATE_TYPES.MARKDOWN_STYLED]: 'AI 输出 Markdown，系统转换为带样式的 Word 文档',
  [TEMPLATE_TYPES.MARKDOWN_PLAIN]: 'AI 输出 Markdown，系统转换为黑白简洁的 Word 文档',
  [TEMPLATE_TYPES.MARKDOWN_FILE]: 'AI 输出 Markdown，直接保存为 .md 文件',
  [TEMPLATE_TYPES.WORD_CARD]: 'AI 输出 JSON，系统使用词汇卡片模板生成 Word',
  [TEMPLATE_TYPES.WRITING_MATERIAL]: 'AI 输出 JSON，系统使用写作素材模板生成 Word',
  [TEMPLATE_TYPES.AI_CODE]: 'AI 输出 docx-js 代码，系统在沙箱中执行生成 Word（实验性）',
};

/**
 * 检查是否为有效的模板类型
 */
export function isValidTemplateType(type: string): type is TemplateType {
  return Object.values(TEMPLATE_TYPES).includes(type as TemplateType);
}
