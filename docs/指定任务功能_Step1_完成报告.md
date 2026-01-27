# 指定任务功能 Step 1 完成报告

## 任务概述

**目标**：前端新增「指定任务」模式，允许用户输入特定编号（如 3,6,8,11,14），只重跑失败的任务。

## 完成内容

### 1. 新增 state 变量

**文件**：`client/src/components/BatchProcess.tsx`  
**位置**：第 258-261 行

```typescript
// 任务编号模式：'range'（连续范围）或 'specific'（指定任务）
const [taskMode, setTaskMode] = useState<'range' | 'specific'>('range');
// 指定任务的输入内容
const [specificTasks, setSpecificTasks] = useState("");
```

### 2. 新增模式切换 UI

**位置**：第 1178-1248 行

- 添加了两个 Radio 按钮：「连续范围」和「指定任务」
- 条件渲染：
  - `range` 模式显示「起始编号」和「结束编号」两个输入框
  - `specific` 模式显示「指定任务编号」单个输入框，带提示文字

### 3. 新增 parseSpecificTasks 解析函数

**位置**：第 748-756 行

```typescript
const parseSpecificTasks = (input: string): number[] => {
  return input
    .split(',')
    .map(s => s.trim())
    .filter(s => s !== '')
    .map(s => parseInt(s, 10))
    .filter(n => !isNaN(n) && n > 0);
};
```

**解析规则**：
- `parseSpecificTasks("3,6,8,11,14")` → `[3, 6, 8, 11, 14]`
- `parseSpecificTasks("3, 6, , 8")` → `[3, 6, 8]`（过滤空值）
- `parseSpecificTasks("abc,3,def,6")` → `[3, 6]`（过滤非法值）

### 4. 修改提交逻辑

**位置**：第 758-849 行

- 根据 `taskMode` 生成 `taskNumbers` 数组
- `range` 模式：使用 `for` 循环生成连续编号
- `specific` 模式：调用 `parseSpecificTasks` 解析用户输入
- 请求参数根据模式不同：
  - `range` 模式：传递 `startNumber` 和 `endNumber`
  - `specific` 模式：传递 `taskNumbers` 数组

### 5. 输入验证

- `range` 模式：验证起始和结束编号有效性
- `specific` 模式：验证解析结果非空，否则提示「请输入有效的任务编号」

## 验收结果

| 检查项 | 结果 |
|--------|------|
| 模式切换 UI 显示正确 | ✅ |
| 切换模式时输入框正确显示/隐藏 | ✅ |
| parseSpecificTasks 解析正确 | ✅ |
| 输入验证正常工作 | ✅ |
| pnpm build 无报错 | ✅ |
| git push 成功 | ✅ |

## Git 提交

```
54296b2 指定任务功能 Step 1: 前端新增模式切换和输入框
```

## 下一步

**Step 2**：后端支持 `taskNumbers` 数组参数

需要修改 `server/batch/batchRoutes.ts`：
1. 接收 `taskNumbers` 参数（可选）
2. 如果有 `taskNumbers`，使用它；否则使用 `startNumber/endNumber` 生成
3. 其他逻辑不变
