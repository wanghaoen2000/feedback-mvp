/**
 * 托福口语场景词汇表 - 代码模板
 * 
 * 用途：将AI输出的JSON数据渲染成精确排版的Word文档
 * 设计：数据+模板分离架构
 */

import { 
  Document, 
  Packer, 
  Paragraph, 
  TextRun, 
  Table, 
  TableRow, 
  TableCell, 
  AlignmentType, 
  BorderStyle, 
  WidthType, 
  ShadingType, 
  Bookmark 
} from 'docx';

// ============================================================
// 类型定义
// ============================================================

export interface WordEntry {
  num: number;
  word: string;
  phonetic: string;
  pos: string;
  meaning: string;
  example: string;
  translation: string;
}

export interface WordListData {
  listNumber: number;
  sceneName: string;
  wordCount: number;
  words: WordEntry[];
}

// ============================================================
// 格式常量
// ============================================================

const SPEC = {
  // 页面设置
  page: { 
    width: 12240,    // US Letter宽度 (DXA)
    height: 15840,   // US Letter高度 (DXA)
    margin: 600      // 页边距约0.42英寸 (DXA)
  },
  
  // 配色方案
  colors: { 
    primary: "6A1B9A",    // 深紫色 - 标题栏、编号、单词
    cardBg: "FAFAFA",     // 近白灰色 - 卡片背景
    border: "E0E0E0",     // 浅灰色 - 卡片边框
    text: "212121",       // 近黑色 - 正文
    gray: "616161",       // 深灰色 - 音标、翻译
    accent: "FF6F00",     // 橙色 - 词性标注
    lightPurple: "E1BEE7" // 浅紫色 - 词数标注
  },
  
  // 字体设置
  fonts: { 
    cn: "微软雅黑",       // 中文字体
    en: "Arial"          // 英文字体
  },
  
  // 字号设置 (单位：半磅，实际pt需÷2)
  sizes: { 
    title: 26,           // 13pt - List标题
    sceneTag: 20,        // 10pt - 场景标签
    word: 24,            // 12pt - 单词
    phonetic: 18,        // 9pt - 音标
    pos: 18,             // 9pt - 词性
    meaning: 20,         // 10pt - 释义
    example: 18,         // 9pt - 例句
    translation: 18,     // 9pt - 翻译
    numBadge: 20         // 10pt - 编号徽章
  },
  
  // 间距设置 (DXA)
  spacing: {
    afterWord: 60,       // 单词行后间距
    afterPhonetic: 60,   // 音标行后间距
    afterMeaning: 80,    // 释义行后间距
    afterExample: 40,    // 例句行后间距
    cardGap: 120,        // 卡片行间距
    afterTitle: 200      // 标题后间距
  },
  
  // 卡片尺寸 (DXA)
  card: {
    width: 5200,         // 卡片宽度约3.6英寸
    gap: 200,            // 卡片间距
    paddingV: 120,       // 上下内边距
    paddingH: 150        // 左右内边距
  }
};

// ============================================================
// 边框定义
// ============================================================

const cardBorder = { 
  style: BorderStyle.SINGLE, 
  size: 8, 
  color: SPEC.colors.border 
};

const cardBorders = { 
  top: cardBorder, 
  bottom: cardBorder, 
  left: cardBorder, 
  right: cardBorder 
};

const noBorder = { 
  style: BorderStyle.NONE, 
  size: 0, 
  color: "FFFFFF" 
};

const noBorders = { 
  top: noBorder, 
  bottom: noBorder, 
  left: noBorder, 
  right: noBorder 
};

// ============================================================
// 组件函数
// ============================================================

/**
 * 创建单词卡片
 */
