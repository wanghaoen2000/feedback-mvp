# Manus 平台密钥确认任务书

## 目的
确认以下环境变量/密钥在 Manus 平台部署时是否由平台自动注入，还是需要项目所有者手动配置和备份。

## 需要确认的项目

### 第一类：我认为是 Manus 自动管理的（请确认）

| 环境变量 | 我的理解 | 请确认是否正确 |
|----------|---------|---------------|
| `VITE_APP_ID` | Manus 平台自动注入 | ☐ 是 / ☐ 否 |
| `OAUTH_SERVER_URL` | Manus 平台自动注入 | ☐ 是 / ☐ 否 |
| `VITE_OAUTH_PORTAL_URL` | Manus 平台自动注入 | ☐ 是 / ☐ 否 |
| `OWNER_OPEN_ID` | Manus 平台自动注入 | ☐ 是 / ☐ 否 |
| `BUILT_IN_FORGE_API_URL` | Manus 平台自动注入 | ☐ 是 / ☐ 否 |
| `BUILT_IN_FORGE_API_KEY` | Manus 平台自动注入 | ☐ 是 / ☐ 否 |
| `VITE_FRONTEND_FORGE_API_URL` | Manus 平台自动注入 | ☐ 是 / ☐ 否 |
| `VITE_FRONTEND_FORGE_API_KEY` | Manus 平台自动注入 | ☐ 是 / ☐ 否 |

### 第二类：需要重点确认的（关键问题）

| 环境变量 | 问题 |
|----------|------|
| `DATABASE_URL` | 数据库连接串是 Manus 平台自动提供的，还是需要我自己配置和备份？如果是平台提供的，重新部署时会自动恢复吗？ |
| `JWT_SECRET` | 这个 JWT 签名密钥是平台自动生成的，还是需要我手动设置？如果重新部署，这个值会变吗？（变了的话所有用户需要重新登录） |

### 第三类：我自己管理的（无需平台操心）

| 密钥 | 来源 | 状态 |
|------|------|------|
| `GOOGLE_CLIENT_ID` | Google Cloud Console | 我自己保管 |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console | 我自己保管 |
| `WHATAI_API_KEY` | DMXapi 第三方 AI 供应商 | 我自己保管 |
| GitHub 仓库凭证 | GitHub | 我自己保管 |

## 补充问题

1. 如果服务器需要重建/重新部署，上述哪些环境变量需要我重新手动配置？
2. 数据库（MySQL/TiDB）的数据在重新部署时是否会保留？还是需要我单独备份？
3. `google_tokens` 表中存储的用户 Google OAuth 令牌，在重新部署后是否仍然有效？
4. 是否有平台提供的密钥管理界面（Secrets Management），我可以在那里查看当前已配置的所有环境变量？

## 期望回复

请逐项确认，并告知如果我需要迁移或重建服务时，最少需要备份哪些信息。
