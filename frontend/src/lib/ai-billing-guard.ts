import { NextResponse } from "next/server";
import { insufficientPoolBalanceMessage } from "@/lib/model-resolve";
import type { DebitAiWordUsageResult, WorkflowDebitResult } from "@/lib/debit-ai-usage";

type Pool = "flash" | "pro";
type AiContext = "generate" | "chat" | "brainstorm" | "paragraph_verify" | "writing_tool";

/** 需要同时扣减工作流次数的 action_type 集合 */
const WORKFLOW_CREDIT_ACTIONS = new Set([
  "book_title", "book_blurb", "book_outline", "fine_outline",
  "golden_opening", "golden_finger", "name_gen",
  "character_setting", "worldview", "glossary_entry", "cover_copy"
]);

/**
 * 根据用户输入长度与操作类型，估算本次 AI 调用的总 token 消耗（含 20% 安全余量）。
 * 同时返回 costsWorkflowCredit 指示该操作是否额外扣减 1 次工作流次数。
 */
export function estimatePreDebitCost(
  inputTextLength: number,
  actionType: string
): {
  estimatedInput: number;
  estimatedOutput: number;
  estimatedTotal: number;
  costsWorkflowCredit: boolean;
} {
  const SYS_PROMPT_OVERHEAD = 800;
  const estimatedInput = inputTextLength + SYS_PROMPT_OVERHEAD;

  let estimatedOutput: number;
  switch (actionType) {
    case "polish":
    case "de_ai":
      estimatedOutput = Math.max(500, Math.ceil(inputTextLength * 1.2));
      break;
    case "expand":
      estimatedOutput = Math.max(500, Math.ceil(inputTextLength * 2.0));
      break;
    case "chat":
      estimatedOutput = Math.max(500, Math.ceil(inputTextLength * 1.5));
      break;
    case "paragraph_verify":
      estimatedOutput = Math.max(300, Math.ceil(inputTextLength * 0.8));
      break;
    case "brainstorm_outline":
      estimatedOutput = 2000;
      break;
    default:
      estimatedOutput = 1500;
      break;
  }

  const rawTotal = estimatedInput + estimatedOutput;
  return {
    estimatedInput,
    estimatedOutput,
    estimatedTotal: Math.ceil(rawTotal * 1.2),
    costsWorkflowCredit: WORKFLOW_CREDIT_ACTIONS.has(actionType)
  };
}

/**
 * 将字数 debit 结果中的各类错误统一映射为 NextResponse。
 * 返回 null 表示 debit 成功，否则返回错误响应。
 */
export function handleDebitError(
  debit: DebitAiWordUsageResult,
  pool: Pool,
  context: AiContext
): NextResponse | null {
  if (debit.ok) return null;

  switch (debit.error) {
    case "RPC_NOT_INSTALLED":
      return NextResponse.json(
        { ok: false, error_code: "BILLING_UNAVAILABLE", message: "计费服务尚未就绪，请稍后再试或联系管理员。" },
        { status: 503 }
      );
    case "DAILY_OUTPUT_CAP":
      return NextResponse.json(
        { ok: false, error_code: "DAILY_OUTPUT_CAP", message: debit.detail ?? "已触达本日生成上限，请明日再试。" },
        { status: 429 }
      );
    case "QUOTA_ADMIN_HOLD":
      return NextResponse.json(
        { ok: false, error_code: "QUOTA_ADMIN_HOLD", message: debit.detail ?? "账号已临时限制 AI 生成，请联系管理员。" },
        { status: 403 }
      );
    case "INSUFFICIENT_BALANCE":
      return NextResponse.json(
        { ok: false, error_code: "INSUFFICIENT_BALANCE", message: insufficientPoolBalanceMessage(pool, context) },
        { status: 409 }
      );
    case "FORBIDDEN":
      return NextResponse.json(
        { ok: false, error_code: "FORBIDDEN", message: "无权扣费。" },
        { status: 403 }
      );
    default:
      return NextResponse.json(
        { ok: false, error_code: "INTERNAL_ERROR", message: "扣费失败，请重试。", detail: debit.detail ?? debit.error },
        { status: 500 }
      );
  }
}

/**
 * 将工作流次数 debit 结果中的各类错误统一映射为 NextResponse。
 */
export function handleWorkflowDebitError(
  debit: WorkflowDebitResult
): NextResponse | null {
  if (debit.ok) return null;

  switch (debit.error) {
    case "RPC_NOT_INSTALLED":
      return NextResponse.json(
        { ok: false, error_code: "BILLING_UNAVAILABLE", message: "工作流扣费服务尚未就绪，请联系管理员。" },
        { status: 503 }
      );
    case "DAILY_WORKFLOW_CAP":
      return NextResponse.json(
        { ok: false, error_code: "DAILY_WORKFLOW_CAP", message: debit.detail ?? "工作流本日次数已达上限，请明日再试。" },
        { status: 429 }
      );
    case "QUOTA_ADMIN_HOLD":
      return NextResponse.json(
        { ok: false, error_code: "QUOTA_ADMIN_HOLD", message: debit.detail ?? "账号已临时限制工作流调用，请联系管理员。" },
        { status: 403 }
      );
    case "INSUFFICIENT_BALANCE":
      return NextResponse.json(
        { ok: false, error_code: "INSUFFICIENT_WF_BALANCE", message: debit.detail ?? "创作工作流次数不足，请先兑换含次数的激活码。" },
        { status: 409 }
      );
    case "FORBIDDEN":
      return NextResponse.json(
        { ok: false, error_code: "FORBIDDEN", message: "无权扣费。" },
        { status: 403 }
      );
    default:
      return NextResponse.json(
        { ok: false, error_code: "INTERNAL_ERROR", message: "工作流扣费失败，请重试。", detail: debit.detail ?? debit.error },
        { status: 500 }
      );
  }
}
