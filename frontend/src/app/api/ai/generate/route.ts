import { NextResponse } from "next/server";
import { callDifyChat, DifyRequestError, reviewText } from "@/lib/dify";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readSessionProfile } from "@/lib/server/session";
import { applyRisk } from "@/lib/risk";
import { getPromptRow, PromptConfigError } from "@/lib/ai-prompts";
import { resolveAiModelForAction } from "@/lib/model-resolve";
import { appendDailySurchargeNote, formatQuotaChargeDetail } from "@/lib/billing-labels";
import { billableTotalsFromUsage } from "@/lib/usage-billing";
import { debitAiWordUsage, refundAiOvercharge } from "@/lib/debit-ai-usage";
import { estimatePreDebitCost, handleDebitError } from "@/lib/ai-billing-guard";
import { AI_ACTION_DE_AI, AI_ACTION_EXPAND, AI_ACTION_POLISH } from "@/lib/ai-action-types";
import {
  buildDeAiUserTextWithContext,
  buildExpandUserTextWithContext,
  buildPolishUserTextWithContext
} from "@/lib/chapter-content";

/**
 * AI 生成代理接口（Next.js 服务端）
 * 规则：
 * 1) 前端只能调用本接口，不能直连 Dify。
 * 2) 本接口必须先审核，再生成。
 */
