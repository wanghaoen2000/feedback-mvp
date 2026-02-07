/**
 * 共享工具函数
 */

/**
 * 给日期字符串添加星期几信息
 * 支持格式："2026年1月11日" → "2026年1月11日（周六）"
 *           "1月11日" → "1月11日（周六）"
 */
export function addWeekdayToDate(dateStr: string): string {
  if (!dateStr) return dateStr;

  // 如果已经包含星期信息，直接返回
  if (dateStr.includes('周') || dateStr.includes('星期')) {
    return dateStr;
  }

  try {
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];

    // 解析日期：支持 "2026年1月11日" 或 "1月11日" 格式
    const match = dateStr.match(/(\d{4})年?(\d{1,2})月(\d{1,2})日?/);
    if (!match) {
      // 尝试解析不带年份的格式
      const shortMatch = dateStr.match(/(\d{1,2})月(\d{1,2})日?/);
      if (!shortMatch) return dateStr;

      const year = new Date().getFullYear();
      const month = parseInt(shortMatch[1], 10) - 1;
      const day = parseInt(shortMatch[2], 10);
      const date = new Date(year, month, day);

      return `${dateStr}（周${weekdays[date.getDay()]}）`;
    }

    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    const date = new Date(year, month, day);

    return `${dateStr}（周${weekdays[date.getDay()]}）`;
  } catch (e) {
    console.error('[addWeekdayToDate] 解析日期失败:', dateStr, e);
    return dateStr;
  }
}
