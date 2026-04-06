import { NextResponse } from "next/server";
import { callDifyChat, DifyRequestError, reviewText } from "@/lib/dify";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readSessionProfile } from "@/lib/server/session";
import { applyRisk } from "@/lib/risk";
import { getPromptRow, PromptConfigError } from "@/lib/ai-prompts";
import { resolveAiModelForParagraphVerify } from "@/lib/model-resolve";
import { appendDailySurchargeNote, formatQuotaChargeDetail } from "@/lib/billing-labels";
import { billableTotalsFromUsage } from "@/lib/usage-billing";
import { debitAiWordUsage, refundAiOvercharge } from "@/lib/debit-ai-usage";
import { estimatePreDebitCost, handleDebitError } from "@/lib/ai-billing-guard";
import { AI_ACTION_PARAGRAPH_VERIFY } from "@/lib/ai-action-types";

/**
 * 正文「段落查证」：用户手动触发；按阅读+写作用量计字数额度（与润色/脑洞一致）。
 * 联网由 Dify 应用侧配置决定（主文档：正文默认不自动联网，段落查证为人工触发例外）。
 */
export async function POST(request: Request) {
  try {
    const profile = await readSessionProfile();
    if (!profile) {
      return NextResponse.json(
        { ok: false, error_code: "UNAUTHORIZED", message: "请先登录后再使用段落查证。" },
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
      userText?: string;
      model_key?: string;
    };

    const bookId = (body.bookId ?? "").trim();
    const paragraph = (body.userText ?? "").trim();
    if (!bookId) {
      return NextResponse.json({ ok: false, error_code: "BAD_REQUEST", message: "缺少 bookId" }, { status: 400 });
    }
    if (!paragraph) {
      return NextResponse.json({ ok: false, error_code: "BAD_REQUEST", message: "缺少待查证正文。" }, { status: 400 });
    }
    const maxParagraphChars = 200_000;
    if (paragraph.length > maxParagraphChars) {
      return NextResponse.json(
        {
          ok: false,
          error_code: "BAD_REQUEST",
          message: `待查证正文过长（>${maxParagraphChars.toLocaleString()} 字），请缩短选区后重试。`
        },
        { status: 400 }
      );
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

    const composedUserText = [
      `书名：《${book.title}》`,
      "以下为作者手动发起的段落查证请求（非自动联网）：",
      paragraph
    ].join("\n\n");

    const review = reviewText(composedUserText);
    if (!review.pass) {
      const riskAction = await applyRisk(supabase, profile.id, review.reason, composedUserText);
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
    const resolvedModel = await resolveAiModelForParagraphVerify(supabase, modelKeyReq);
    if (!resolvedModel.ok) {
      return NextResponse.json(
        {
          ok: false,
          error_code: "MODEL_NOT_FOUND",
          message: "段落查证无可用模型，请在后台配置 paragraph_verify 或通用 default / paragraph_verify_default。"
        },
        { status: 503 }
      );
    }

    const modelRow = resolvedModel.model;
    const pool = modelRow.word_pool;

    // ── 预扣费：估算费用并先从余额扣除，扣费失败则不生成 ──
    const estimate = estimatePreDebitCost(composedUserText.length, AI_ACTION_PARAGRAPH_VERIFY);
    const preDebit = await debitAiWordUsage(supabase, {
      userId: profile.id,
      pool,
      amount: estimate.estimatedTotal,
      actionType: AI_ACTION_PARAGRAPH_VERIFY,
      modelKey: modelRow.model_key,
      promptTokens: estimate.estimatedInput,
      completionTokens: estimate.estimatedOutput,
      totalBillable: estimate.estimatedTotal
    });
    const preDebitErr = handleDebitError(preDebit, pool, "paragraph_verify");
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
      const promptRow = await getPromptRow(supabase, AI_ACTION_PARAGRAPH_VERIFY);
      const apiKey = modelRow.dify_api_key?.trim()
        ? modelRow.dify_api_key.trim()
        : promptRow.dify_api_key;
      result = await callDifyChat({
        userText: composedUserText,
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
            message: "查证失败且预扣字数未能自动退回，请立即联系管理员。",
            detail: abortedRefund.message
          },
          { status: 500 }
        );
      }
      if (error instanceof PromptConfigError) {
        return NextResponse.json(
          { ok: false, error_code: error.code, message: "段落查证未配置或未启用，请联系管理员。" },
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
        { ok: false, error_code: "INTERNAL_ERROR", message: "段落查证处理失败，请稍后重试。", detail: error instanceof Error ? error.message : "unknown" },
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
        message: "段落查证处理失败，请稍后重试。",
        detail: error instanceof Error ? error.message : "unknown"
      },
      { status: 500 }
    );
  }
}
