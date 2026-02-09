# Claude ↔ Manus 协作看板

> **使用说明：** 这个文件是开发端（Claude）和部署端（Manus）之间的共享沟通文档。
> 双方在各自工作时应先读取此文件，了解对方的请求和反馈，然后更新自己的部分。
> 项目负责人可以随时查看此文件了解双方协作状态。

---

## 一、待办事项（互相请求）

### Claude → Manus（开发端请求部署端执行）

- [x] **【已完成】复制字体文件到项目目录**（完成于 2026-02-07）：V130 日志确认 Node 进程在沙箱中，无法访问 `/usr/share/fonts`。请执行：
  ```bash
  cp /usr/share/fonts/truetype/wqy/wqy-zenhei.ttc ./fonts/
  ```
  然后提交推送：
  ```bash
  git add fonts/wqy-zenhei.ttc
  git commit -m "添加 WenQuanYi Zen Hei 字体文件（供 resvg 渲染中文）"
  ```
  **背景：** Node 进程在 Manus 沙箱中运行，`existsSync('/usr/share/fonts')` 返回 false。V131 代码已改为优先从项目本地 `fonts/` 目录加载字体，但需要你把字体文件复制进来。文件约 15MB。

- [x] **【已完成】排查服务器字体路径**（完成于 2026-02-07）：
  ```bash
  # 1. 查看 WenQuanYi 字体的实际路径
  fc-list | grep -i wqy

  # 2. 查看 /usr/share/fonts 目录结构（只看前两级）
  find /usr/share/fonts -maxdepth 2 -type d

  # 3. 查看所有中文字体文件
  find /usr/share/fonts -name "*.ttc" -o -name "*.ttf" | grep -iE "wqy|noto.*cjk|wenquan"
  ```
  **背景：** V129 换用 resvg 渲染 SVG，但 resvg 的 `loadSystemFonts` 在服务器上找不到字体，导致气泡图完全空白。V130 已加上 9 个常见路径 + `/usr/share/fonts` 目录扫描，但需要确认服务器上字体的实际路径是否在覆盖范围内。

- [ ] **复制 Noto Sans CJK 字体到项目目录**（V134 气泡图字体优化）：
  ```bash
  cp /usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc ./fonts/
  ```
  然后提交推送：
  ```bash
  git add fonts/NotoSansCJK-Regular.ttc
  git commit -m "添加 Noto Sans CJK 字体文件（气泡图字体优化）"
  ```
  **背景：** V134 代码将气泡图字体优先级改为 Noto Sans CJK SC（思源黑体），比 WenQuanYi Zen Hei 更美观。代码已做兜底处理——如果 Noto 字体不存在，仍然使用 WenQuanYi Zen Hei。字体文件约 20MB。

### Manus → Claude（部署端请求开发端处理）

（暂无）

---

## 二、Manus 反馈区（部署端在此填写排查结果）

> Manus 请在这里贴上面请求的命令输出结果，Claude 下次会读取并据此调整代码。

**排查时间：** 2026-02-07 17:45 (GMT+8)
**排查环境：** Manus 沙箱服务器 (Ubuntu 22.04)

### 命令1：fc-list | grep -i wqy
```
/usr/share/fonts/truetype/wqy/wqy-microhei.ttc: WenQuanYi Micro Hei,文泉驛微米黑,文泉驿微米黑:style=Regular
/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc: WenQuanYi Zen Hei,文泉驛正黑,文泉驿正黑:style=Regular
/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc: WenQuanYi Zen Hei Sharp,文泉驛點陣正黑,文泉驿点阵正黑:style=Regular
/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc: WenQuanYi Zen Hei Mono,文泉驛等寬正黑,文泉驿等宽正黑:style=Regular
/usr/share/fonts/truetype/wqy/wqy-microhei.ttc: WenQuanYi Micro Hei Mono,文泉驛等寬微米黑,文泉驿等宽微米黑:style=Regular
```

### 命令2：find /usr/share/fonts -maxdepth 2 -type d
```
/usr/share/fonts
/usr/share/fonts/opentype
/usr/share/fonts/opentype/fonts-hosny-amiri
/usr/share/fonts/opentype/ipafont-gothic
/usr/share/fonts/opentype/noto
/usr/share/fonts/truetype
/usr/share/fonts/truetype/abyssinica
/usr/share/fonts/truetype/droid
/usr/share/fonts/truetype/liberation
/usr/share/fonts/truetype/libreoffice
/usr/share/fonts/truetype/lohit-devanagari
/usr/share/fonts/truetype/lohit-gujarati
/usr/share/fonts/truetype/lohit-tamil
/usr/share/fonts/truetype/noto
/usr/share/fonts/truetype/padauk
/usr/share/fonts/truetype/scheherazade
/usr/share/fonts/truetype/tlwg
/usr/share/fonts/truetype/wqy
```

