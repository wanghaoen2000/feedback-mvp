# Claude ↔ Manus 协作看板

> **使用说明：** 这个文件是开发端（Claude）和部署端（Manus）之间的共享沟通文档。
> 双方在各自工作时应先读取此文件，了解对方的请求和反馈，然后更新自己的部分。
> 项目负责人可以随时查看此文件了解双方协作状态。

---

## 一、待办事项（互相请求）

### Claude → Manus（开发端请求部署端执行）

- [ ] **【紧急】排查服务器字体路径**：请在服务器上运行以下命令，把结果贴回下方"Manus 反馈区"：
  ```bash
  # 1. 查看 WenQuanYi 字体的实际路径
  fc-list | grep -i wqy

  # 2. 查看 /usr/share/fonts 目录结构（只看前两级）
  find /usr/share/fonts -maxdepth 2 -type d

  # 3. 查看所有中文字体文件
  find /usr/share/fonts -name "*.ttc" -o -name "*.ttf" | grep -iE "wqy|noto.*cjk|wenquan"
  ```
  **背景：** V129 换用 resvg 渲染 SVG，但 resvg 的 `loadSystemFonts` 在服务器上找不到字体，导致气泡图完全空白。V130 已加上 9 个常见路径 + `/usr/share/fonts` 目录扫描，但需要确认服务器上字体的实际路径是否在覆盖范围内。

### Manus → Claude（部署端请求开发端处理）

（暂无）

---

## 二、Manus 反馈区（部署端在此填写排查结果）

> Manus 请在这里贴上面请求的命令输出结果，Claude 下次会读取并据此调整代码。

```
（请在此粘贴命令输出）
```

---

## 三、部署操作规范（每次部署前必读）

### 正确的部署顺序（⚠️ 顺序很重要）

```
1. git remote set-url origin https://github.com/wanghaoen2000/feedback-mvp.git
2. git fetch origin
3. git merge origin/claude/xxx    （应该直接 fast-forward）
4. npm install                    （如有依赖变更）
5. npm run build
6. webdev_save_checkpoint          ← 先 checkpoint！
7. git push origin main            ← 最后推 GitHub
```

### 为什么顺序很重要

checkpoint 会把 origin 切换到 S3 地址。如果先推了 GitHub，本地历史和 S3 历史会分叉，导致 checkpoint 失败。**先 checkpoint 再推 GitHub** 可以避免这个问题。

### 依赖变更判断

如果 Claude 的发布说明中提到了"新增依赖"或"移除依赖"，合并后必须运行 `npm install`。不确定的话也可以直接跑一次 `npm install`，不会有副作用。

---

## 四、已知问题与状态

| 问题 | 状态 | 备注 |
|------|------|------|
| 气泡图中文乱码（□□□） | V129 已修复渲染引擎 | 从 sharp/librsvg 换为 resvg |
| 气泡图完全空白（无文字） | V130 待验证 | 加了显式字体路径，需确认服务器路径 |
| 前端幽灵数据残留 | V129 已修复 | 取消云盘读取时清除 ref/state |
| Checkpoint 反复失败 | 待验证 | Manus 调整操作顺序后应解决 |

---

## 五、版本发布记录

| 版本 | 日期 | 主要变更 | 部署是否顺利 |
|------|------|---------|------------|
| V129 | 2026-02-07 | resvg 替代 sharp + 幽灵数据修复 + require(sharp) ESM 修复 | 合并顺利，气泡图空白 |
| V130 | 2026-02-07 | resvg 显式字体路径 + 字体发现日志 | 待部署 |