export async function POST(request: Request) {
  try {
    const profile = await readSessionProfile();
    if (!profile) {
      return NextResponse.json(
        { ok: false, error_code: "UNAUTHORIZED", message: "请先登录后再使用 AI 生成。" },
        { status: 401 }
      );
    }
    if (profile.status === "banned") {
      return NextResponse.json(
        { ok: false, error_code: "FORBIDDEN", message: "当前账号已被封禁，无法使用 AI 生成。" },
        { status: 403 }
      );
    }

    const body = (await request.json()) as {
      userText?: string;
      conversationId?: string;
      action_type?: string;
      model_key?: string;
      book_id?: string;
      /** 润色：snippet=仅选段；chapter=附带本章正文语境（由客户端传入当前编辑器全文） */
      polish_mode?: string;
      /** 扩写：同上 */
      expand_mode?: string;
      /** 去痕：同上 */
      de_ai_mode?: string;
      selected_text?: string;
      chapter_plain_context?: string;
      chapter_id?: string;
    };
    const actionType = (body.action_type ?? "").trim();
    const allowedActionTypes = new Set<string>([AI_ACTION_POLISH, AI_ACTION_EXPAND, AI_ACTION_DE_AI]);
    if (!allowedActionTypes.has(actionType)) {
      return NextResponse.json(
        { ok: false, error_code: "INTERNAL_ERROR", message: "缺少或不支持的 action_type" },
        { status: 400 }
      );
    }

    const bookIdEarly = (body.book_id ?? "").trim();
    const polishMode = (body.polish_mode ?? "snippet").trim();
    const expandMode = (body.expand_mode ?? "snippet").trim();
    const deAiMode = (body.de_ai_mode ?? "snippet").trim();
    const isChapterPolish = actionType === AI_ACTION_POLISH && polishMode === "chapter";
    const isChapterExpand = actionType === AI_ACTION_EXPAND && expandMode === "chapter";
    const isChapterDeAi = actionType === AI_ACTION_DE_AI && deAiMode === "chapter";
    const isChapterContext = isChapterPolish || isChapterExpand || isChapterDeAi;

    const supabase = createSupabaseServerClient();

    let userText = (body.userText ?? "").trim();
    if (isChapterContext) {
      const sel = (body.selected_text ?? "").trim();
      const ctx = (body.chapter_plain_context ?? "").trim();
      const chapterId = (body.chapter_id ?? "").trim();
      if (!sel || !ctx || !chapterId || !bookIdEarly) {
        return NextResponse.json(
          {
            ok: false,
            error_code: "INTERNAL_ERROR",
            message: "结合本章语境的润色/扩写/去痕需要 book_id、chapter_id、选段与章节正文。"
          },
          { status: 400 }
        );
      }
      const { data: bookOwn } = await supabase
        .from("books")
        .select("user_id")
        .eq("id", bookIdEarly)
        .single();
      if (!bookOwn || bookOwn.user_id !== profile.id) {
        return NextResponse.json(
          { ok: false, error_code: "FORBIDDEN", message: "无权操作该作品。" },
          { status: 403 }
        );
      }
      const { data: chRow } = await supabase
        .from("chapters")
        .select("id")
        .eq("id", chapterId)
        .eq("book_id", bookIdEarly)
        .maybeSingle();
      if (!chRow?.id) {
        return NextResponse.json(
          { ok: false, error_code: "FORBIDDEN", message: "章节不属于当前作品或无权访问。" },
          { status: 403 }
        );
      }
      userText = isChapterPolish
        ? buildPolishUserTextWithContext(ctx, sel)
        : isChapterExpand
          ? buildExpandUserTextWithContext(ctx, sel)
          : buildDeAiUserTextWithContext(ctx, sel);
    } else if (!userText) {
      return NextResponse.json(
        { ok: false, error_code: "INTERNAL_ERROR", message: "缺少 userText" },
        { status: 400 }
      );
    }

    // 强制先审核，命中后自动触发风控
    const review = reviewText(userText);
    if (!review.pass) {
      const riskAction = await applyRisk(supabase, profile.id, review.reason, userText);
      return NextResponse.json(
        {
          ok: false,
          error_code: riskAction === "banned" ? "FORBIDDEN" : "FORBIDDEN",
          risk_action: riskAction,
          message:
            riskAction === "banned"
              ? "账号因多次违规已被封禁，请通过申诉渠道联系管理员。"
              : `内容命中安全规则，本次请求已阻断，请注意合规使用。（${review.reason}）`
        },
        { status: 403 }
      );
    }

    const bookId = bookIdEarly;
    if (bookId && !isChapterContext) {
      const { data: bookRow } = await supabase.from("books").select("user_id").eq("id", bookId).single();
      if (!bookRow || bookRow.user_id !== profile.id) {
        return NextResponse.json(
          { ok: false, error_code: "FORBIDDEN", message: "无权操作该作品。" },
          { status: 403 }
        );
      }
    }

    const modelKeyReq = (body.model_key ?? "").trim() || "default";
    const resolvedModel = await resolveAiModelForAction(supabase, modelKeyReq, actionType);
    if (!resolvedModel.ok) {
      if (resolvedModel.code === "MODEL_NOT_FOUND") {
        return NextResponse.json(
          { ok: false, error_code: "MODEL_NOT_FOUND", message: "所选模型不可用或已下架，请更换模型。" },
          { status: 400 }
        );
      }
      return NextResponse.json(
        {
          ok: false,
          error_code: "MODEL_ACTION_MISMATCH",
          message: "当前模型不适用该操作，请在工具栏更换为对应功能的模型。"
        },
        { status: 400 }
      );
    }
    const modelRow = resolvedModel.model;
    const pool = modelRow.word_pool;

    // ── 预扣费：估算费用并先从余额扣除，扣费失败则不生成 ──
    const estimate = estimatePreDebitCost(userText.length, actionType);
    const preDebit = await debitAiWordUsage(supabase, {
      userId: profile.id,
      pool,
      amount: estimate.estimatedTotal,
      actionType,
      modelKey: modelRow.model_key,
      promptTokens: estimate.estimatedInput,
      completionTokens: estimate.estimatedOutput,
      totalBillable: estimate.estimatedTotal
    });
    const preDebitErr = handleDebitError(preDebit, pool, "generate");
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
      const promptRow = await getPromptRow(supabase, actionType);
      const apiKey = modelRow.dify_api_key?.trim()
        ? modelRow.dify_api_key.trim()
        : promptRow.dify_api_key;
      result = await callDifyChat({
        userText,
        conversationId: body.conversationId,
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
          { ok: false, error_code: error.code, message: "生成配置缺失或未启用，请联系管理员。" },
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
        { ok: false, error_code: "INTERNAL_ERROR", message: "生成失败，请稍后重试。", detail: error instanceof Error ? error.message : "unknown" },
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
      conversationId: result.conversation_id,
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
        message: "生成失败，请稍后重试。",
        detail: error instanceof Error ? error.message : "unknown"
      },
      { status: 500 }
    );
  }
}