### 命令3：find /usr/share/fonts -name "*.ttc" -o -name "*.ttf" | grep -iE "wqy|noto.*cjk|wenquan"
```
/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc
/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc
/usr/share/fonts/opentype/noto/NotoSansCJK-DemiLight.ttc
/usr/share/fonts/opentype/noto/NotoSansCJK-Light.ttc
/usr/share/fonts/opentype/noto/NotoSansCJK-Medium.ttc
/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc
/usr/share/fonts/opentype/noto/NotoSansCJK-Thin.ttc
/usr/share/fonts/opentype/noto/NotoSerifCJK-Black.ttc
/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc
/usr/share/fonts/opentype/noto/NotoSerifCJK-ExtraLight.ttc
/usr/share/fonts/opentype/noto/NotoSerifCJK-Light.ttc
/usr/share/fonts/opentype/noto/NotoSerifCJK-Medium.ttc
/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc
/usr/share/fonts/opentype/noto/NotoSerifCJK-SemiBold.ttc
/usr/share/fonts/truetype/wqy/wqy-microhei.ttc
/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc
```

### Manus 分析总结

**关键发现：** 服务器上中文字体分布在两个目录中：

| 字体系列 | 路径 | 格式 | 注意 |
|---------|------|------|------|
| WenQuanYi Micro Hei | `/usr/share/fonts/truetype/wqy/wqy-microhei.ttc` | TrueType (.ttc) | 在 truetype 目录下 |
| WenQuanYi Zen Hei | `/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc` | TrueType (.ttc) | 在 truetype 目录下 |
| Noto Sans CJK (7个粗细) | `/usr/share/fonts/opentype/noto/NotoSansCJK-*.ttc` | **OpenType (.ttc)** | **在 opentype 目录下，不在 truetype 下！** |
| Noto Serif CJK (7个粗细) | `/usr/share/fonts/opentype/noto/NotoSerifCJK-*.ttc` | **OpenType (.ttc)** | **在 opentype 目录下，不在 truetype 下！** |

**⚠️ 重要：** Noto CJK 字体在 `/usr/share/fonts/opentype/noto/` 目录下，不是 `/usr/share/fonts/truetype/noto/`。如果 V130 的代码只扫描了 truetype 目录或者预定义路径中没有 opentype 路径，那 Noto CJK 字体就会被漏掉。建议确认 resvg 的字体扫描目录是否包含 `/usr/share/fonts/opentype/`。

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
| 气泡图完全空白（无文字） | V131 已修复 | 项目 fonts/ 目录加载字体，绕过沙箱限制 |
| 前端幽灵数据残留 | V129 已修复 | 取消云盘读取时清除 ref/state |
| 测试本答案无分页符 | V132 已修复 | 检测 ===== 答案 ===== 等多种AI输出格式 |
| 输入班号不填充历史学生名单 | V137 修复 | V132 前端逻辑正确但 Zod schema 丢弃 students 字段 |
| Checkpoint 反复失败 | 待验证 | Manus 调整操作顺序后应解决 |

---

## 五、版本发布记录

| 版本 | 日期 | 主要变更 | 部署是否顺利 |
|------|------|---------|------------|
| V129 | 2026-02-07 | resvg 替代 sharp + 幽灵数据修复 + require(sharp) ESM 修复 | 合并顺利，气泡图空白 |
| V130 | 2026-02-07 | resvg 显式字体路径 + 字体发现日志 | 合并顺利，字体仍空白（沙箱限制） |
| V131 | 2026-02-07 | 项目本地 fonts/ 目录加载 + COLLAB.md 协作看板 | 部署成功，气泡图中文正常 |
| V132 | 2026-02-07 | 测试本答案分页符修复 + 装饰性标记处理 + 班号输入自动填充学生名单 | 待部署 |
| V133 | 2026-02-07 | 1对1与小班课生成函数模块化合并 + addWeekdayToDate 抽取共享 + 1对1改非流式 | 待部署 |
| V134 | 2026-02-07 | 原始AI输出日志（排查换行问题） + 气泡图字体升级 Noto Sans CJK SC | 待部署 |
| V137 | 2026-02-09 | 修复学生名持久化(Zod schema) + 任务记录UI优化 + 模型选择器移到主界面 | 待部署 |
| V138 | 2026-02-09 | 后台任务实时字符数显示 + 反馈预览区导航按钮 | 待部署 |
