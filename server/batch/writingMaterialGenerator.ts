/**
 * V48 Step 11: 写作素材模板生成器
 * 将 JSON 数据渲染为精确排版的 Word 文档（简洁列表式+紫色主题）
 */
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  ShadingType,
  Bookmark,
  convertInchesToTwip,
} from "docx";

// ============ 类型定义 ============

export interface WritingMaterialItem {
  num: number;
  en: string;
  cn: string;
}

export interface WritingMaterialSection {
  code: string;
  name: string;
  items: WritingMaterialItem[];
}

export interface WritingMaterialCategory {
  id: string;
  name: string;
  sections: WritingMaterialSection[];
}

export interface WritingMaterialData {
  partNum: number;
  partTitle: string;
  listNum: number;
  listTitle: string;
  bookmarkId: string;
  categories: WritingMaterialCategory[];
}

// ============ 颜色方案 ============

const COLORS = {
  primary: "6A1B9A",      // 深紫色 - 标题背景、编号
  lightPurple: "E1BEE7",  // 浅紫色 - 条目数显示
  text: "212121",         // 正文黑色 - 英文表达
  gray: "616161",         // 辅助灰色 - 中文释义
  white: "FFFFFF",        // 白色文字
};

// ============ 辅助函数 ============

/**
 * 创建 Part 标题（紫色背景横幅 + 书签）
 */
function createPartHeader(partNum: number, title: string): Paragraph {
  return new Paragraph({
    children: [
      new Bookmark({
        id: `part_${partNum}`,
        children: [
          new TextRun({
            text: `Part ${partNum}. ${title}`,
            bold: true,
            size: 64,  // 32pt = 64 half-points
            color: COLORS.white,
            font: {
              name: "微软雅黑",
              eastAsia: "微软雅黑",
            },
          }),
        ],
      }),
    ],
    alignment: AlignmentType.CENTER,
    shading: {
      type: ShadingType.SOLID,
      color: COLORS.primary,
      fill: COLORS.primary,
    },
    spacing: {
      before: 200,
      after: 300,
    },
  });
}

/**
 * 创建 List 标题（紫色背景横幅 + 书签 + 条目数）
 */
function createListHeader(
  listNum: number,
  title: string,
  itemCount: number,
  bookmarkId: string
): Paragraph {
  return new Paragraph({
    children: [
      new Bookmark({
        id: bookmarkId,
        children: [
          new TextRun({
            text: `List ${listNum} ${title}`,
            bold: true,
            size: 52,  // 26pt = 52 half-points
            color: COLORS.white,
            font: {
              name: "微软雅黑",
              eastAsia: "微软雅黑",
            },
          }),
          new TextRun({
            text: `              ${itemCount}条`,
            size: 44,  // 22pt
            color: COLORS.lightPurple,
            font: {
              name: "微软雅黑",
              eastAsia: "微软雅黑",
            },
          }),
        ],
      }),
    ],
    alignment: AlignmentType.CENTER,
    shading: {
      type: ShadingType.SOLID,
      color: COLORS.primary,
      fill: COLORS.primary,
    },
    spacing: {
      before: 200,
      after: 300,
    },
  });
}

/**
 * 创建大分类标题（紫色加粗）
 */
function createCategoryTitle(id: string, name: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text: `${id}. ${name}`,
        bold: true,
        size: 48,  // 24pt = 48 half-points
        color: COLORS.primary,
        font: {
          name: "微软雅黑",
          eastAsia: "微软雅黑",
        },
      }),
    ],
    spacing: {
      before: 300,
      after: 150,
    },
  });
}

/**
 * 创建小节标题（紫色加粗）
 */
function createSectionTitle(code: string, name: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text: `${code} ${name}`,
        bold: true,
        size: 44,  // 22pt = 44 half-points
        color: COLORS.primary,
        font: {
          name: "微软雅黑",
          eastAsia: "微软雅黑",
        },
      }),
    ],
    spacing: {
      before: 200,
      after: 100,
    },
  });
}

/**
 * 创建条目（紫色编号 + 黑色英文 + 灰色中文）
 */
function createItem(num: number, english: string, chinese: string): Paragraph {
  return new Paragraph({
    children: [
      // 紫色编号
      new TextRun({
        text: `${num}. `,
        bold: true,
        size: 40,  // 20pt = 40 half-points
        color: COLORS.primary,
        font: {
          name: "Arial",
        },
      }),
      // 黑色英文
      new TextRun({
        text: english,
        size: 40,  // 20pt
        color: COLORS.text,
        font: {
          name: "Arial",
        },
      }),
      // 分隔符
      new TextRun({
        text: " - ",
        size: 40,
        color: COLORS.gray,
        font: {
          name: "Arial",
        },
      }),
      // 灰色中文
      new TextRun({
        text: chinese,
        size: 40,  // 20pt
        color: COLORS.gray,
        font: {
          name: "微软雅黑",
          eastAsia: "微软雅黑",
        },
      }),
    ],
    spacing: {
      before: 60,
      after: 60,
    },
    indent: {
      left: convertInchesToTwip(0.25),  // 0.25英寸缩进
    },
  });
}

// ============ 主函数 ============

/**
 * 生成写作素材 Word 文档
 * @param jsonData 写作素材 JSON 数据
 * @returns Word 文档 Buffer
 */
export async function generateWritingMaterialDocx(
  jsonData: WritingMaterialData
): Promise<Buffer> {
  const children: Paragraph[] = [];
  
  // 计算总条目数
  let totalItems = 0;
  for (const category of jsonData.categories) {
    for (const section of category.sections) {
      totalItems += section.items.length;
    }
  }
  
  console.log(`[WritingMaterialGenerator] 开始生成文档，共 ${totalItems} 条`);
  
  // 1. 生成 Part 标题
  children.push(createPartHeader(jsonData.partNum, jsonData.partTitle));
  
  // 2. 生成 List 标题（显示条目数）
  children.push(createListHeader(
    jsonData.listNum,
    jsonData.listTitle,
    totalItems,
    jsonData.bookmarkId
  ));
  
  // 3. 遍历 categories → sections → items
  for (const category of jsonData.categories) {
    // 大分类标题
    children.push(createCategoryTitle(category.id, category.name));
    
    for (const section of category.sections) {
      // 小节标题
      children.push(createSectionTitle(section.code, section.name));
      
      // 条目
      for (const item of section.items) {
        children.push(createItem(item.num, item.en, item.cn));
      }
    }
  }
  
  // 4. 创建文档
  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: {
            width: convertInchesToTwip(8.5),   // US Letter 宽度
            height: convertInchesToTwip(11),  // US Letter 高度
          },
          margin: {
            top: 600,     // 约 0.42 英寸
            bottom: 600,
            left: 600,
            right: 600,
          },
        },
      },
      children,
    }],
  });
  
  // 5. 生成 Buffer
  const buffer = await Packer.toBuffer(doc);
  
  console.log(`[WritingMaterialGenerator] 文档生成完成，大小: ${buffer.length} 字节`);
  
  return buffer;
}