function createWordCard(entry: WordEntry): TableCell {
  return new TableCell({
    borders: cardBorders,
    width: { size: SPEC.card.width, type: WidthType.DXA },
    shading: { fill: SPEC.colors.cardBg, type: ShadingType.CLEAR },
    margins: { 
      top: SPEC.card.paddingV, 
      bottom: SPEC.card.paddingV, 
      left: SPEC.card.paddingH, 
      right: SPEC.card.paddingH 
    },
    children: [
      // 第一行：编号 + 单词
      new Paragraph({
        spacing: { after: SPEC.spacing.afterWord },
        children: [
          new TextRun({ 
            text: ` ${entry.num} `, 
            font: SPEC.fonts.en, 
            size: SPEC.sizes.numBadge, 
            bold: true, 
            color: "FFFFFF", 
            shading: { fill: SPEC.colors.primary, type: ShadingType.CLEAR } 
          }),
          new TextRun({ text: "  " }),
          new TextRun({ 
            text: entry.word, 
            font: SPEC.fonts.en, 
            size: SPEC.sizes.word, 
            bold: true, 
            color: SPEC.colors.primary 
          }),
        ]
      }),
      
      // 第二行：音标 + 词性
      new Paragraph({
        spacing: { after: SPEC.spacing.afterPhonetic },
        children: [
          new TextRun({ 
            text: entry.phonetic, 
            font: SPEC.fonts.en, 
            size: SPEC.sizes.phonetic, 
            color: SPEC.colors.gray 
          }),
          new TextRun({ text: "   " }),
          new TextRun({ 
            text: entry.pos, 
            font: SPEC.fonts.en, 
            size: SPEC.sizes.pos, 
            bold: true, 
            color: SPEC.colors.accent 
          }),
        ]
      }),
      
      // 第三行：中文释义
      new Paragraph({
        spacing: { after: SPEC.spacing.afterMeaning },
        children: [
          new TextRun({ 
            text: entry.meaning, 
            font: SPEC.fonts.cn, 
            size: SPEC.sizes.meaning, 
            bold: true 
          }),
        ]
      }),
      
      // 第四行：例句
      new Paragraph({
        spacing: { after: SPEC.spacing.afterExample },
        children: [
          new TextRun({ 
            text: "▸ ", 
            font: SPEC.fonts.cn, 
            size: SPEC.sizes.example, 
            color: SPEC.colors.primary 
          }),
          new TextRun({ 
            text: entry.example, 
            font: SPEC.fonts.en, 
            size: SPEC.sizes.example, 
            italics: true, 
            color: SPEC.colors.text 
          }),
        ]
      }),
      
      // 第五行：翻译
      new Paragraph({
        children: [
          new TextRun({ 
            text: "   " + entry.translation, 
            font: SPEC.fonts.cn, 
            size: SPEC.sizes.translation, 
            color: SPEC.colors.gray 
          }),
        ]
      }),
    ]
  });
}

/**
 * 创建空白占位单元格（用于奇数单词时的右侧填充）
 */
function createEmptyCell(): TableCell {
  return new TableCell({
    borders: noBorders,
    width: { size: SPEC.card.width, type: WidthType.DXA },
    children: [new Paragraph({ children: [] })]
  });
}

/**
 * 创建间隔单元格（两列之间的空隙）
 */
function createGapCell(): TableCell {
  return new TableCell({
    borders: noBorders,
    width: { size: SPEC.card.gap, type: WidthType.DXA },
    children: [new Paragraph({ children: [] })]
  });
}

/**
 * 创建List标题栏（带书签，支持目录跳转）
 */
function createListHeader(listNum: number, sceneName: string, wordCount: number): Table {
  const bookmarkId = `list_${listNum}`;
  
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: noBorders,
            shading: { fill: SPEC.colors.primary, type: ShadingType.CLEAR },
            margins: { top: 100, bottom: 100, left: 200, right: 200 },
            children: [
              new Paragraph({
                children: [
                  // 使用 Bookmark 包装标题内容（支持目录跳转）
                  new Bookmark({
                    id: bookmarkId,
                    children: [
                      // List编号
                      new TextRun({ 
                        text: `List ${listNum}`, 
                        font: SPEC.fonts.en, 
                        size: SPEC.sizes.title, 
                        bold: true, 
                        italics: true, 
                        color: "FFFFFF" 
                      }),
                      
                      // 场景名称
                      new TextRun({ 
                        text: `  ${sceneName}`, 
                        font: SPEC.fonts.en, 
                        size: SPEC.sizes.title, 
                        bold: true, 
                        color: "FFFFFF" 
                      }),
                      
                      // 词数标注
                      new TextRun({ 
                        text: `    ${wordCount}词`, 
                        font: SPEC.fonts.cn, 
                        size: SPEC.sizes.sceneTag, 
                        color: SPEC.colors.lightPurple 
                      }),
                    ]
                  }),
                ]
              })
            ]
          })
        ]
      })
    ]
  });
}

