/**
 * 内容暂存模块
 * 前端生成 taskId 传给后端，后端用 taskId 存入内容
 * 前端通过 HTTP GET 拉取，SSE 连接断开也不影响
 * 内容自动过期清理，避免内存泄漏
 */

interface StoredContent {
  content: string;
  meta?: Record<string, any>;
  createdAt: number;
}

const TTL = 30 * 60 * 1000; // 30 分钟过期（长生成可能耗时10分钟+用户查看时间）
const MAX_ITEMS = 500; // 防止极端情况内存溢出
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

/** 用指定 taskId 存入内容和附加信息 */
export function storeContent(taskId: string, content: string, meta?: Record<string, any>): void {
  // 超过上限时淘汰最老的条目
  if (store.size >= MAX_ITEMS) {
    const oldest = store.keys().next().value; // Map 按插入顺序，第一个即最老
    if (oldest) store.delete(oldest);
  }
  store.set(taskId, { content, meta, createdAt: Date.now() });
}

/** 查询内容（不删除，允许轮询） */
export function retrieveContent(taskId: string): { content: string; meta?: Record<string, any> } | null {
  const item = store.get(taskId);
  if (!item) return null;
  return { content: item.content, meta: item.meta };
}
