# Claude ↔ Manus 部署协作规范

## 角色分工

| 角色 | 职责 | 管理的文件 |
|------|------|-----------|
| **Claude**（开发端） | 功能开发、bug修复、代码review、版本号递增 | 业务代码 + `scripts/generate-version.cjs` 版本号 |
| **Manus**（部署端） | 合并分支、构建部署、发布、checkpoint | 发布流程、checkpoint 管理 |

## Git 操作规范（Claude 开发端）

### 创建功能分支
```bash
# 必须基于最新 main 创建，不能基于旧版本
git fetch origin
git checkout -b claude/feature-name origin/main
```

### 开发过程中
- 修改业务代码文件
- **应当更新** `scripts/generate-version.cjs` 中的版本号（当前版本 +1），减少部署端额外提交
- **不删除** `drizzle/` 目录下的已有迁移文件（只允许新增）
- 可以新增 `drizzle/` 下的迁移文件（如果需要加表/加字段）

### 推送前
```bash
# 必须 rebase 到最新 main，确保分支干净
git fetch origin
git rebase origin/main
# rebase 后重新确认版本号是否需要 +1（可能 main 已更新）
# 如有冲突解决后：git rebase --continue
git push -u origin claude/feature-name
```

### 分支命名
- 保持 `claude/` 前缀
- 分支名需要以会话ID后缀结尾（系统要求）

## 版本号更新规则（V128+ 新规）

从 V129 起，Claude 开发端在推送功能分支时应一并更新版本号：
1. Rebase 到最新 main 后，查看 `scripts/generate-version.cjs` 中的当前版本号
2. 将版本号 +1（如 V128 → V129）
3. 作为单独的 commit 提交（`chore: 版本号更新为 V129`）
4. 这样 Manus 合并后可直接 fast-forward，无需额外提交

**注意：** 仅修改 `const VERSION = 'Vxxx';` 这一行，不修改文件其他部分。

## 禁止修改/删除的文件清单

| 文件 | 规则 |
|------|------|
| `scripts/generate-version.cjs` | 仅允许修改版本号那一行，不改其他逻辑 |
| `drizzle/` 下已有的 `.sql` 文件 | 不删除，只允许新增 |
| `drizzle/meta/_journal.json` | 不删除，不修改 |
| `drizzle/meta/*_snapshot.json` | 不删除，不修改 |

## Manus 部署端正确操作流程（⚠️ 顺序很重要）

Manus 平台有双 remote 架构（GitHub + S3），checkpoint 时 origin 会切到 S3。
**关键：必须先 checkpoint 再推 GitHub，否则 S3 历史分叉导致 checkpoint 失败。**

### 正确流程（每次写发布说明时必须提醒 Manus）

```
步骤1: 把 git remote origin 指向 GitHub
步骤2: git fetch origin
步骤3: git merge origin/claude/feature-branch   （应该是 fast-forward）
步骤4: 如果有依赖变更 → npm install
步骤5: npm run build
步骤6: 先调用 webdev_save_checkpoint            （⚠️ 先存 S3！）
步骤7: 再 git push origin main                  （最后推 GitHub）
步骤8: 清理远程功能分支（可选）
```

### 错误流程（V125-V129 反复踩的坑）

```
❌ 错误：先 git push GitHub → 再 checkpoint
   结果：本地历史基于 GitHub，S3 上是旧历史，checkpoint 必然失败
```

### 为什么顺序这么重要

- checkpoint 系统会把 origin 切换为 S3 地址
- 如果先推了 GitHub，本地 main 的 reflog 包含 GitHub 推送记录
- S3 上的 main 是上次 checkpoint 保存的版本
- 两边历史不一致 → `git push` 到 S3 失败 → checkpoint 失败
- **先 checkpoint 的话**，本地历史直接推到 S3，不存在分歧

## 发布说明模板（Claude 每次写给 Manus 的说明中要包含）

每次写发布说明时，在合并命令之后，**务必提醒操作顺序**：

```
⚠️ 操作顺序提醒：
合并完成 → npm install（如有依赖变更）→ npm run build →
先 checkpoint → 再 push GitHub
不要先 push GitHub 再 checkpoint，否则 checkpoint 会失败。
```

## 文档维护规范

### docs/ 目录文档的维护时机

| 时机 | 谁来做 | 更新哪些文档 |
|------|--------|-------------|
| **每次推送功能分支前** | Claude | 如有新功能/架构变更，更新 `docs/项目概述.md` 对应章节 |
| **每次推送功能分支前** | Claude | 将版本变更记录追加到 `docs/迭代记录.md` |
| **修复重大 Bug 后** | Claude | 更新 `docs/问题追踪.md`（新增已解决条目） |
| **遇到新的踩坑经验** | Claude | 追加到 `docs/技术备忘.md` 对应章节 |
| **部署完成后** | Manus | 更新 `COLLAB.md` 版本发布记录的部署状态 |
| **环境配置变更时** | Claude | 更新 `docs/环境变量配置模板.md` |

### 最低要求（每次推送必做）

1. `docs/迭代记录.md` — 追加新版本的变更记录
2. `COLLAB.md` — 更新部署任务区域

### 版本号同步

docs/ 文档末尾的版本号不需要每次都改，但应该在**积累了多个版本后**（如每 10-20 个版本）批量更新一次，保持文档版本号不至于太落后。

---

## 历史教训

### 版本号回退事件（V125-V127）
- 功能分支从 V104 时期的 main 创建，main 已迭代到 V126
- 合并时版本号回退 → Manus 每次需手动修复
- **根因：** 功能分支未基于最新 main
- **状态：** V128 起已修复

### 迁移文件"删除"事件（V125-V127）
- 功能分支不包含 main 上新增的迁移文件
- git diff 显示功能分支"删除"了这些文件
- **根因：** 同上，功能分支基于旧版 main
- **状态：** V128 起已修复

### Checkpoint 反复失败（V125-V129）
- 每次 checkpoint 都失败一次，需要清理重试
- **根因：** Manus 先推 GitHub 再 checkpoint，导致 S3 历史分叉
- **解决方案：** 调整顺序为先 checkpoint 再推 GitHub
- **状态：** V130 起应验证此方案
