# 织梦 AI 小说 — Phase 1–6 源码审计（对照 PROJECT_REQUIREMENTS.md）

**审计日期**：2026-04-03  
**Next.js 工程路径**：`/Users/Zhuanz/Desktop/织梦ai写作/frontend`  
**说明**：`plans` 目录仅为需求与计划文档；可运行代码在上一级的 `frontend` 子目录。

---

## Phase 1：基础设施搭建

| 检查项 | 状态 | 说明 |
|--------|------|------|
| Next.js App Router | 通过 | `next@^14.2.18`，源码在 `src/app/` |
| Tailwind CSS | 通过 | `tailwindcss`、`postcss`、`autoprefixer` |
| Shadcn 风格组件 | 部分 | 使用 Radix Dialog、CVA、`tailwind-merge`、Lucide；未强制核对官方 `components.json` 全量初始化 |
| Supabase 连接 | 通过 | `@supabase/ssr`、`@supabase/supabase-js`，`src/lib/supabase/*` |
| 环境变量校验 | 待人工确认 | 需在部署/本地核对 `.env` 与文档是否一致 |
| SQL 建表 | 通过 | `frontend/supabase/000_full_schema.sql` 及多份 `day*.sql` 增量脚本 |

**与主文档差异**：`users` 表为 **双池字数 + 工作流额度**（`flash_word_balance`、`pro_word_balance`、`workflow_credits`），而非单一 `word_balance`（主文档 §2）；属实现演进，需在对外文档中统一口径。

---

## Phase 2：鉴权与大厅 UI

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 登录态与跳转 | 通过 | `src/app/page.tsx` 未登录 `/auth`，管理员 `/admin` 否则 `/dashboard` |
| Middleware | 通过 | 根目录 `middleware.ts` 调用 `updateSession` |
| `/auth` | 通过 | `src/app/auth/page.tsx` |
| `/dashboard` | 通过 | `src/app/dashboard/page.tsx`，顶栏经 `TopNav` 传入 Flash/Pro 余额等 |
| 账单子页 | 通过 | `src/app/dashboard/billing/page.tsx` |

---

## Phase 3：顶配写作台 UI 与 Tiptap

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 动态路由 `/editor/[bookId]/[chapterId]` | 通过 | `src/app/editor/...` |
| Tiptap | 通过 | 依赖与 `editor-client` 等组件 |
| 章节与保存 | 通过 | `actions.ts` 与编辑器内逻辑（需联调时验证防抖与失败重试） |
| 右下角/侧栏聊天 UI | 通过 | `editor-client.tsx` 调用 `/api/chat`，含清空显示等 |
| **主文档 §15 脑洞三字段**（IP / 角色 / 时间线，仅三字段） | **缺口** | 当前为「书名 + 可选补充说明 + 正文摘录」驱动 `brainstorm-outline`，**非**三字段固定表单 |
| **主文档 §14 知识库** | **缺口** | 源码中无 `knowledge_items` 或 `/api/knowledge` 引用 |

**已超出基础 Phase 3 的部分**：查重面板 `DuplicateCheckPanel`、沉浸式相关 UI。

---

## Phase 4：Admin 控制台

| 检查项 | 状态 | 说明 |
|--------|------|------|
| `/admin` 与角色拦截 | 通过 | `admin/page.tsx` + `redirect("/forbidden")` |
| `ai_prompts` CRUD | 通过 | `admin/prompts/actions.ts`、`AdminPromptsSection` |
| `ai_models` | 通过 | `admin/models/actions.ts`、`AdminModelsSection`（主文档 §10 扩展） |
| 用户/CDK/申诉/风控/福利等 | 通过 | 超出主文档最小集合，属运营增强 |

---

## Phase 5：后端 AI 路由与扣费

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 无状态生成类接口 | 通过 | **`POST /api/ai/generate`**（主文档命名为 **`/api/generator`**，**路径不一致**，契约文档建议对齐或显式别名） |
| 有状态聊天接口 | 通过 | **`POST /api/chat`**，与主文档一致 |
| 动态读 `ai_prompts` + 模型解析 | 通过 | `getPromptRow`、`model-resolve` |
| 审核前置 | 通过 | `reviewText` 在 generate/chat/brainstorm 等路由中使用 |
| 扣费与账单 | 通过 | `debit-ai-usage.ts` RPC `debit_ai_word_usage`，`billing_logs` |
| 脑洞大纲独立路由 | 通过 | **`/api/ai/brainstorm-outline`** |

**建议核对**：主文档 §4.1 流式事件协议（`type`: token / usage / conversation / done / error）是否在前后端完全一致；若当前为 JSON 非 SSE，应在规格或实现中二选一并文档化。

---

## Phase 6：前后端联调闭环

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 编辑器调用真实生成 API | 通过 | `fetch("/api/ai/generate", ...)` |
| 聊天调用真实 API | 通过 | `fetch("/api/chat", ...)` |
| 联网 V1/V2 策略 | 待确认 | 需在 Dify 侧与前端「段落查证」等入口对照主文档 §15–§16 做场景测试 |

---

## 主文档 §7 验收标准（DoD）抽样

| 条款 | 状态 | 备注 |
|------|------|------|
| 7.1 全链路 | 大概率通过 | 依赖真实 Supabase + Dify 配置；需手工跑通 |
| 7.2 权限 | 通过 | 书籍/会话多处 `user_id` 校验 |
| 7.3 账务 | 通过 | RPC 扣费 + `billing_logs`；与单一 `word_balance` 文档不一致但实现自洽 |
| 7.4 稳定性 | 部分 | 需在弱网下验证自动保存与中断行为 |
| **7.5 自动化测试** | **缺口** | `frontend/src` 下未见项目级 `*.test.ts(x)`（仅 `node_modules` 内依赖测试） |

---

## 汇总：优先缺口清单（按影响排序）

1. **文档/契约**：`/api/generator` vs `/api/ai/generate` 命名统一或双挂载。  
2. **产品规则 §15**：脑洞入口改为固定三字段（IP、角色、时间线），禁止第四字段与隐藏高级项。  
3. **产品规则 §14**：知识库表 + API + 编辑页抽屉/侧栏（若仍为硬性范围）。  
4. **DoD 7.5**：至少补鉴权守卫、扣费 RPC、会话持久化、章节保存的关键自动化或半自动测试。  
5. **流式协议 §4.1**：与实现对照，必要时补齐或降规格说明。

---

## 本次审计待办完成记录

- [x] 确认 Next.js 实际工程路径：`/Users/Zhuanz/Desktop/织梦ai写作/frontend`  
- [x] 在源码侧按 Phase 1–6 逐项勾选并记录缺口（见上表）
