/**
 * 内容暂存模块
 * SSE 不传大内容，改为暂存在内存中，前端通过 HTTP GET 拉取
 * 内容自动过期清理，避免内存泄漏
 */

import crypto from "crypto";

interface StoredContent {
  content: string;
  createdAt: number;
}

const TTL = 10 * 60 * 1000; // 10 分钟过期
const store = new Map<string, StoredContent>();

// 定期清理过期内容（每 5 分钟）
setInterval(() => {
  const now = Date.now();
  for (const [id, item] of Array.from(store.entries())) {
    if (now - item.createdAt > TTL) {
      store.delete(id);
    }
  }
}, 5 * 60 * 1000);

/** 存入内容，返回 contentId */
export function storeContent(content: string): string {
  const id = crypto.randomUUID();
  store.set(id, { content, createdAt: Date.now() });
  return id;
}

/** 取出内容（取后删除） */
export function retrieveContent(id: string): string | null {
  const item = store.get(id);
  if (!item) return null;
  store.delete(id);
  return item.content;
}