/**
 * 创建卡片行（每行2个卡片）
 */
function createCardRow(word1: WordEntry, word2?: WordEntry): TableRow {
  const children = [
    createWordCard(word1),
    createGapCell(),
  ];
  
  if (word2) {
    children.push(createWordCard(word2));
  } else {
    children.push(createEmptyCell());
  }
  
  return new TableRow({ 
    cantSplit: true,  // 防止卡片跨页断开
    children 
  });
}

/**
 * 创建间距行
 */
function createSpacerRow(): TableRow {
  return new TableRow({
    cantSplit: true,
    children: [
      new TableCell({ 
        borders: noBorders, 
        width: { size: SPEC.card.width, type: WidthType.DXA }, 
        children: [new Paragraph({ spacing: { after: SPEC.spacing.cardGap }, children: [] })] 
      }),
      new TableCell({ 
        borders: noBorders, 
        width: { size: SPEC.card.gap, type: WidthType.DXA }, 
        children: [new Paragraph({ children: [] })] 
      }),
      new TableCell({ 
        borders: noBorders, 
        width: { size: SPEC.card.width, type: WidthType.DXA }, 
        children: [new Paragraph({ children: [] })] 
      }),
    ]
  });
}

/**
 * 构建双栏卡片网格
 */
function createCardGrid(words: WordEntry[]): Table {
  const rows: TableRow[] = [];
  
  for (let i = 0; i < words.length; i += 2) {
    rows.push(createCardRow(words[i], words[i + 1]));
    
    // 在非最后一行后添加间距行
    if (i + 2 < words.length) {
      rows.push(createSpacerRow());
    }
  }
  
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [SPEC.card.width, SPEC.card.gap, SPEC.card.width],
    rows: rows
  });
}

// ============================================================
// 主函数
// ============================================================

/**
 * 生成Word文档
 * @param data JSON数据（AI输出）
 * @returns Word文档的Buffer
 */
export async function generateWordListDocx(data: WordListData): Promise<Buffer> {
  // 构建文档内容
  const content = [
    createListHeader(data.listNumber, data.sceneName, data.wordCount),
    new Paragraph({ spacing: { after: SPEC.spacing.afterTitle }, children: [] }),
    createCardGrid(data.words),
  ];

  // 创建文档
  const doc = new Document({
    styles: {
      default: { 
        document: { 
          run: { 
            font: SPEC.fonts.cn, 
            size: 22 
          } 
        } 
      }
    },
    sections: [{
      properties: {
        page: {
          size: { 
            width: SPEC.page.width, 
            height: SPEC.page.height 
          },
          margin: { 
            top: SPEC.page.margin, 
            right: SPEC.page.margin, 
            bottom: SPEC.page.margin, 
            left: SPEC.page.margin 
          }
        }
      },
      children: content
    }]
  });

  // 生成Buffer
  return await Packer.toBuffer(doc);
}

// ============================================================
// 使用示例（供参考，实际使用时由批量程序调用）
// ============================================================

/*
import * as fs from 'fs';

// AI输出的JSON数据
const jsonData: WordListData = {
  listNumber: 3,
  sceneName: "Library",
  wordCount: 25,
  words: [
    {
      num: 65,
      word: "Librarian",
      phonetic: "/laɪˈbreəriən/",
      pos: "n.",
      meaning: "图书管理员",
      example: "The librarian helped me find reference books for my research paper.",
      translation: "图书管理员帮我找到了写研究论文需要的参考书。"
    },
    // ... 更多单词
  ]
};

// 生成文档
generateWordListDocx(jsonData).then(buffer => {
  const fileName = `托福口语词汇表_List_${String(jsonData.listNumber).padStart(2, '0')}.docx`;
  fs.writeFileSync(fileName, buffer);
  console.log(`${fileName} 已生成`);
});
*/
