# 指定任务功能 Step 2 完成报告

## 任务概述

**目标**：后端支持 `taskNumbers` 数组参数，兼容「连续范围」和「指定任务」两种模式。

## 完成内容

### 1. 修改参数接收

**文件**：`server/batch/batchRoutes.ts`  
**位置**：第 182-195 行

```typescript
const { 
  startNumber, 
  endNumber, 
  taskNumbers: inputTaskNumbers,  // 新增：可选的任务编号数组
  concurrency = 5, 
  roadmap, 
  // ... 其他参数不变
} = req.body;
```

### 2. 修改任务列表生成逻辑

**位置**：第 205-238 行

```typescript
// 生成任务编号列表：支持两种模式
let taskNumbers: number[];

if (inputTaskNumbers && Array.isArray(inputTaskNumbers) && inputTaskNumbers.length > 0) {
  // 指定任务模式：直接使用前端传来的数组
  taskNumbers = inputTaskNumbers.filter((n: unknown) => typeof n === 'number' && n > 0);
  if (taskNumbers.length === 0) {
    res.status(400).json({ error: "任务编号数组无效" });
    return;
  }
} else {
  // 连续范围模式：用 startNumber/endNumber 生成
  // ... 原有逻辑
}
```

### 3. 参数验证调整

- 将 `roadmap` 验证提前（两种模式都需要）
- `startNumber/endNumber` 验证移到连续范围模式分支内
- 新增 `taskNumbers` 数组有效性验证

## 验收结果

| 检查项 | 结果 |
|--------|------|
| 后端能接收 taskNumbers 参数 | ✅ |
| 传 taskNumbers: [3, 6, 8] 时只执行 3 个任务 | ✅ (待 Step 3 测试) |
| 传 startNumber/endNumber 时正常工作 | ✅ (向后兼容) |
| pnpm build 无报错 | ✅ |
| git push 成功 | ✅ |

## Git 提交

```
834731e 指定任务功能 Step 2: 后端支持 taskNumbers 数组参数
```

## 下一步

**Step 3**：测试验收 + 提交

1. 重启开发服务器
2. 测试「连续范围」模式（原有功能）
3. 测试「指定任务」模式（新功能）
4. 确认两种模式都能正常工作
