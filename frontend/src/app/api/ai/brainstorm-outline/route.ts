import { NextResponse } from "next/server";
import { callDifyChat, DifyRequestError, reviewText } from "@/lib/dify";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readSessionProfile } from "@/lib/server/session";
import { applyRisk } from "@/lib/risk";
import { getPromptRow, PromptConfigError } from "@/lib/ai-prompts";
import { resolveAiModelForBrainstorm } from "@/lib/model-resolve";
import { appendDailySurchargeNote, formatQuotaChargeDetail } from "@/lib/billing-labels";
import { billableTotalsFromUsage } from "@/lib/usage-billing";
import { debitAiWordUsage, refundAiOvercharge } from "@/lib/debit-ai-usage";
import { estimatePreDebitCost, handleDebitError } from "@/lib/ai-billing-guard";
import { AI_ACTION_BRAINSTORM_OUTLINE } from "@/lib/ai-action-types";

/**
 * 脑洞大纲：按 Dify usage 总吞吐量（prompt+completion）1:1 计额度并从 Flash / Pro 单池扣减；不扣工作流次数。
 */
export async function POST(request: Request) {
  try {
    const profile = await readSessionProfile();
    if (!profile) {
      return NextResponse.json(
        { ok: false, error_code: "UNAUTHORIZED", message: "请先登录后再使用脑洞大纲。" },
        { status: 401 }
      );
    }
    if (profile.status === "banned") {
      return NextResponse.json(
        { ok: false, error_code: "FORBIDDEN", message: "当前账号已被封禁。" },
        { status: 403 }
      );
    }

    const body = (await request.json()) as {
      bookId?: string;
      /** 同人/作品 IP，必填 */
      ip?: string;
      /** 角色，必填 */
      character?: string;
      /** 时间线，必填 */
      timeline?: string;
      model_key?: string;
    };
    const bookId = (body.bookId ?? "").trim();
    if (!bookId) {
      return NextResponse.json({ ok: false, error_code: "BAD_REQUEST", message: "缺少 bookId" }, { status: 400 });
    }

    const supabase = createSupabaseServerClient();
    const { data: book } = await supabase
      .from("books")
      .select("id,user_id,title")
      .eq("id", bookId)
      .single();

    if (!book || book.user_id !== profile.id) {
      return NextResponse.json(
        { ok: false, error_code: "FORBIDDEN", message: "无权限访问该作品。" },
        { status: 403 }
      );
    }

    const ip = (body.ip ?? "").trim();
    const character = (body.character ?? "").trim();
    const timeline = (body.timeline ?? "").trim();
    if (!ip || !character || !timeline) {
      return NextResponse.json(
        {
          ok: false,
          error_code: "BAD_REQUEST",
          message: "请填写 IP、角色、时间线三项（均为必填）。"
        },
        { status: 400 }
      );
    }

    const userText = [
      `IP：${ip}`,
      `角色：${character}`,
      `时间线：${timeline}`,
      `当前作品书名（供关联，非第四表单字段）：《${book.title}》`
    ].join("\n\n");

    const review = reviewText(userText);
    if (!review.pass) {
      const riskAction = await applyRisk(supabase, profile.id, review.reason, userText);
      return NextResponse.json(
        {
          ok: false,
          error_code: "FORBIDDEN",
          risk_action: riskAction,
          message:
            riskAction === "banned"
              ? "账号因多次违规已被封禁，请通过申诉渠道联系管理员。"
              : `内容命中安全规则，本次请求已阻断。（${review.reason}）`
        },
        { status: 403 }
      );
    }

    const modelKeyReq = (body.model_key ?? "").trim() || "default";
    const resolvedModel = await resolveAiModelForBrainstorm(supabase, modelKeyReq);
    if (!resolvedModel.ok) {
      return NextResponse.json(
        {
          ok: false,
          error_code: "MODEL_NOT_FOUND",
          message: "脑洞大纲无可用模型，请联系管理员配置 brainstorm_default 或通用 default。"
        },
        { status: 503 }
      );
    }

    const modelRow = resolvedModel.model;
    const pool = modelRow.word_pool;

    // ── 预扣费：估算费用并先从余额扣除，扣费失败则不生成 ──
    const estimate = estimatePreDebitCost(userText.length, AI_ACTION_BRAINSTORM_OUTLINE);
    const preDebit = await debitAiWordUsage(supabase, {
      userId: profile.id,
      pool,
      amount: estimate.estimatedTotal,
      actionType: AI_ACTION_BRAINSTORM_OUTLINE,
      modelKey: modelRow.model_key,
      promptTokens: estimate.estimatedInput,
      completionTokens: estimate.estimatedOutput,
      totalBillable: estimate.estimatedTotal
    });
    const preDebitErr = handleDebitError(preDebit, pool, "brainstorm");
    if (preDebitErr) return preDebitErr;
    if (!preDebit.ok) {
      return NextResponse.json(
        { ok: false, error_code: "INTERNAL_ERROR", message: "扣费状态异常，请重试。" },
        { status: 500 }
      );
    }
    const preCharged = preDebit.quota_charged_effective ?? estimate.estimatedTotal;

    // ── 调用 Dify 生成 ──
    let result;
    try {
      const promptRow = await getPromptRow(supabase, AI_ACTION_BRAINSTORM_OUTLINE);
      const apiKey = modelRow.dify_api_key?.trim()
        ? modelRow.dify_api_key.trim()
        : promptRow.dify_api_key;
      result = await callDifyChat({
        userText,
        apiKey,
        systemPrompt: promptRow.system_prompt
      });
    } catch (error) {
      const abortedRefund = await refundAiOvercharge(supabase, profile.id, pool, preCharged, "aborted");
      if (!abortedRefund.ok) {
        return NextResponse.json(
          {
            ok: false,
            error_code: "REFUND_FAILED",
            message: "生成失败且预扣字数未能自动退回，请立即联系管理员。",
            detail: abortedRefund.message
          },
          { status: 500 }
        );
      }
      if (error instanceof PromptConfigError) {
        return NextResponse.json(
          { ok: false, error_code: error.code, message: "脑洞大纲未配置或未启用，请联系管理员。" },
          { status: 503 }
        );
      }
      if (error instanceof DifyRequestError) {
        return NextResponse.json(
          {
            ok: false,
            error_code: error.code,
            message:
              error.code === "RATE_LIMITED"
                ? "服务限流中，请稍后重试。"
                : error.code === "DIFY_TIMEOUT"
                  ? "AI 响应超时，请稍后重试。"
                  : "AI 服务返回异常，请稍后重试。",
            detail: error.message
          },
          { status: error.code === "RATE_LIMITED" ? 429 : 502 }
        );
      }
      return NextResponse.json(
        { ok: false, error_code: "INTERNAL_ERROR", message: "脑洞大纲生成失败，请稍后重试。", detail: error instanceof Error ? error.message : "unknown" },
        { status: 500 }
      );
    }

    // ── 结算差额：按实际用量退还多扣部分 ──
    const { promptTokens, completionTokens, totalBillable: actualCost } = billableTotalsFromUsage(result.usage);
    const refundAmount = Math.max(0, preCharged - actualCost);
    let settlementRefundOk = true;
    if (refundAmount > 0) {
      const sr = await refundAiOvercharge(supabase, profile.id, pool, refundAmount, "settlement");
      settlementRefundOk = sr.ok;
    }
    const appliedRefund = refundAmount > 0 && settlementRefundOk ? refundAmount : 0;
    const finalCharged = preCharged - appliedRefund;

    const baseDetail = formatQuotaChargeDetail({
      pool,
      reading: promptTokens,
      writing: completionTokens,
      totalCharged: finalCharged,
      modelName: modelRow.name,
      modelKey: modelRow.model_key
    });
    const billing = {
      kind: "quota" as const,
      word_pool: pool,
      model_key: modelRow.model_key,
      model_name: modelRow.name,
      quota_charged: finalCharged,
      words_charged: finalCharged,
      detail: appendDailySurchargeNote(baseDetail, actualCost, finalCharged)
    };

    return NextResponse.json({
      ok: true,
      answer: result.answer,
      usage: {
        reading: promptTokens,
        writing: completionTokens,
        total_charged: finalCharged
      },
      billing,
      ...(refundAmount > 0 && !settlementRefundOk
        ? {
            settlement_refund_failed: true as const,
            settlement_refund_detail: "差额退回未生效，请联系管理员核对余额。"
          }
        : {}),
      flash_word_balance: preDebit.flash_word_balance + (pool === "flash" ? appliedRefund : 0),
      pro_word_balance: preDebit.pro_word_balance + (pool === "pro" ? appliedRefund : 0)
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error_code: "INTERNAL_ERROR",
        message: "脑洞大纲生成失败，请稍后重试。",
        detail: error instanceof Error ? error.message : "unknown"
      },
      { status: 500 }
    );
  }
}
