import type { SupabaseClient } from "@supabase/supabase-js";

export type DebitAiWordUsageOk = {
  ok: true;
  flash_word_balance: number;
  pro_word_balance: number;
  /** 含 1.2 倍加价后的实际扣减（与 RPC 一致） */
  quota_charged_effective?: number;
  quota_charged_base?: number;
};

export type DebitAiWordUsageErr = {
  ok: false;
  error: string;
  detail?: string;
};

export type DebitAiWordUsageResult = DebitAiWordUsageOk | DebitAiWordUsageErr;

type RpcRow = {
  ok?: boolean;
  error?: string;
  detail?: string;
  flash_word_balance?: unknown;
  pro_word_balance?: unknown;
  quota_charged_effective?: unknown;
  quota_charged_base?: unknown;
};

/**
 * Dify 返回用量后调用：按当日累计输出与加价规则计算本次应从对应池扣多少字数（不改变余额）。
 */
export async function getRequiredWordDebit(
  supabase: SupabaseClient,
  userId: string,
  totalCost: number,
  completionTokens: number,
  pool: "flash" | "pro"
): Promise<{ required: number; peekFailed: boolean }> {
  const amt = Math.max(0, Math.floor(Number(totalCost) || 0));
  const out = Math.max(0, Math.floor(Number(completionTokens) || 0));
  const { data, error } = await supabase.rpc("peek_debit_words_needed", {
    p_user_id: userId,
    p_amount: amt,
    p_output_words: out,
    p_pool: pool
  });
  if (error || data == null || typeof data !== "number" || data < 0) {
    return { required: amt, peekFailed: true };
  }
  return { required: Number(data), peekFailed: false };
}

/**
 * 原子扣减：与服务端 `debit_ai_word_usage` 对齐，适用于受 RLS 保护、用户不能直接 update 余额的环境。
 */
export async function debitAiWordUsage(
  supabase: SupabaseClient,
  args: {
    userId: string;
    pool: "flash" | "pro";
    amount: number;
    actionType: string;
    modelKey: string;
    promptTokens: number;
    completionTokens: number;
    totalBillable: number;
  }
): Promise<DebitAiWordUsageResult> {
  const capInt = (n: number) =>
    Math.min(2_147_483_647, Math.max(0, Math.floor(Number(n) || 0)));
  const amount = Math.max(0, Math.floor(Number(args.amount) || 0));

  const { data, error } = await supabase.rpc("debit_ai_word_usage", {
    p_user_id: args.userId,
    p_pool: args.pool,
    p_amount: amount,
    p_action_type: args.actionType,
    p_model_key: args.modelKey,
    p_input_tokens: capInt(args.promptTokens),
    p_output_tokens: capInt(args.completionTokens),
    p_total_tokens: capInt(args.totalBillable),
    p_input_words: capInt(args.promptTokens),
    p_output_words: capInt(args.completionTokens)
  });

  if (error) {
    const msg = error.message ?? "";
    const code = (error as { code?: string }).code ?? "";
    const missingFn =
      /debit_ai_word_usage/i.test(msg) &&
      (/Could not find|does not exist|schema cache|PGRST202/i.test(msg) || code === "PGRST202");
    if (missingFn) {
      return {
        ok: false,
        error: "RPC_NOT_INSTALLED",
        detail:
          "请在 Supabase SQL Editor 执行 supabase/install_all.sql（新库），或从 archive/legacy-day-migrations/ 补跑扣费与账单 RLS 相关 day 脚本。"
      };
    }
    return { ok: false, error: "RPC_ERROR", detail: msg };
  }

  const row = data as RpcRow | null;
  if (!row || typeof row !== "object") {
    return { ok: false, error: "INVALID_RESPONSE" };
  }
  if (row.ok === true) {
    return {
      ok: true,
      flash_word_balance: Number(row.flash_word_balance ?? 0),
      pro_word_balance: Number(row.pro_word_balance ?? 0),
      quota_charged_effective:
        row.quota_charged_effective != null ? Number(row.quota_charged_effective) : undefined,
      quota_charged_base: row.quota_charged_base != null ? Number(row.quota_charged_base) : undefined
    };
  }
  return {
    ok: false,
    error: String(row.error ?? "UNKNOWN"),
    detail: row.detail != null ? String(row.detail) : undefined
  };
}

// ── 工作流次数 ──────────────────────────────────────────────────────────────────

export type WorkflowDebitOk = { ok: true; workflow_credits: number };
export type WorkflowDebitErr = { ok: false; error: string; detail?: string };
export type WorkflowDebitResult = WorkflowDebitOk | WorkflowDebitErr;

/**
 * 扣减 1 次工作流次数（调用 debit_workflow_invocation RPC）。
 * 包含日封顶、管理员冻结、余额不足等检查。
 */
export async function debitWorkflowInvocation(
  supabase: SupabaseClient,
  userId: string,
  actionType: string
): Promise<WorkflowDebitResult> {
  const { data, error } = await supabase.rpc("debit_workflow_invocation", {
    p_user_id: userId,
    p_action_type: actionType
  });

  if (error) {
    const msg = error.message ?? "";
    const code = (error as { code?: string }).code ?? "";
    const missingFn =
      /debit_workflow_invocation/i.test(msg) &&
      (/Could not find|does not exist|schema cache|PGRST202/i.test(msg) || code === "PGRST202");
    if (missingFn) {
      return { ok: false, error: "RPC_NOT_INSTALLED", detail: "请执行 install_all.sql（新库）或 archive 中 day27 等工作流扣费迁移。" };
    }
    return { ok: false, error: "RPC_ERROR", detail: msg };
  }

  const row = data as { ok?: boolean; error?: string; detail?: string; workflow_credits?: number } | null;
  if (!row || typeof row !== "object") {
    return { ok: false, error: "INVALID_RESPONSE" };
  }
  if (row.ok === true) {
    return { ok: true, workflow_credits: Number(row.workflow_credits ?? 0) };
  }
  return { ok: false, error: String(row.error ?? "UNKNOWN"), detail: row.detail ?? undefined };
}

export type RefundRpcResult = { ok: true } | { ok: false; message: string };

/**
 * 退还 1 次工作流次数（生成失败时全额退回）。
 */
export async function refundWorkflowCredit(
  supabase: SupabaseClient,
  userId: string
): Promise<RefundRpcResult> {
  const { error } = await supabase.rpc("refund_workflow_credit", { p_user_id: userId });
  if (error) return { ok: false, message: error.message ?? "refund_workflow_credit RPC 失败" };
  return { ok: true };
}

// ── 字数余额退差额 ──────────────────────────────────────────────────────────────

/** settlement：生成成功后按实际用量结算退差；aborted：生成失败等全额退回预扣 */
export type WordRefundReason = "settlement" | "aborted";

/**
 * 退还预扣费中多扣的差额（或失败时全额退回），并写入 billing_logs（负 cost_words）便于用户在使用记录中查看。
 */
export async function refundAiOvercharge(
  supabase: SupabaseClient,
  userId: string,
  pool: "flash" | "pro",
  amount: number,
  reason: WordRefundReason = "settlement"
): Promise<RefundRpcResult> {
  const refund = Math.max(0, Math.floor(Number(amount) || 0));
  if (refund <= 0) return { ok: true };
  const { error } = await supabase.rpc("refund_ai_overcharge", {
    p_user_id: userId,
    p_pool: pool,
    p_amount: refund,
    p_reason: reason
  });
  if (error) return { ok: false, message: error.message ?? "refund_ai_overcharge RPC 失败" };
  return { ok: true };
}
