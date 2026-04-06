# 织梦AI小说 Frontend (Day 1-2)

## 已完成内容

- Next.js 14 + TypeScript + Tailwind 基础架构
- Supabase SSR 客户端与中间件
- `/auth` 登录注册页
- `user/admin` 角色分流（`/` 自动跳转）
- `/dashboard` 作品库（列表 + 新建作品 + 余额展示）
- `/editor/[bookId]/[chapterId]` 占位三栏页（Day 3 扩展）
- `/admin` 基础页与权限拦截
- `forbidden` 无权限页
- AI 服务端代理接口：
  - `POST /api/ai/review`（审核）
  - `POST /api/ai/generate`（先审后生）

## 本地启动

1. 安装 Node.js 20+
2. 在本目录执行：

```bash
npm install
cp .env.example .env.local
npm run dev
```

3. 填写 `.env.local`：

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`（Day 1-2 尚未使用，可先留空）
- `DIFY_API_BASE_URL`（服务端使用）
- `DIFY_API_KEY`（服务端使用）
- `NEXT_PUBLIC_CDK_SHOP_URL`、`NEXT_PUBLIC_CDK_CONTACT_HINT`（兑换页，可选）

## 生产部署

上线顺序、生产 Supabase 迁移、Vercel 环境变量、冒烟清单、亚太区与 CDN、合规提示见 **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**。

## 安全约束（必须）

- 所有 Dify 调用必须走 Next.js 服务端接口，前端禁止直连 Dify。
- 前端禁止保存 Dify API Key、Dify 端点地址。
- 所有 AI 生成请求必须先通过审核接口，再进入生成接口。

## 国内部署兼容建议

- 不依赖海外 CDN 字体，默认系统字体与本地资源。
- npm 依赖建议使用国内镜像源（如企业内网镜像或 npmmirror）。
- 若部署在国内服务器，建议将 Dify 与应用部署在同区域网络，降低时延。

## Supabase SQL

**新库**：在 Supabase SQL Editor **一次性执行** [`supabase/install_all.sql`](supabase/install_all.sql)（详见 [`supabase/README.md`](supabase/README.md)）。勿只跑早期单文件快照。

历史按天拆分的脚本在 [`supabase/archive/legacy-day-migrations/`](supabase/archive/legacy-day-migrations/)，仅供对照；**已有数据的库**只应补跑缺失的增量，不要整文件重跑 `install_all.sql`。
