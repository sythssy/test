# 计费：预扣费 / 退还差额 / 工作流 — 现状与后续计划

> 更新说明：本文档记录「字数预扣 + 结算退差」「工作流次数」相关**已实现能力**与**待办事项**。  
> 工作流业务规则尚未定稿，**暂不新增工作流相关代码**，仅保留本计划供后续对照。

---

## 一、已实现功能（当前代码已落地）

### 1. 字数额度：预扣费 → 生成 → 退还多扣差额

- **适用接口**：`/api/ai/generate`、`/api/chat`、`/api/ai/brainstorm-outline`、`/api/ai/writing-tool`、`/api/ai/paragraph-verify`
- **流程**：
  1. 按输入长度与操作类型估算总消耗（`estimatePreDebitCost`，含约 20% 安全余量）
  2. 调用 `debit_ai_word_usage` **先扣估算额**；失败则**不调用** Dify
  3. 调用 Dify 生成；若失败则通过 `refund_ai_overcharge` **按预扣有效金额全额退回**字数池
  4. 成功则按 Dify 返回的实际用量计算 `actualCost`，若 `预扣有效额 > 实际`，再通过 `refund_ai_overcharge` **退还差额**
- **SQL**：`refund_ai_overcharge`（先执行 `day37`，再执行 **`day38_refund_visible_billing_logs.sql`**：退余额 + 写 `billing_logs` 负 `cost_words`；需在 Supabase 执行）
- **工具函数**：`frontend/src/lib/debit-ai-usage.ts`（`refundAiOvercharge`）、`frontend/src/lib/ai-billing-guard.ts`（估算与错误映射）

### 2. 写作工具：字数 + 工作流次数（当前实现）

- **适用接口**：`/api/ai/writing-tool`
- **逻辑**：在字数预扣成功后，对配置在 `WORKFLOW_CREDIT_ACTIONS` 内的 `action_type` 再扣 **1 次**工作流（`debit_workflow_invocation`）；工作流扣费失败会**回滚已预扣的字数**；Dify 失败则**同时**退字数与工作流次数（`refund_workflow_credit`）。
- **前端**：写作与素材工具台确认弹窗可展示「额外消耗 1 次创作工作流次数」（`ai-cost-confirm.tsx` + `writing-tools-client.tsx`）。
- **使用记录页**：`billing_logs` 中带 `cost_workflow_credits > 0` 的行会在「工作流」区块展示（`dashboard/billing/page.tsx`）。

### 3. 其他已有关联能力

- 深度引擎日输出超阈值后的加价规则仍在 RPC 侧；确认弹窗有文案提示。
- 脑洞大纲注释仍为「不扣工作流次数」；与写作工具区分一致。
- 统一错误映射：`handleDebitError`、`handleWorkflowDebitError`。

---

## 二、退还可见（已实现）

1. **账目**：`refund_ai_overcharge` 在加回余额后插入 `billing_logs`：`cost_words` 为**负数**（绝对值 = 退还字数），`word_pool` 为 `flash` / `pro`；`action_type` 为 `word_refund_settlement`（生成成功后的结算退差）或 `word_refund_aborted`（生成失败 / 工作流预扣失败等全额退回预扣）。
2. **前端**：`/dashboard/billing` 字数表包含 `cost_words !== 0` 的行；退还行浅蓝底、操作列中文说明、「扣减 / 退还」列显示绿色 **+N 字**，模型列显示对应引擎（极速/深度）。
3. **代码**：`refundAiOvercharge(..., reason)`，`reason` 为 `settlement` | `aborted`；迁移 `frontend/supabase/day38_refund_visible_billing_logs.sql`（会 `drop` 三参数旧函数，改为四参数）。

### 仍可选的后续增强

- 同一次请求预扣行与退还行用 `request_id` 关联（当前未做）。
- API 响应增加 `pre_charged` / `refunded` / `final_charged` 供 Toast 展示。

---

## 三、工作流：后续规划（暂不写代码）

> 说明：以下仅为**产品/技术规划占位**，具体规则未定前**不继续扩展工作流相关实现**。

### 待定问题清单

- 哪些能力必须扣工作流、哪些只扣字数（是否仅工具台、是否包含脑洞/整链流程等）。
- 工作流次数与字数是否**永远同时扣**，还是支持「仅字数 / 仅工作流」套餐。
- 日封顶（当前 RPC 侧约 30 次/日）是否与运营策略一致，是否按用户等级变化。
- 失败回滚策略是否与字数侧完全一致（已部分实现，是否需审计日志）。
- 兑换码、福利发放与工作流余额的展示与对账。

### 建议的落地顺序（定稿后执行）

1. 确定**扣费矩阵**（功能 × 字数池 × 工作流次数）。
2. 与**账单展示**对齐：工作流行、退还行、预扣结算行统一设计语言。
3. 再改 RPC / 路由 / 前端，避免反复推翻。

### 当前代码中与工作流相关的位置（便于日后修改）

- `frontend/src/lib/ai-billing-guard.ts`：`WORKFLOW_CREDIT_ACTIONS`、`handleWorkflowDebitError`
- `frontend/src/lib/debit-ai-usage.ts`：`debitWorkflowInvocation`、`refundWorkflowCredit`
- `frontend/src/app/api/ai/writing-tool/route.ts`：字数预扣后的工作流预扣与失败回滚
- `frontend/supabase/day27_quota_tiers_and_surcharge.sql`（或合并后的迁移）：`debit_workflow_invocation`
- `frontend/supabase/day37_refund_ai_overcharge.sql`：`refund_workflow_credit`

---

## 四、文档维护

- 有重大计费或工作流变更时，请同步更新本节「已实现」与「待办」，避免与代码脱节。
