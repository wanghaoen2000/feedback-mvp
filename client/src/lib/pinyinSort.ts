import { pinyin } from "pinyin-pro";

/**
 * 按姓氏拼音首字母排序学生列表
 */
export function sortByPinyin<T extends { name: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const pa = pinyin(a.name, { pattern: "first", toneType: "none" }).toLowerCase();
    const pb = pinyin(b.name, { pattern: "first", toneType: "none" }).toLowerCase();
    return pa.localeCompare(pb);
  });
}
