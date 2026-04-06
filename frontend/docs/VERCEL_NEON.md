# Vercel + Neon 官方一键集成（与本项目的关系）

## 一键集成在 Vercel 里做什么？

在 Vercel 项目 → **Storage**（或 **Integrations**）→ 搜索 **Neon** → 按向导连接后，Vercel 会自动向项目注入环境变量，常见包括：

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | **带连接池** 的连接串（Serverless / Edge 友好，适合运行时查询） |
| `DATABASE_URL_UNPOOLED` | 直连（部分模板用于迁移 / 长事务；以 Neon 控制台实际为准） |

具体名称以 Vercel 集成完成后 **Environment Variables** 页面为准。

## 与本仓库当前架构的差异（必读）

本项目的业务库、RLS、`auth.uid()`、登录注册仍依赖 **Supabase（Postgres + Auth）**，环境变量是：

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

**仅完成 Vercel + Neon 一键集成，并不会自动替代上述能力。**  
Neon 给你的是**另一套 Postgres**；若没有把表结构、数据、鉴权迁过去，应用逻辑仍只会连 Supabase。

因此有两种目标，请二选一：

### 目标 A：继续用 Supabase 跑业务（最常见、改动最小）

- **不必**接 Neon；或接了 Neon 也先**不要**关掉 Supabase。
- 部署：按 [DEPLOYMENT.md](./DEPLOYMENT.md) 配置 Supabase + Vercel 即可。

### 目标 B：真正改成「Vercel + Neon」为唯一数据库

需要额外工程（本仓库**尚未做完**），大致包括：

1. 在 **Neon** 上对空库执行 `supabase/install_all.sql` 时，需处理与 **`auth.users` / `auth.uid()`** 相关的对象（纯 Neon 没有 Supabase Auth，要改触发器、RLS 策略或改为仅服务端用服务账号访问）。
2. **替换登录**：例如 Auth.js (NextAuth)、Clerk、Lucia 等，并维护与 `public.users` 的对应关系。
3. 用 **`DATABASE_URL` + Drizzle / Prisma / `pg`** 重写当前所有 `createSupabaseServerClient` 与 RPC 调用（或保留函数但在 Neon 上创建同名 Postgres 函数并由服务端调用）。

这是一套**完整迁移**，不是点一下集成就能完成。

## 集成后建议先做的一步：验证 Neon 连通

仓库已提供仅用于检测的接口（需已配置 `DATABASE_URL`）：

```http
GET /api/health/neon
```

- 未配置 `DATABASE_URL`：返回说明性 JSON，不报错。
- 已配置且 Neon 可连：`{ "ok": true, "neon": "connected" }`。

## Vercel 配置清单（采用 Neon 时）

1. 在 Vercel 完成 **Neon** 集成，确认 `DATABASE_URL` 已出现在 **Production / Preview** 所需环境。
2. 在本地 `.env.local` 增加一行 `DATABASE_URL=...`（从 Neon 控制台复制 **Pooled** 连接串亦可）。
3. 访问 `/api/health/neon` 确认连通。
4. 若仍使用 Supabase 跑业务：**同时保留** Supabase 相关变量，直到完成目标 B 迁移。

## 参考链接

- [Vercel: Neon](https://vercel.com/docs/storage/vercel-postgres)（文档入口会跳转到 Neon 合作说明）
- [Neon: Connect from Vercel](https://neon.tech/docs/guides/vercel)

---

若你确定走 **目标 B**，需要按模块（Auth → 用户表 → 作品/章节 → 计费 RPC）排期迁移；可在 issue / 任务里拆阶段执行。
