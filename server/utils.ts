/**
 * 共享工具函数
 */

/**
 * 获取当前北京时间上下文字符串（含精确星期，用于系统提示词）
 * 星期由代码通过 Date 对象精确计算，不依赖 AI 推算，确保日期与星期对应关系绝对准确。
 */
export function getBeijingTimeContext(): string {
  const now = new Date();
  const bjTime = new Date(now.getTime() + (8 * 60 * 60 * 1000)); // UTC+8
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const year = bjTime.getUTCFullYear();
  const month = bjTime.getUTCMonth() + 1;
  const day = bjTime.getUTCDate();
  const dateStr = `${year}年${month}月${day}日`;
  const timeStr = `${String(bjTime.getUTCHours()).padStart(2, "0")}:${String(bjTime.getUTCMinutes()).padStart(2, "0")}`;
  const weekday = weekdays[bjTime.getUTCDay()];
  return `当前时间：北京时间 ${dateStr} ${timeStr} ${weekday}\n⚠️ 以上日期与星期的对应关系由系统代码精确计算，绝对准确。请直接采用，不要自行推算或修改日期与星期的对应关系。`;
}

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
