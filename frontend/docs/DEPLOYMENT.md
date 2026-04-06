# 生产上线指南：上线路径 + 海外服务与国内用户

本文档对应上线执行顺序与架构建议。**不替代**法律/合规意见。

---

## 1. 生产 Supabase（数据库与 Auth）

### 1.1 创建项目

1. 在 [Supabase](https://supabase.com) 新建 **Production** 项目。
2. **区域**：主要用户在国内时，优先选 **东京（Tokyo）**、**新加坡（Singapore）** 等亚太区，降低与大陆的 RTT（具体以控制台可选区域为准）。
3. 记录 **Project URL**、**anon key**、**service_role key**（后者仅服务端使用）。

### 1.2 执行迁移（必做）

在 **SQL Editor** 中对**全新空库**执行一次 **[`supabase/install_all.sql`](../supabase/install_all.sql)**（说明见 [`supabase/README.md`](../supabase/README.md)）。

已有数据的库：**不要**整段重跑 `install_all.sql`；在 [`supabase/archive/legacy-day-migrations/`](../supabase/archive/legacy-day-migrations/) 中挑选当时缺失的 `dayXX_*.sql` 单独执行，或手写等价迁移。

### 1.3 上线后快速自检（可选）

- Authentication：邮件模板 / 重定向 URL 是否指向生产域名。
- RLS：用普通用户账号无法读写他人数据。
- 在 SQL Editor 确认关键函数存在，例如：`debit_ai_word_usage`、`refund_ai_overcharge`（四参数）、`peek_debit_words_needed`（若使用计费）。

---

## 2. 环境变量（生产）

复制 [`.env.example`](../.env.example) 为部署平台的环境变量配置，**不要**把 `SUPABASE_SERVICE_ROLE_KEY`、`DIFY_API_KEY` 提交到 Git。

| 变量 | 暴露给浏览器 | 说明 |
|------|----------------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | 是 | Supabase 项目 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 是 | anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | **否** | 仅服务端（如 Shadow 注册）；勿加 `NEXT_PUBLIC_` |
| `DIFY_API_BASE_URL` | **否** | Dify API 根地址 |
| `DIFY_API_KEY` | **否** | Dify 密钥 |
| `DIFY_SYSTEM_PROMPT_INPUT_KEY` | **否** | 可选，默认 `system_prompt` |
| `NEXT_PUBLIC_CDK_SHOP_URL` | 是 | 兑换页「获取激活码」外链（如面包多店铺） |
| `NEXT_PUBLIC_CDK_CONTACT_HINT` | 是 | 可选，兑换区底部说明文案 |

**安全**：凡带 `NEXT_PUBLIC_` 的变量会打进前端 bundle，**禁止**放 Dify 密钥、service_role、任何支付密钥。

---

## 3. 部署 Next.js（以 Vercel 为例）

1. 将本仓库 `frontend` 目录连接 Vercel（或导入 Git 子目录）。
2. **Framework Preset**：Next.js；**Root Directory**：`frontend`（若 monorepo）。
3. 在 Vercel **Environment Variables** 填入上表全部生产变量。
4. **Node**：20.x（与 README 一致）。
5. 部署前本地执行：`npm run build`，确保通过后再推生产分支。

### 3.1 上线后冒烟（建议手测）

- [ ] `/auth` 注册 / 登录
- [ ] `/dashboard` 作品列表、新建作品
- [ ] `/editor/...` 打开章节、保存、自动保存相关行为
- [ ] 侧栏聊天或 AI 生成（走服务端代理，扣费/错误提示正常）
- [ ] `/dashboard/redeem` 兑换流程（若已接生产表）
- [ ] `/dashboard/billing` 字数 / 工作流记录展示
- [ ] 管理员 `/admin`（若使用）

---

## 4. 海外服务 + 国内用户（体验）

| 措施 | 说明 |
|------|------|
| **区域** | Supabase 与 Next 宿主尽量同一大区（如亚太）；避免默认美西双跳。 |
| **CDN** | 静态资源走 CDN（Vercel 默认含边缘；也可前置 Cloudflare 等），减轻首包与抖动。 |
| **架构** | 浏览器只访问你的 **站点域名**；由 Next 服务端访问 Supabase / Dify，**不要**在浏览器直连数据库。 |
| **观测** | 对国内三网抽样测延迟与失败率；AI 请求耗时长，超时与重试策略保持合理。 |

**说明**：跨境链路无法保证国内始终「秒开」；若体验为硬指标，需评估香港/新加坡入口、国内 CDN 回源等方案（并单独评估合规）。

---

## 5. 合规与备案（非技术步骤）

若面向中国大陆提供**经营性互联网信息服务**或收集个人信息等，通常涉及备案、许可、隐私政策与用户协议等，**请咨询律师或当地合规顾问**。本文档不提供法律结论。

---

## 6. 相关文件

- 合并安装脚本：[supabase/install_all.sql](../supabase/install_all.sql) · 说明：[supabase/README.md](../supabase/README.md)
- 若使用 **Vercel + Neon 官方集成**（与当前 Supabase 并存或未来迁移）：[VERCEL_NEON.md](./VERCEL_NEON.md)

- 环境变量模板：[.env.example](../.env.example)
- 项目说明：[README.md](../README.md)
